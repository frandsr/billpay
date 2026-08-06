import { currentPendingStep } from "@/lib/approval-chain";
import { approvalProgress } from "@/lib/approval-policy";
import { draftReadinessDetail } from "@/lib/bill-status";
import {
  AGING_BUCKETS,
  AGING_BUCKET_LABELS,
  agingBucket,
  daysUntilDue,
  todayUtc,
  type AgingBucket,
} from "@/lib/dates";
import type { ApprovalStepStatus, BillStatus } from "@/lib/domain";
import { OUTSTANDING_STATUSES } from "@/lib/outstanding";

/**
 * The dashboard's arithmetic, as pure functions.
 *
 * PURE MODULE: no Prisma, no React, no `next/*` — the inputs are declared
 * structurally, so the rows `@/server/queries/dashboard.ts` selects satisfy
 * them without this file importing the generated client. That is what makes
 * every figure on the landing page reachable from a test with no database.
 *
 * It sits beside the components rather than in `src/lib/` because these are the
 * dashboard's own shaping rules — which set counts as outstanding, how wide the
 * "due soon" window is — not domain law. The domain law it depends on stays in
 * the core and is imported, never restated.
 *
 * Nothing here decides a domain rule on its own: aging comes from
 * `agingBucket`, readiness from `draftReadinessDetail`, whose turn it is from
 * `currentPendingStep`. A second implementation of any of them is exactly the
 * drift the shared core exists to prevent.
 */

/**
 * What the dashboard counts as outstanding: a SUBMITTED payable that is still
 * unpaid — awaiting approval, or approved and not yet settled.
 *
 * Defined once in `@/lib/outstanding` and re-exported here under the name the
 * dashboard modules already use. DRAFT is excluded on purpose; drafts get their
 * own tile and their own panel, where the actionable thing is finishing them.
 */
export const OUTSTANDING_BILL_STATUSES = OUTSTANDING_STATUSES;

/** Bills due within this many days count towards the "due this week" tile. */
export const DUE_SOON_DAYS = 7;

// ---------------------------------------------------------------------------
// Headline figures
// ---------------------------------------------------------------------------

/** The minimum shape the balance roll-up needs. */
export interface OutstandingLike {
  dueDate: Date;
  totalCents: number;
  status: BillStatus;
}

export interface OutstandingTotals {
  count: number;
  totalCents: number;
  /** Split of the total by where the bill sits in its lifecycle. */
  awaitingApprovalCents: number;
  awaitingApprovalCount: number;
  approvedCents: number;
  approvedCount: number;
  /** Not yet due, landing within the next `DUE_SOON_DAYS` days. */
  dueSoonCents: number;
  dueSoonCount: number;
  overdueCents: number;
  overdueCount: number;
  /** Days past due of the oldest overdue bill; 0 when nothing is overdue. */
  oldestOverdueDays: number;
  /** How wide the "due this week" window is, so the UI can say so. */
  dueSoonWindowDays: number;
}

/**
 * Headline figures over the outstanding payables.
 *
 * "Due this week" deliberately excludes anything already overdue: an overdue
 * bill is a different problem with a different tile, and counting it twice
 * would make the two figures sum to more than the balance they came from.
 */
export function summariseOutstanding(
  bills: readonly OutstandingLike[],
  today: Date = todayUtc(),
): OutstandingTotals {
  const totals: OutstandingTotals = {
    count: bills.length,
    totalCents: 0,
    awaitingApprovalCents: 0,
    awaitingApprovalCount: 0,
    approvedCents: 0,
    approvedCount: 0,
    dueSoonCents: 0,
    dueSoonCount: 0,
    overdueCents: 0,
    overdueCount: 0,
    oldestOverdueDays: 0,
    dueSoonWindowDays: DUE_SOON_DAYS,
  };

  for (const bill of bills) {
    totals.totalCents += bill.totalCents;

    if (bill.status === "AWAITING_APPROVAL") {
      totals.awaitingApprovalCents += bill.totalCents;
      totals.awaitingApprovalCount += 1;
    } else if (bill.status === "APPROVED") {
      totals.approvedCents += bill.totalCents;
      totals.approvedCount += 1;
    }

    const days = daysUntilDue(bill.dueDate, today);
    if (days < 0) {
      totals.overdueCents += bill.totalCents;
      totals.overdueCount += 1;
      totals.oldestOverdueDays = Math.max(totals.oldestOverdueDays, -days);
    } else if (days <= DUE_SOON_DAYS) {
      totals.dueSoonCents += bill.totalCents;
      totals.dueSoonCount += 1;
    }
  }

  return totals;
}

