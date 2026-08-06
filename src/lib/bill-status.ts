import type { BillStatus, PaymentStatus } from "@/lib/domain";

/**
 * The bill lifecycle, expressed AS DATA plus the enforcement helpers.
 *
 * Every server action that changes `Bill.status` MUST call `assertTransition`
 * before writing. The transition table below is the single source of truth —
 * the UI derives which buttons to show from it, so UI and server can never
 * drift apart.
 *
 * PURE MODULE: no Prisma, no React, no `next/*`. The statuses come from
 * `@/lib/domain`, whose unions are pinned to the schema by
 * `src/server/schema-parity.ts`, so the domain tests need no database.
 *
 * Reminder (see docs/GLOSSARY.md):
 *  * There is NO `SCHEDULED` bill status. A scheduled payment is an APPROVED
 *    bill that owns a `Payment` in status SCHEDULED.
 *  * `Missing info` / `Ready` are DERIVED flags on a DRAFT, never stored.
 */

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export const BILL_TRANSITIONS: Record<BillStatus, readonly BillStatus[]> = {
  DRAFT: ["AWAITING_APPROVAL", "ARCHIVED"],
  AWAITING_APPROVAL: ["APPROVED", "REJECTED", "ARCHIVED"],
  APPROVED: ["PAID", "ARCHIVED"],
  REJECTED: ["DRAFT", "ARCHIVED"],
  PAID: [],
  ARCHIVED: [],
} as const;

/** Statuses from which no further transition is possible. */
export const TERMINAL_BILL_STATUSES: readonly BillStatus[] = (
  Object.keys(BILL_TRANSITIONS) as BillStatus[]
).filter((status) => BILL_TRANSITIONS[status].length === 0);

export function isTerminalStatus(status: BillStatus): boolean {
  return BILL_TRANSITIONS[status].length === 0;
}

export function allowedTransitions(from: BillStatus): readonly BillStatus[] {
  return BILL_TRANSITIONS[from] ?? [];
}

export function canTransition(from: BillStatus, to: BillStatus): boolean {
  return allowedTransitions(from).includes(to);
}

/** Thrown by `assertTransition`. Server actions can catch this and surface
 *  `error.message` to the client without leaking anything sensitive. */
export class InvalidBillTransitionError extends Error {
  readonly from: BillStatus;
  readonly to: BillStatus;

  constructor(from: BillStatus, to: BillStatus) {
    super(
      `Cannot move a bill from ${BILL_STATUS_META[from].label} to ${BILL_STATUS_META[to].label}.`,
    );
    this.name = "InvalidBillTransitionError";
    this.from = from;
    this.to = to;
  }
}

/**
 * Enforce the state machine. MUST be called server-side before every status
 * write. Throws `InvalidBillTransitionError` when the move is not allowed.
 */
export function assertTransition(from: BillStatus, to: BillStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidBillTransitionError(from, to);
  }
}

// ---------------------------------------------------------------------------
// Display metadata
// ---------------------------------------------------------------------------

export type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "ghost";

export interface StatusMeta {
  /** Human label — the exact wording from the glossary. */
  label: string;
  /** shadcn <Badge variant>. */
  badgeVariant: BadgeVariant;
  /** Extra classes giving the badge its semantic colour. */
  badgeClassName: string;
  /** Short explanation for tooltips / empty states. */
  description: string;
}

export const BILL_STATUS_META: Record<BillStatus, StatusMeta> = {
  DRAFT: {
    label: "Draft",
    badgeVariant: "outline",
    badgeClassName:
      "border-neutral-300 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
    description: "Created but not yet submitted for approval.",
  },
  AWAITING_APPROVAL: {
    label: "Awaiting approval",
    badgeVariant: "outline",
    badgeClassName:
      "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/60 dark:text-amber-300",
    description: "In the approval flow, waiting on one or more approvers.",
  },
  APPROVED: {
    label: "Approved",
    badgeVariant: "outline",
    badgeClassName:
      "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800/60 dark:bg-blue-950/60 dark:text-blue-300",
    description: "Approved and eligible to schedule a payment.",
  },
  PAID: {
    label: "Paid",
    badgeVariant: "outline",
    badgeClassName:
      "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/60 dark:text-emerald-300",
    description: "The associated payment completed.",
  },
  REJECTED: {
    label: "Rejected",
    badgeVariant: "outline",
    badgeClassName:
      "border-red-300 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950/60 dark:text-red-300",
    description: "An approver rejected the bill. It can be sent back to draft.",
  },
  ARCHIVED: {
    label: "Archived",
    badgeVariant: "outline",
    badgeClassName:
      "border-neutral-300 bg-neutral-100 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400",
    description: "Removed from the flow without being paid. Not deleted.",
  },
};

/** Order used by inbox tabs and grouped views. */
export const BILL_STATUS_ORDER: readonly BillStatus[] = [
  "DRAFT",
  "AWAITING_APPROVAL",
  "APPROVED",
  "PAID",
  "REJECTED",
  "ARCHIVED",
] as const;

