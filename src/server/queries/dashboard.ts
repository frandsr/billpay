import "server-only";

import type { Prisma } from "@prisma/client";

import {
  OUTSTANDING_BILL_STATUSES,
  bucketOutstanding,
  draftsNeedingAttention,
  splitApprovalQueue,
  summariseOutstanding,
  DUE_SOON_DAYS,
  type AgingSlice,
  type ApprovalQueue,
  type DraftAttentionRow,
  type OutstandingTotals,
} from "@/components/dashboard/rollups";
import { db } from "@/lib/db";
import { addDays, todayUtc } from "@/lib/dates";

/**
 * The dashboard's reads.
 *
 * This file fetches; `@/components/dashboard/rollups.ts` decides. Every figure
 * on the landing page is computed from these rows at request time — there is no
 * summary table, no cached total and nothing hardcoded anywhere — so the
 * numbers move the moment a bill is approved or a payment is scheduled.
 *
 * The roll-ups live in a pure module rather than here because this one carries
 * `server-only`: keeping the arithmetic out of it is what lets a test call
 * `summariseOutstanding` or `splitApprovalQueue` with no database at all.
 */

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

const OUTSTANDING_SELECT = {
  id: true,
  billNumber: true,
  dueDate: true,
  totalCents: true,
  currency: true,
  status: true,
  vendor: { select: { id: true, name: true } },
} satisfies Prisma.BillSelect;

export type OutstandingBill = Prisma.BillGetPayload<{
  select: typeof OUTSTANDING_SELECT;
}>;

const DRAFT_SELECT = {
  id: true,
  billNumber: true,
  vendorId: true,
  issueDate: true,
  dueDate: true,
  totalCents: true,
  currency: true,
  source: true,
  vendor: { select: { id: true, name: true } },
  lineItems: {
    orderBy: { sortOrder: "asc" },
    select: {
      description: true,
      amountCents: true,
      glAccountId: true,
      // A line with splits is coded BY the splits, so readiness needs them to
      // avoid calling a fully distributed line "uncoded".
      splits: {
        orderBy: { sortOrder: "asc" },
        select: {
          glAccountId: true,
          amountCents: true,
          percentBasisPoints: true,
        },
      },
    },
  },
} satisfies Prisma.BillSelect;

export type DraftBill = Prisma.BillGetPayload<{
  select: typeof DRAFT_SELECT;
}>;

const AWAITING_SELECT = {
  id: true,
  billNumber: true,
  dueDate: true,
  totalCents: true,
  currency: true,
  submittedAt: true,
  vendor: { select: { id: true, name: true } },
  approvalSteps: {
    orderBy: { stepOrder: "asc" },
    select: {
      id: true,
      stepOrder: true,
      approverId: true,
      status: true,
      approver: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.BillSelect;

export type AwaitingApprovalBill = Prisma.BillGetPayload<{
  select: typeof AWAITING_SELECT;
}>;

const UPCOMING_PAYMENT_SELECT = {
  id: true,
  amountCents: true,
  method: true,
  scheduledDate: true,
  status: true,
  reference: true,
  bill: {
    select: {
      id: true,
      billNumber: true,
      currency: true,
      vendor: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.PaymentSelect;

export type UpcomingPayment = Prisma.PaymentGetPayload<{
  select: typeof UPCOMING_PAYMENT_SELECT;
}>;

const ACTIVITY_SELECT = {
  id: true,
  type: true,
  message: true,
  createdAt: true,
  user: { select: { id: true, name: true, initials: true, avatarColor: true } },
  bill: {
    select: {
      id: true,
      billNumber: true,
      status: true,
      vendor: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.ActivitySelect;

export type RecentActivity = Prisma.ActivityGetPayload<{
  select: typeof ACTIVITY_SELECT;
}>;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getOutstandingBills(): Promise<OutstandingBill[]> {
  return db.bill.findMany({
    where: { status: { in: [...OUTSTANDING_BILL_STATUSES] } },
    select: OUTSTANDING_SELECT,
    orderBy: { dueDate: "asc" },
  });
}

export async function getDraftBills(): Promise<DraftBill[]> {
  return db.bill.findMany({
    where: { status: "DRAFT" },
    select: DRAFT_SELECT,
    orderBy: { dueDate: "asc" },
  });
}

export async function getBillsAwaitingApproval(): Promise<
  AwaitingApprovalBill[]
> {
  return db.bill.findMany({
    where: { status: "AWAITING_APPROVAL" },
    select: AWAITING_SELECT,
    orderBy: { dueDate: "asc" },
  });
}

/**
 * Payments already committed to a date but not yet settled.
 *
 * SCHEDULED and INITIATED only: a Payment has its own lifecycle (ADR 0002), and
 * those two are the states in which money is still going to move. An INITIATED
 * payment keeps its original send date, so it can appear with a date in the
 * past — it is in transit, not late.
 */
export async function getUpcomingPayments(
  limit = 6,
): Promise<UpcomingPayment[]> {
  return db.payment.findMany({
    where: { status: { in: ["SCHEDULED", "INITIATED"] } },
    select: UPCOMING_PAYMENT_SELECT,
    orderBy: { scheduledDate: "asc" },
    take: limit,
  });
}

export async function getRecentActivity(limit = 8): Promise<RecentActivity[]> {
  return db.activity.findMany({
    select: ACTIVITY_SELECT,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

// ---------------------------------------------------------------------------
// The dashboard's single read
// ---------------------------------------------------------------------------

export interface DashboardData {
  today: Date;
  /** End of the "due this week" window, for the tile's hint. */
  dueSoonThrough: Date;
  outstanding: OutstandingTotals;
  aging: AgingSlice[];
  drafts: DraftAttentionRow[];
  draftCount: number;
  approvals: ApprovalQueue;
  upcomingPayments: UpcomingPayment[];
  upcomingPaymentsCents: number;
  activity: RecentActivity[];
}

/**
 * Everything the dashboard renders, in one call.
 *
 * The five reads are independent, so they run concurrently and the roll-ups
 * happen afterwards in memory. Forty-odd bills is a rounding error to fetch,
 * and doing the arithmetic in TypeScript keeps it in functions a test can call;
 * if the dataset ever outgrew that, the same shapes would come back from SQL
 * aggregates without a single component changing.
 */
export async function getDashboardData(userId: string): Promise<DashboardData> {
  const today = todayUtc();

  const [outstandingBills, draftBills, awaitingBills, payments, activity] =
    await Promise.all([
      getOutstandingBills(),
      getDraftBills(),
      getBillsAwaitingApproval(),
      getUpcomingPayments(),
      getRecentActivity(),
    ]);

  return {
    today,
    dueSoonThrough: addDays(today, DUE_SOON_DAYS),
    outstanding: summariseOutstanding(outstandingBills, today),
    aging: bucketOutstanding(outstandingBills, today),
    drafts: draftsNeedingAttention(draftBills),
    draftCount: draftBills.length,
    approvals: splitApprovalQueue(awaitingBills, userId),
    upcomingPayments: payments,
    upcomingPaymentsCents: payments.reduce(
      (total, payment) => total + payment.amountCents,
      0,
    ),
    activity,
  };
}