// ---------------------------------------------------------------------------
// Aging distribution
// ---------------------------------------------------------------------------

export interface AgingSlice {
  bucket: AgingBucket;
  label: string;
  count: number;
  amountCents: number;
  /** Share of the outstanding balance, in basis points (1% = 100). */
  shareBasisPoints: number;
}

/**
 * Outstanding payables bucketed by age, in `AGING_BUCKETS` order.
 *
 * Every bucket is returned, including empty ones: a strip that silently drops
 * "61–90 days" reads as if nothing is that old, which is the opposite of what
 * an empty bucket means. Shares are basis points rather than floats, for the
 * same reason money is integer cents.
 */
export function bucketOutstanding(
  bills: readonly OutstandingLike[],
  today: Date = todayUtc(),
): AgingSlice[] {
  const totals = new Map<AgingBucket, { count: number; amountCents: number }>(
    AGING_BUCKETS.map((bucket) => [bucket, { count: 0, amountCents: 0 }]),
  );

  let totalCents = 0;
  for (const bill of bills) {
    const slot = totals.get(agingBucket(bill.dueDate, today));
    if (!slot) continue;
    slot.count += 1;
    slot.amountCents += bill.totalCents;
    totalCents += bill.totalCents;
  }

  return AGING_BUCKETS.map((bucket) => {
    const slot = totals.get(bucket) ?? { count: 0, amountCents: 0 };
    return {
      bucket,
      label: AGING_BUCKET_LABELS[bucket],
      count: slot.count,
      amountCents: slot.amountCents,
      shareBasisPoints:
        totalCents === 0
          ? 0
          : Math.round((slot.amountCents * 10_000) / totalCents),
    };
  });
}

// ---------------------------------------------------------------------------
// Drafts that cannot be submitted
// ---------------------------------------------------------------------------

/** A DRAFT bill with everything `draftReadinessDetail` needs, plus identity. */
export interface DraftLike {
  id: string;
  billNumber: string;
  vendorId: string;
  issueDate: Date;
  dueDate: Date;
  totalCents: number;
  currency: string;
  source: string;
  vendor: { name: string };
  lineItems: readonly {
    description: string;
    amountCents: number;
    glAccountId: string | null;
    splits: readonly {
      glAccountId: string;
      amountCents: number;
      percentBasisPoints: number | null;
    }[];
  }[];
}

export interface DraftAttentionRow {
  id: string;
  billNumber: string;
  vendorName: string;
  totalCents: number;
  currency: string;
  dueDate: Date;
  source: string;
  /** Why it cannot be submitted, worded by `draftReadinessDetail`. */
  issues: string[];
}

/**
 * The drafts that are `Missing info`, with the reasons attached.
 *
 * The flag is DERIVED, never stored (GLOSSARY), and it is derived here exactly
 * as the bill detail page derives it — same function, same inputs — so a draft
 * the dashboard calls incomplete is a draft whose own page lists the same
 * defects.
 */
