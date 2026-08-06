import "server-only";

import { Prisma } from "@prisma/client";

import {
  effectiveStatuses,
  statusesForTab,
  INBOX_TABS,
  type BillFilters,
  type InboxTab,
} from "@/lib/bill-filters";
import { draftReadinessDetail, type DraftReadiness } from "@/lib/bill-status";
import { fromDateInputValue, todayUtc } from "@/lib/dates";
import type { BillStatus, PaymentTerms } from "@/lib/domain";
import { db } from "@/lib/db";

/**
 * Reads for the bills inbox and the manual-creation form.
 *
 * Filtering, sorting and paging happen in SQL wherever SQL can express them.
 * The one exception is the derived `Missing info` / `Ready` flag: it is
 * computed by `draftReadinessDetail()` from the bill AND its line items, so it
 * cannot be a WHERE clause without storing a cache to invalidate (invariant 3
 * in the architecture). When that filter is on we fetch the matching drafts and
 * narrow in memory — drafts are the small end of the table by construction.
 */

const inboxBillSelect = Prisma.validator<Prisma.BillSelect>()({
  id: true,
  billNumber: true,
  vendorId: true,
  status: true,
  source: true,
  issueDate: true,
  dueDate: true,
  paymentTerms: true,
  totalCents: true,
  currency: true,
  memo: true,
  createdAt: true,
  vendor: { select: { id: true, name: true } },
  lineItems: {
    select: { id: true, description: true, amountCents: true, glAccountId: true },
    orderBy: { sortOrder: "asc" },
  },
  approvalSteps: {
    select: { status: true, stepOrder: true },
    orderBy: { stepOrder: "asc" },
  },
  // Newest payment only: the inbox shows "scheduled for…" / "paid on…", the
  // full payment history belongs on the bill detail page.
  payments: {
    select: {
      status: true,
      method: true,
      scheduledDate: true,
      completedAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
});

export type InboxBill = Prisma.BillGetPayload<{
  select: typeof inboxBillSelect;
}>;

/** Statuses that still owe money, i.e. the ones an aging figure applies to. */
export const OUTSTANDING_STATUSES: readonly BillStatus[] = [
  "DRAFT",
  "AWAITING_APPROVAL",
  "APPROVED",
];

export interface CurrencyTotal {
  currency: string;
  totalCents: number;
}

export interface BillsInboxResult {
  bills: InboxBill[];
  /** Rows matching the filters, across every page. */
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Σ per currency over the whole filtered set, not just this page. */
  totals: CurrencyTotal[];
  /** Outstanding and past due, within the current filters. */
  overdueCount: number;
  /** Per-tab counts under every filter EXCEPT the tab itself. */
  tabCounts: Record<InboxTab, number>;
}

// ---------------------------------------------------------------------------
// WHERE / ORDER BY construction
// ---------------------------------------------------------------------------

/**
 * Everything except the status/tab dimension, so the same clause can drive both
 * the table and the tab counts. Counts that ignored the active vendor or date
 * filter would promise rows the tab cannot actually show.
 */
function baseWhere(filters: BillFilters): Prisma.BillWhereInput {
  const where: Prisma.BillWhereInput = {};
  const and: Prisma.BillWhereInput[] = [];

  if (filters.vendorIds.length > 0) {
    and.push({ vendorId: { in: filters.vendorIds } });
  }

  if (filters.search) {
    and.push({
      OR: [
        { billNumber: { contains: filters.search, mode: "insensitive" } },
        { memo: { contains: filters.search, mode: "insensitive" } },
        { vendor: { name: { contains: filters.search, mode: "insensitive" } } },
      ],
    });
  }

  const dueFrom = filters.dueFrom ? fromDateInputValue(filters.dueFrom) : null;
  const dueTo = filters.dueTo ? fromDateInputValue(filters.dueTo) : null;
  if (dueFrom || dueTo) {
    and.push({
      dueDate: {
        ...(dueFrom ? { gte: dueFrom } : {}),
        // The bound is an inclusive calendar day, and due dates are stored at
        // UTC midnight, so `lte` on the day itself is already inclusive.
        ...(dueTo ? { lte: dueTo } : {}),
      },
    });
  }

  if (filters.minAmountCents !== null || filters.maxAmountCents !== null) {
    and.push({
      totalCents: {
        ...(filters.minAmountCents !== null
          ? { gte: filters.minAmountCents }
          : {}),
        ...(filters.maxAmountCents !== null
          ? { lte: filters.maxAmountCents }
          : {}),
      },
    });
  }

  if (and.length > 0) where.AND = and;
  return where;
}

function billsWhere(filters: BillFilters): Prisma.BillWhereInput {
  return {
    ...baseWhere(filters),
    status: { in: [...effectiveStatuses(filters)] },
  };
}

function billsOrderBy(
  filters: BillFilters,
): Prisma.BillOrderByWithRelationInput[] {
  const direction = filters.direction;

  const primary: Prisma.BillOrderByWithRelationInput = (() => {
    switch (filters.sort) {
      case "amount":
        return { totalCents: direction };
      case "vendor":
        return { vendor: { name: direction } };
      case "status":
        // Postgres orders an enum by declaration order, which is the lifecycle
        // order — Draft → Awaiting approval → Approved → Paid → …
        return { status: direction };
      case "billNumber":
        return { billNumber: direction };
      case "createdAt":
        return { createdAt: direction };
      case "dueDate":
      default:
        return { dueDate: direction };
    }
  })();

  // A stable tiebreaker keeps pagination deterministic when amounts or dates
  // collide, which they do constantly in AP data.
  return [primary, { id: "asc" }];
}

// ---------------------------------------------------------------------------
// Derived helpers the inbox renders
// ---------------------------------------------------------------------------

/** The derived DRAFT flag. Only call it for bills in DRAFT. */
export function inboxBillReadiness(bill: InboxBill) {
  return draftReadinessDetail({
    billNumber: bill.billNumber,
    vendorId: bill.vendorId,
    issueDate: bill.issueDate,
    dueDate: bill.dueDate,
    totalCents: bill.totalCents,
    lineItems: bill.lineItems,
  });
}

export interface ApprovalProgress {
  approved: number;
  total: number;
}

/** "1 of 2 approved" for a bill in the approval flow. */
export function inboxApprovalProgress(bill: InboxBill): ApprovalProgress {
  return {
    approved: bill.approvalSteps.filter((step) => step.status === "APPROVED")
      .length,
    total: bill.approvalSteps.length,
  };
}

function sumByCurrency(bills: InboxBill[]): CurrencyTotal[] {
  const totals = new Map<string, number>();
  for (const bill of bills) {
    totals.set(bill.currency, (totals.get(bill.currency) ?? 0) + bill.totalCents);
  }
  return [...totals.entries()]
    .map(([currency, totalCents]) => ({ currency, totalCents }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

function isOutstandingAndOverdue(bill: InboxBill, asOf: Date): boolean {
  return (
    OUTSTANDING_STATUSES.includes(bill.status) && bill.dueDate.getTime() < asOf.getTime()
  );
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Per-tab counts under every active filter except the tab itself. */
async function getTabCounts(
  filters: BillFilters,
): Promise<Record<InboxTab, number>> {
  const grouped = await db.bill.groupBy({
    by: ["status"],
    where: baseWhere(filters),
    _count: { _all: true },
  });

  const byStatus = new Map<BillStatus, number>(
    grouped.map((row) => [row.status, row._count._all]),
  );

  const counts = {} as Record<InboxTab, number>;
  for (const tab of INBOX_TABS) {
    counts[tab] = statusesForTab(tab).reduce(
      (total, status) => total + (byStatus.get(status) ?? 0),
      0,
    );
  }
  return counts;
}

export async function getBillsInbox(
  filters: BillFilters,
): Promise<BillsInboxResult> {
  const where = billsWhere(filters);
  const orderBy = billsOrderBy(filters);
  const asOf = todayUtc();
  const skip = (filters.page - 1) * filters.pageSize;

  if (filters.readiness) {
    // Derived flag → narrow in memory. Scoped to DRAFT bills only.
    const [matching, tabCounts] = await Promise.all([
      db.bill.findMany({ where, orderBy, select: inboxBillSelect }),
      getTabCounts(filters),
    ]);

    const narrowed = matching.filter(
      (bill) => readinessOf(bill) === filters.readiness,
    );

    return {
      bills: narrowed.slice(skip, skip + filters.pageSize),
      total: narrowed.length,
      page: filters.page,
      pageSize: filters.pageSize,
      pageCount: Math.max(1, Math.ceil(narrowed.length / filters.pageSize)),
      totals: sumByCurrency(narrowed),
      overdueCount: narrowed.filter((bill) => isOutstandingAndOverdue(bill, asOf))
        .length,
      tabCounts,
    };
  }

  const [bills, total, grouped, overdueCount, tabCounts] = await Promise.all([
    db.bill.findMany({
      where,
      orderBy,
      select: inboxBillSelect,
      skip,
      take: filters.pageSize,
    }),
    db.bill.count({ where }),
    db.bill.groupBy({
      by: ["currency"],
      where,
      _sum: { totalCents: true },
    }),
    db.bill.count({
      where: {
        AND: [
          where,
          { status: { in: [...OUTSTANDING_STATUSES] } },
          { dueDate: { lt: asOf } },
        ],
      },
    }),
    getTabCounts(filters),
  ]);

  return {
    bills,
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    pageCount: Math.max(1, Math.ceil(total / filters.pageSize)),
    totals: grouped
      .map((row) => ({
        currency: row.currency,
        totalCents: row._sum.totalCents ?? 0,
      }))
      .sort((a, b) => b.totalCents - a.totalCents),
    overdueCount,
    tabCounts,
  };
}

function readinessOf(bill: InboxBill): DraftReadiness {
  return inboxBillReadiness(bill).state;
}

// ---------------------------------------------------------------------------
// Reference data for the filter bar and the new-bill form
// ---------------------------------------------------------------------------

export interface VendorOption {
  id: string;
  name: string;
}

/** Vendors that actually have bills — a filter that returns nothing is noise. */
export async function getInboxVendorOptions(): Promise<VendorOption[]> {
  return db.vendor.findMany({
    where: { bills: { some: {} } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export interface NewBillVendorOption extends VendorOption {
  email: string | null;
  defaultPaymentTerms: PaymentTerms;
  defaultGlAccountId: string | null;
}

export interface GlAccountOption {
  id: string;
  code: string;
  name: string;
}

export interface NewBillFormData {
  vendors: NewBillVendorOption[];
  glAccounts: GlAccountOption[];
}

/**
 * Slimmed reference data for the creation form. Deliberately not the full
 * `Vendor` row: the form is a Client Component, and vendor bank details have no
 * business crossing into the browser bundle.
 */
export async function getNewBillFormData(): Promise<NewBillFormData> {
  const [vendors, glAccounts] = await Promise.all([
    db.vendor.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        email: true,
        defaultPaymentTerms: true,
        defaultGlAccountId: true,
      },
      orderBy: { name: "asc" },
    }),
    db.glAccount.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);

  return { vendors, glAccounts };
}
