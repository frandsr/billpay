import "server-only";

import { Prisma } from "@prisma/client";

import {
  REGISTER_SECTION_META,
  effectivePaymentStatuses,
  type PaymentFilters,
  type RegisterOrder,
  type RegisterSection,
} from "@/components/payments/payments-filters";
import {
  countBySection,
  summarisePaymentRegister,
  type PaymentRegisterTotals,
} from "@/components/payments/rollups";
import { fromDateInputValue, todayUtc } from "@/lib/dates";
import { db } from "@/lib/db";

/**
 * Reads for the payments register.
 *
 * This file fetches; `@/components/payments/rollups.ts` decides. The register
 * exists because a Payment is a separate entity with its own lifecycle (ADR
 * 0002) — so every query here is rooted at `payment`, never at `bill`, and the
 * bill comes along only for the vendor name and the link back to `/bills/{id}`.
 *
 * The roll-ups live in a pure module rather than here because this one carries
 * `server-only`: keeping the arithmetic out of it is what lets a test call
 * `summarisePaymentRegister` with no database at all.
 */

const registerPaymentSelect = Prisma.validator<Prisma.PaymentSelect>()({
  id: true,
  amountCents: true,
  method: true,
  scheduledDate: true,
  initiatedAt: true,
  completedAt: true,
  status: true,
  reference: true,
  bill: {
    select: {
      id: true,
      billNumber: true,
      currency: true,
      status: true,
      dueDate: true,
      vendor: { select: { id: true, name: true } },
    },
  },
});

export type RegisterPayment = Prisma.PaymentGetPayload<{
  select: typeof registerPaymentSelect;
}>;

export interface CurrencyTotal {
  currency: string;
  totalCents: number;
}

export interface PaymentsRegisterResult {
  /** The single "now" every relative figure on the page is measured from. */
  today: Date;
  /** Rows for the active section, already ordered. */
  payments: RegisterPayment[];
  /** Headline figures over every payment matching the non-status filters. */
  totals: PaymentRegisterTotals;
  /** Per-section counts under every filter EXCEPT the section itself. */
  sectionCounts: Record<RegisterSection, number>;
  /** Σ per currency over the active section. */
  sectionTotals: CurrencyTotal[];
}

// ---------------------------------------------------------------------------
// WHERE / ORDER BY construction
// ---------------------------------------------------------------------------

/**
 * Everything except the status dimension, so one clause drives the table, the
 * headline tiles and the section counts alike. Counts that ignored the active
 * vendor or date filter would promise rows the section cannot actually show.
 */
function scopeWhere(filters: PaymentFilters): Prisma.PaymentWhereInput {
  const and: Prisma.PaymentWhereInput[] = [];

  if (filters.methods.length > 0) {
    and.push({ method: { in: filters.methods } });
  }

  if (filters.vendorIds.length > 0) {
    and.push({ bill: { vendorId: { in: filters.vendorIds } } });
  }

  const from = filters.from ? fromDateInputValue(filters.from) : null;
  const to = filters.to ? fromDateInputValue(filters.to) : null;
  if (from || to) {
    and.push({
      scheduledDate: {
        ...(from ? { gte: from } : {}),
        // The bound is an inclusive calendar day, and send dates are stored at
        // UTC midnight, so `lte` on the day itself is already inclusive.
        ...(to ? { lte: to } : {}),
      },
    });
  }

  return and.length > 0 ? { AND: and } : {};
}

/**
 * Each section reads in the order its question implies: what is about to leave
 * soonest, or what happened most recently.
 */
function orderFor(order: RegisterOrder): Prisma.PaymentOrderByWithRelationInput[] {
  const primary: Prisma.PaymentOrderByWithRelationInput[] = (() => {
    switch (order) {
      case "LATEST_COMPLETED_FIRST":
        // Nulls last, so a completed row without a timestamp cannot outrank a
        // genuine settlement date.
        return [
          { completedAt: { sort: "desc", nulls: "last" } },
          { scheduledDate: "desc" },
        ];
      case "LATEST_FIRST":
        return [{ scheduledDate: "desc" }];
      case "SOONEST_FIRST":
      default:
        return [{ scheduledDate: "asc" }];
    }
  })();

  // A stable tiebreaker keeps repeated reads deterministic when dates collide,
  // which they do constantly once payments are batched onto the same day.
  return [...primary, { id: "asc" }];
}

// ---------------------------------------------------------------------------
// The register's single read
// ---------------------------------------------------------------------------

/**
 * Everything the register renders, in one call.
 *
 * The scope set — every payment matching the vendor/method/date filters,
 * whatever its status — is fetched once and partitioned in memory. That is what
 * lets the tiles, the section counts and the rows agree by construction rather
 * than by three queries hopefully staying in step. The same trade-off the
 * dashboard makes: an AP register is a few dozen rows, and doing the arithmetic
 * in TypeScript keeps it in functions a test can call. If the dataset outgrew
 * that, the same shapes would come back from SQL aggregates without a single
 * component changing.
 */
export async function getPaymentsRegister(
  filters: PaymentFilters,
): Promise<PaymentsRegisterResult> {
  const today = todayUtc();
  const statuses = effectivePaymentStatuses(filters);

  const scope = await db.payment.findMany({
    where: scopeWhere(filters),
    select: registerPaymentSelect,
    orderBy: orderFor(REGISTER_SECTION_META[filters.section].order),
  });

  const payments = scope.filter((payment) => statuses.includes(payment.status));

  const byCurrency = new Map<string, number>();
  for (const payment of payments) {
    const currency = payment.bill.currency;
    byCurrency.set(
      currency,
      (byCurrency.get(currency) ?? 0) + payment.amountCents,
    );
  }

  return {
    today,
    payments,
    totals: summarisePaymentRegister(scope, today),
    sectionCounts: countBySection(scope),
    sectionTotals: [...byCurrency.entries()]
      .map(([currency, cents]) => ({ currency, totalCents: cents }))
      .sort((a, b) => b.totalCents - a.totalCents),
  };
}

export interface PaymentVendorOption {
  id: string;
  name: string;
}

/**
 * Vendors that actually have a payment.
 *
 * Offering the full vendor list would fill the filter with options that can
 * only ever return an empty register.
 */
export async function getPaymentVendorOptions(): Promise<PaymentVendorOption[]> {
  return db.vendor.findMany({
    where: { bills: { some: { payments: { some: {} } } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
