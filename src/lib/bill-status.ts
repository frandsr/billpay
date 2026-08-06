import type { BillStatus, PaymentStatus } from "@/lib/domain";
import { formatCents } from "@/lib/money";
import { splitsReconcile, validateSplits, type SplitLike } from "@/lib/splits";

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
 *  items — and their splits — included satisfies it structurally. */
export interface ReadinessBill {
  billNumber?: string | null;
  vendorId?: string | null;
  issueDate?: Date | string | null;
  dueDate?: Date | string | null;
  totalCents?: number | null;
  /** ISO-4217 code, used only to render amounts inside the issue messages. */
  currency?: string | null;
  lineItems?: readonly ReadinessLineItem[] | null;
}

export interface ReadinessLineItem {
  description?: string | null;
  amountCents?: number | null;
  glAccountId?: string | null;
  /**
   * The line's splits, when it has any. A non-empty list means THE SPLITS carry
   * the coding (GLOSSARY: split), so `glAccountId` being null is not a defect —
   * what matters is that Σ(splits) equals `amountCents`.
   *
   * Widened to `SplitLike` rather than importing a Prisma type: this module is
   * pure, and the editor's unsaved rows satisfy the same shape.
   */
  splits?: readonly SplitLike[] | null;
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
 * A draft is READY when every required field is present, every line item is
 * CODED, and the line items sum exactly to the authoritative `totalCents`.
 *
 * **A line item is coded when it carries a direct `glAccountId` OR carries
 * splits that reconcile to its amount.** Once splits exist they ARE the coding
 * (GLOSSARY: a split is the distribution of one line across several GL
 * accounts, and Σ(splits) = the line amount), so a line fully distributed
 * across accounts is ready even though its own `glAccountId` is null. Treating
 * that line as "uncoded" used to make the draft permanently unsubmittable:
 * nothing in the UI could clear the flag, because the coding was never missing.
 *
 * Splits that do NOT reconcile are a genuine defect, and are reported with the
 * exact delta rather than being lumped in with "no GL account".
 *
 * Every message names WHAT is wrong — which line, which delta — because a
 * blocked draft is only actionable if the reviewer can see what to fix.
 */
export function draftReadinessDetail(bill: ReadinessBill): ReadinessResult {
  const issues: string[] = [];
  const lineItems = bill.lineItems ?? [];
  const lineItemTotalCents = lineItems.reduce(
    (total, line) => total + (line.amountCents ?? 0),
    0,
  );
  const totalCents = bill.totalCents ?? 0;
  const money = (cents: number) =>
    formatCents(cents, { currency: bill.currency ?? "USD" });

  if (!bill.vendorId) issues.push("No vendor selected");
  if (!bill.billNumber?.trim()) issues.push("Missing bill number");
  if (!bill.issueDate) issues.push("Missing issue date");
  if (!bill.dueDate) issues.push("Missing due date");
  if (!totalCents || totalCents <= 0) issues.push("Missing bill amount");

  if (lineItems.length === 0) {
    issues.push("No line items");
  } else {
    /** 1-based positions of lines with neither a GL account nor any splits. */
    const uncoded: number[] = [];
    /** 1-based positions of lines with no description. */
    const undescribed: number[] = [];
    /** Per-line split defects, already worded for the UI. */
    const splitIssues: string[] = [];

    lineItems.forEach((line, index) => {
      const position = index + 1;
      const amountCents = line.amountCents ?? 0;
      const splits = line.splits ?? [];

      if (!line.description?.trim()) undescribed.push(position);

      if (splits.length === 0) {
        // No splits: the line is coded by its own account, or not at all.
        if (!line.glAccountId) uncoded.push(position);
        return;
      }

      // Splits present: they carry the coding, so the line's own account is
      // beside the point. The arithmetic lives in `@/lib/splits` — asking it
      // here is what keeps the editor and the readiness flag telling the same
      // story about the same split set.
      const { differenceCents } = splitsReconcile(amountCents, splits);
      for (const issue of validateSplits(amountCents, splits)) {
        splitIssues.push(
          issue.code === "OUT_OF_BALANCE"
            ? `Line ${position} splits are ${differenceCents > 0 ? "under" : "over"} by ${money(Math.abs(differenceCents))}`
            : `Line ${position}: ${issue.message}`,
        );
      }
    });

    if (uncoded.length > 0) {
      issues.push(
        uncoded.length === 1
          ? `Line ${uncoded[0]} is not coded — it needs a GL account or a split`
          : `${uncoded.length} line items are not coded (lines ${uncoded.join(", ")})`,
      );
    }

    issues.push(...splitIssues);

    if (undescribed.length > 0) {
      issues.push(
        undescribed.length === 1
          ? `Line ${undescribed[0]} is missing a description`
          : `${undescribed.length} line items are missing a description (lines ${undescribed.join(", ")})`,
      );
    }

    if (totalCents > 0 && lineItemTotalCents !== totalCents) {
      const difference = lineItemTotalCents - totalCents;
      issues.push(
        `Line items add up to ${money(lineItemTotalCents)}, ${money(Math.abs(difference))} ${difference > 0 ? "over" : "under"} the bill total of ${money(totalCents)}`,
      );
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
