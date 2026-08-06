import type { ApprovalStepStatus, BillStatus } from "@/lib/domain";

/**
 * Who may act on an approval chain, and when.
 *
 * PURE MODULE: no Prisma, no React, no `next/*`. It is imported by BOTH
 * `src/server/actions/approvals.ts` (which enforces it) and
 * `approval-panel.tsx` (which decides what to render), so the buttons a user
 * sees and the rules the server applies cannot drift apart. The UI hides what
 * `refuseDecision` refuses; the server refuses it again on the way in, because
 * a hidden button is not an access control.
 *
 * It would live in `src/lib/` — that is the functional core — but this vertical
 * does not own `src/lib/**`, so it sits inside the directory it does own.
 *
 * Rule (ADR 0003): approval is SEQUENTIAL. Step n+1 becomes actionable only
 * once step n is APPROVED, and only its own named approver can decide it.
 */

export interface ChainStepLike {
  id: string;
  stepOrder: number;
  approverId: string;
  status: ApprovalStepStatus;
}

/** The step whose turn it is: the first PENDING step in `stepOrder`. */
export function currentPendingStep<T extends ChainStepLike>(
  steps: readonly T[],
): T | null {
  return (
    [...steps]
      .sort((a, b) => a.stepOrder - b.stepOrder)
      .find((step) => step.status === "PENDING") ?? null
  );
}

/** True when every step in the chain has been approved. */
export function isChainComplete(steps: readonly ChainStepLike[]): boolean {
  return steps.length > 0 && steps.every((step) => step.status === "APPROVED");
}

export type DecisionRefusalReason =
  | "BILL_NOT_AWAITING_APPROVAL"
  | "STEP_NOT_ON_BILL"
  | "STEP_ALREADY_DECIDED"
  | "OUT_OF_ORDER"
  | "NOT_THE_CURRENT_APPROVER";

export interface DecisionRefusal {
  reason: DecisionRefusalReason;
  /** Safe to render straight into the UI or return from a server action. */
  message: string;
}

export interface DecisionAuthorityInput {
  billStatus: BillStatus;
  steps: readonly ChainStepLike[];
  /** The step the caller claims to be deciding. */
  stepId: string;
  /** `getCurrentUser().id` on the server — never a value sent by the client. */
  userId: string;
  /** Approver display names by id, purely to make refusals readable. */
  approverNames?: Record<string, string>;
}

/**
 * Why this user may NOT decide this step right now — or `null` when they may.
 *
 * Every branch is a refusal the server has to make on its own: the client can
 * post any `stepId` it likes, including one belonging to a step further down
 * the chain or to somebody else's queue.
 */
export function refuseDecision(
  input: DecisionAuthorityInput,
): DecisionRefusal | null {
  const { billStatus, steps, stepId, userId, approverNames = {} } = input;

  if (billStatus !== "AWAITING_APPROVAL") {
    return {
      reason: "BILL_NOT_AWAITING_APPROVAL",
      message: "This bill is not awaiting approval, so its chain is closed.",
    };
  }

  const step = steps.find((candidate) => candidate.id === stepId);
  if (!step) {
    return {
      reason: "STEP_NOT_ON_BILL",
      message: "That approval step does not belong to this bill.",
    };
  }

  if (step.status !== "PENDING") {
    return {
      reason: "STEP_ALREADY_DECIDED",
      message: `Step ${step.stepOrder} has already been ${step.status === "APPROVED" ? "approved" : "rejected"}.`,
    };
  }

  const current = currentPendingStep(steps);
  if (!current || current.id !== step.id) {
    return {
      reason: "OUT_OF_ORDER",
      message: current
        ? `Step ${step.stepOrder} is not actionable yet — step ${current.stepOrder} has to be approved first. Approval is sequential.`
        : `Step ${step.stepOrder} is not actionable.`,
    };
  }

  if (step.approverId !== userId) {
    const name = approverNames[step.approverId];
    return {
      reason: "NOT_THE_CURRENT_APPROVER",
      message: name
        ? `Only ${name} can decide step ${step.stepOrder} of this chain.`
        : `You are not the approver for step ${step.stepOrder} of this chain.`,
    };
  }

  return null;
}

/** Convenience for the panel: can this user act on the current step? */
export function canDecideCurrentStep(
  billStatus: BillStatus,
  steps: readonly ChainStepLike[],
  userId: string,
): boolean {
  const current = currentPendingStep(steps);
  if (!current) return false;
  return (
    refuseDecision({ billStatus, steps, stepId: current.id, userId }) === null
  );
}

export const APPROVAL_STEP_STATUS_LABELS: Record<ApprovalStepStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

/**
 * What every approval server action returns.
 *
 * Actions REFUSE by returning `ok: false` with a message the client can toast,
 * rather than throwing: a forged or stale request is an expected outcome of an
 * open demo app, not an exception. `src/components/payments/payment-lifecycle.ts`
 * declares the same shape for the payment actions — the two live apart only
 * because a `"use server"` module may export nothing but async functions, and
 * this vertical owns no directory both panels could share.
 */
export interface ActionResult {
  ok: boolean;
  message: string;
}