export function draftsNeedingAttention(
  drafts: readonly DraftLike[],
): DraftAttentionRow[] {
  return drafts
    .map((draft) => ({ draft, readiness: draftReadinessDetail(draft) }))
    .filter(({ readiness }) => readiness.state === "MISSING_INFO")
    .map(({ draft, readiness }) => ({
      id: draft.id,
      billNumber: draft.billNumber,
      vendorName: draft.vendor.name,
      totalCents: draft.totalCents,
      currency: draft.currency,
      dueDate: draft.dueDate,
      source: draft.source,
      issues: readiness.issues,
    }))
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

// ---------------------------------------------------------------------------
// "What needs me" — the approval queue for one user
// ---------------------------------------------------------------------------

/** A bill in the approval flow, with its materialised chain. */
export interface ApprovalBillLike {
  id: string;
  billNumber: string;
  dueDate: Date;
  totalCents: number;
  currency: string;
  submittedAt: Date | null;
  vendor: { name: string };
  approvalSteps: readonly {
    id: string;
    stepOrder: number;
    approverId: string;
    status: ApprovalStepStatus;
    approver: { name: string };
  }[];
}

export interface ApprovalQueueRow {
  id: string;
  billNumber: string;
  vendorName: string;
  totalCents: number;
  currency: string;
  dueDate: Date;
  submittedAt: Date | null;
  /** "1 of 2 approved" — built from the bill's materialised steps. */
  progressLabel: string;
  /** Which step of the chain is waiting, 1-based. */
  stepOrder: number;
  stepCount: number;
  /** Who holds the chain right now, when it is not the current user. */
  currentApproverName: string | null;
}

export interface ApprovalQueue {
  /** Bills whose current step is this user's — they can act right now. */
  waitingOnMe: ApprovalQueueRow[];
  /** Bills where this user approves later, once an earlier step clears. */
  queuedForMe: ApprovalQueueRow[];
  /** The rest of the queue, held by somebody else entirely. */
  elsewhere: ApprovalQueueRow[];
  /** Σ of every bill in the approval flow, whoever holds it. */
  totalCents: number;
}

/**
 * Split the awaiting-approval bills into "act now", "act later" and "not yours"
 * for one user.
 *
 * A pending step with your name on it is NOT the same as an actionable one:
 * approval is sequential (ADR 0003), so a bill only reaches `waitingOnMe` once
 * every earlier step has cleared. `currentPendingStep` makes that call — the
 * same function the approval panel and the server action use — which is why
 * every row in `waitingOnMe` links to a bill whose Approve button is enabled.
 */
export function splitApprovalQueue(
  bills: readonly ApprovalBillLike[],
  userId: string,
): ApprovalQueue {
  const waitingOnMe: ApprovalQueueRow[] = [];
  const queuedForMe: ApprovalQueueRow[] = [];
  const elsewhere: ApprovalQueueRow[] = [];
  let totalCents = 0;

  for (const bill of bills) {
    totalCents += bill.totalCents;

    const current = currentPendingStep(bill.approvalSteps);
    if (!current) continue;

    const mine = current.approverId === userId;
    const laterStepIsMine =
      !mine &&
      bill.approvalSteps.some(
        (step) => step.status === "PENDING" && step.approverId === userId,
      );

    const row: ApprovalQueueRow = {
      id: bill.id,
      billNumber: bill.billNumber,
      vendorName: bill.vendor.name,
      totalCents: bill.totalCents,
      currency: bill.currency,
      dueDate: bill.dueDate,
      submittedAt: bill.submittedAt,
      progressLabel: approvalProgress(bill.approvalSteps).label,
      stepOrder: current.stepOrder,
      stepCount: bill.approvalSteps.length,
      currentApproverName: mine ? null : current.approver.name,
    };

    if (mine) waitingOnMe.push(row);
    else if (laterStepIsMine) queuedForMe.push(row);
    else elsewhere.push(row);
  }

  const byDueDate = (a: ApprovalQueueRow, b: ApprovalQueueRow) =>
    a.dueDate.getTime() - b.dueDate.getTime();

  return {
    waitingOnMe: waitingOnMe.sort(byDueDate),
    queuedForMe: queuedForMe.sort(byDueDate),
    elsewhere: elsewhere.sort(byDueDate),
    totalCents,
  };
}