export const PAYMENT_STATUS_META: Record<PaymentStatus, StatusMeta> = {
  SCHEDULED: {
    label: "Scheduled",
    badgeVariant: "outline",
    badgeClassName:
      "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800/60 dark:bg-blue-950/60 dark:text-blue-300",
    description: "Method and date are set; execution is pending.",
  },
  INITIATED: {
    label: "Initiated",
    badgeVariant: "outline",
    badgeClassName:
      "border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-800/60 dark:bg-indigo-950/60 dark:text-indigo-300",
    description: "Sent to the bank and in transit.",
  },
  PAID: {
    label: "Paid",
    badgeVariant: "outline",
    badgeClassName:
      "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/60 dark:text-emerald-300",
    description: "Funds delivered to the vendor.",
  },
  FAILED: {
    label: "Failed",
    badgeVariant: "outline",
    badgeClassName:
      "border-red-300 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950/60 dark:text-red-300",
    description: "The payment could not be completed.",
  },
};

// ---------------------------------------------------------------------------
// Derived DRAFT readiness — `Missing info` vs `Ready`
// ---------------------------------------------------------------------------

export type DraftReadiness = "MISSING_INFO" | "READY";

export const DRAFT_READINESS_META: Record<DraftReadiness, StatusMeta> = {
  MISSING_INFO: {
    label: "Missing info",
    badgeVariant: "outline",
    badgeClassName:
      "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800/60 dark:bg-orange-950/60 dark:text-orange-300",
    description: "Required fields are incomplete, so this draft cannot be submitted.",
  },
  READY: {
    label: "Ready",
    badgeVariant: "outline",
    badgeClassName:
      "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/60 dark:text-emerald-300",
    description: "All required fields are present. Ready to submit for approval.",
  },
};

/** The minimum shape `draftReadiness` needs. Any Prisma bill with its line
 *  items included satisfies it structurally. */
export interface ReadinessBill {
  billNumber?: string | null;
  vendorId?: string | null;
  issueDate?: Date | string | null;
  dueDate?: Date | string | null;
  totalCents?: number | null;
  lineItems?: ReadinessLineItem[] | null;
}

export interface ReadinessLineItem {
  description?: string | null;
  amountCents?: number | null;
  glAccountId?: string | null;
}

export interface ReadinessResult {
  state: DraftReadiness;
  /** Human-readable reasons, safe to render straight into the UI. */
  issues: string[];
  /** Σ(line item amounts), for the "lines vs total" reconciliation strip. */
  lineItemTotalCents: number;
  /** lineItemTotalCents - totalCents. Zero when the coding balances. */
  differenceCents: number;
}

/**
 * Full readiness breakdown for a DRAFT bill.
 *
 * A draft is READY when every required field is present AND the line items sum
 * exactly to the authoritative `totalCents`.
 */
export function draftReadinessDetail(bill: ReadinessBill): ReadinessResult {
  const issues: string[] = [];
  const lineItems = bill.lineItems ?? [];
  const lineItemTotalCents = lineItems.reduce(
    (total, line) => total + (line.amountCents ?? 0),
    0,
  );
  const totalCents = bill.totalCents ?? 0;

  if (!bill.vendorId) issues.push("No vendor selected");
  if (!bill.billNumber?.trim()) issues.push("Missing bill number");
  if (!bill.issueDate) issues.push("Missing issue date");
  if (!bill.dueDate) issues.push("Missing due date");
  if (!totalCents || totalCents <= 0) issues.push("Missing bill amount");

  if (lineItems.length === 0) {
    issues.push("No line items");
  } else {
    const uncoded = lineItems.filter((line) => !line.glAccountId).length;
    if (uncoded > 0) {
      issues.push(
        uncoded === 1
          ? "1 line item is missing a GL account"
          : `${uncoded} line items are missing a GL account`,
      );
    }
    if (lineItems.some((line) => !line.description?.trim())) {
      issues.push("A line item is missing a description");
    }
    if (totalCents > 0 && lineItemTotalCents !== totalCents) {
      issues.push("Line items do not sum to the bill total");
    }
  }

  return {
    state: issues.length === 0 ? "READY" : "MISSING_INFO",
    issues,
    lineItemTotalCents,
    differenceCents: lineItemTotalCents - totalCents,
  };
}

/** Shorthand for the badge: 'MISSING_INFO' | 'READY'. */
export function draftReadiness(bill: ReadinessBill): DraftReadiness {
  return draftReadinessDetail(bill).state;
}

/** A draft can only be submitted for approval once it is READY. */
export function canSubmitForApproval(
  bill: ReadinessBill & { status?: BillStatus },
): boolean {
  if (bill.status && bill.status !== "DRAFT") return false;
  return draftReadiness(bill) === "READY";
}
