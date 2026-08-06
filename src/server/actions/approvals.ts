"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { refuseDecision } from "@/lib/approval-chain";
import { resolveApprovalPolicy } from "@/lib/approval-policy";
import {
  BILL_STATUS_META,
  InvalidBillTransitionError,
  assertTransition,
  draftReadinessDetail,
} from "@/lib/bill-status";
import { getCurrentUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { refuseBillReopen } from "@/lib/permissions";

/**
 * Approval server actions — the only way a bill's approval state changes.
 *
 * Every action follows the same four beats:
 *   1. RE-READ the bill and its chain from the database. Nothing the client
 *      sends about status, chain position or identity is trusted; the client
 *      supplies ids only.
 *   2. CHECK AUTHORITY against `getCurrentUser()` through `refuseDecision`,
 *      the same pure predicate the panel uses to decide what to render. A
 *      hidden button is not an access control — this is.
 *   3. `assertTransition` before any `Bill.status` write, then write the step,
 *      the bill and the `Activity` inside ONE transaction, with the previous
 *      state as a guard in the `where` clause so two concurrent approvals
 *      cannot both win.
 *   4. REVALIDATE the pages that render the bill.
 *
 * Actions refuse by RETURNING `{ ok: false, message }`. In a demo app with a
 * user switcher, a stale or forged request is an expected outcome, not an
 * exception, and the caller gets a sentence it can show the user.
 */

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Thrown inside a transaction to roll it back with a user-facing message. */
class ActionRefusal extends Error {}

function fail(message: string): ActionResult {
  return { ok: false, message };
}

function succeed(message: string): ActionResult {
  return { ok: true, message };
}

/** Map a thrown error onto a refusal, keeping domain messages and hiding the rest. */
function toRefusal(error: unknown, fallback: string): ActionResult {
  if (error instanceof ActionRefusal) return fail(error.message);
  if (error instanceof InvalidBillTransitionError) return fail(error.message);
  console.error(fallback, error);
  return fail(fallback);
}

function revalidateBill(billId: string): void {
  revalidatePath(`/bills/${billId}`);
  revalidatePath("/bills");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// Submit for approval
// ---------------------------------------------------------------------------

/**
 * Move a READY draft into the approval flow.
 *
 * Resolves the first applicable policy by amount (ADR 0003) and SNAPSHOTS its
 * ordered approvers onto the bill as `ApprovalStep` rows. The snapshot is the
 * point: editing a policy afterwards must not rewrite bills already in flight.
 * A matching policy with zero steps means auto-approved, and the bill goes
 * straight to APPROVED.
 */
export async function submitBillForApproval(
  billId: string,
): Promise<ActionResult> {
  const user = await getCurrentUser();

  const bill = await db.bill.findUnique({
    where: { id: billId },
    // Splits come along because readiness asks them for the coding: a line
    // with no `glAccountId` is coded by its splits (GLOSSARY), and without
    // them here the gate would refuse a draft the UI correctly calls Ready.
    include: { lineItems: { include: { splits: true } } },
  });
  if (!bill) return fail("That bill no longer exists.");

  if (bill.status !== "DRAFT") {
    return fail(
      `Only a draft can be submitted for approval — this bill is ${BILL_STATUS_META[bill.status].label.toLowerCase()}.`,
    );
  }

  // `Ready` is derived, never stored, so it is recomputed here rather than
  // taken from whatever the client believed when it rendered the button.
  const readiness = draftReadinessDetail(bill);
  if (readiness.state !== "READY") {
    return fail(
      `This draft is not ready to submit: ${readiness.issues.join("; ")}.`,
    );
  }

  const policies = await db.approvalPolicy.findMany({
    where: { active: true },
    include: { steps: { orderBy: { stepOrder: "asc" } } },
    orderBy: { priority: "asc" },
  });

  const policy = resolveApprovalPolicy(policies, bill.totalCents);
  const chain = [...(policy?.steps ?? [])].sort(
    (a, b) => a.stepOrder - b.stepOrder,
  );
  const autoApproved = chain.length === 0;

  try {
    // Auto-approval is NOT a shortcut around the state machine: there is no
    // DRAFT → APPROVED edge in `BILL_TRANSITIONS`, and inventing one would make
    // "approved" reachable without ever entering the flow. A bill matching a
    // zero-step policy takes both legal hops — DRAFT → AWAITING_APPROVAL →
    // APPROVED — inside one transaction, which is the truth of what happens: it
    // enters the approval flow and clears it at once because its chain is empty.
    assertTransition(bill.status, "AWAITING_APPROVAL");
    if (autoApproved) assertTransition("AWAITING_APPROVAL", "APPROVED");

    await db.$transaction(async (tx) => {
      // A bill that was rejected and sent back to DRAFT still carries the chain
      // it failed. Re-submitting takes a FRESH snapshot of the policy that
      // applies today — that is what makes re-submission the way a policy
      // change reaches an in-flight bill (ADR 0003).
      await tx.approvalStep.deleteMany({ where: { billId: bill.id } });

      if (!autoApproved) {
        await tx.approvalStep.createMany({
          data: chain.map((step, index) => ({
            billId: bill.id,
            stepOrder: index + 1,
            approverId: step.approverId,
            status: "PENDING" as const,
          })),
        });
      }

      const now = new Date();
      const submitted = await tx.bill.updateMany({
        where: { id: bill.id, status: "DRAFT" },
        data: {
          status: "AWAITING_APPROVAL",
          submittedAt: now,
          approvedAt: null,
        },
      });
      if (submitted.count !== 1) {
        throw new ActionRefusal(
          "This bill changed while you were submitting it. Reload and try again.",
        );
      }

      await tx.activity.create({
        data: {
          billId: bill.id,
          userId: user.id,
          type: "SUBMITTED",
          message: policy
            ? `submitted this bill for approval — routed by the “${policy.name}” policy`
            : "submitted this bill for approval",
        },
      });

      if (autoApproved) {
        // Second hop, same transaction: nothing outside it ever observes the
        // bill sitting in AWAITING_APPROVAL with an empty chain.
        const approved = await tx.bill.updateMany({
          where: { id: bill.id, status: "AWAITING_APPROVAL" },
          data: { status: "APPROVED", approvedAt: now },
        });
        if (approved.count !== 1) {
          throw new ActionRefusal(
            "This bill changed while you were submitting it. Reload and try again.",
          );
        }

        await tx.activity.create({
          data: {
            billId: bill.id,
            userId: user.id,
            type: "APPROVED",
            message: policy
              ? `auto-approved under the “${policy.name}” policy — no approval steps required`
              : "auto-approved — no approval policy applies to this amount",
          },
        });
      }
    });
  } catch (error) {
    return toRefusal(error, "Could not submit this bill for approval.");
  }

  revalidateBill(billId);

  return succeed(
    autoApproved
      ? `Auto-approved${policy ? ` under “${policy.name}”` : ""}. The bill is ready to pay.`
      : `Submitted for approval — ${chain.length} ${chain.length === 1 ? "approver" : "approvers"} in the chain.`,
  );
}

// ---------------------------------------------------------------------------
// Decide a step
// ---------------------------------------------------------------------------

/**
 * Approve the CURRENT step of the chain.
 *
 * `stepId` is what the client claims to be deciding; it is checked against the
 * chain as stored, so posting the id of a later step, of an already-decided
 * step, or of someone else's step is refused here rather than merely hidden in
 * the UI. Approving the last step moves the bill to APPROVED.
 */
export async function approveApprovalStep(
  billId: string,
  stepId: string,
  note?: string,
): Promise<ActionResult> {
  const user = await getCurrentUser();

  const bill = await db.bill.findUnique({
    where: { id: billId },
    include: {
      approvalSteps: {
        include: { approver: true },
        orderBy: { stepOrder: "asc" },
      },
    },
  });
  if (!bill) return fail("That bill no longer exists.");

  const refusal = refuseDecision({
    billStatus: bill.status,
    steps: bill.approvalSteps,
    stepId,
    userId: user.id,
    approverNames: Object.fromEntries(
      bill.approvalSteps.map((step) => [step.approverId, step.approver.name]),
    ),
  });
  if (refusal) return fail(refusal.message);

  const step = bill.approvalSteps.find((candidate) => candidate.id === stepId)!;
  const total = bill.approvalSteps.length;
  // Sequential chain: this is the first PENDING step, so it is the last one
  // outstanding when no other step is still pending.
  const isFinalStep = bill.approvalSteps.every(
    (candidate) => candidate.id === stepId || candidate.status !== "PENDING",
  );
  const trimmedNote = note?.trim() || null;

  try {
    if (isFinalStep) assertTransition(bill.status, "APPROVED");

    await db.$transaction(async (tx) => {
      const now = new Date();

      // `status: "PENDING"` in the guard makes a double-click or a replayed
      // request a no-op instead of a second approval.
      const decided = await tx.approvalStep.updateMany({
        where: { id: stepId, billId: bill.id, status: "PENDING" },
        data: { status: "APPROVED", decidedAt: now, note: trimmedNote },
      });
      if (decided.count !== 1) {
        throw new ActionRefusal("This step has already been decided.");
      }

      if (isFinalStep) {
        const moved = await tx.bill.updateMany({
          where: { id: bill.id, status: "AWAITING_APPROVAL" },
          data: { status: "APPROVED", approvedAt: now },
        });
        if (moved.count !== 1) {
          throw new ActionRefusal(
            "This bill changed while you were approving it. Reload and try again.",
          );
        }
      }

      const position = `step ${step.stepOrder} of ${total}`;
      await tx.activity.create({
        data: {
          billId: bill.id,
          userId: user.id,
          type: "APPROVED",
          message: [
            `approved this bill (${position}${isFinalStep ? " — fully approved" : ""})`,
            trimmedNote ? `: ${trimmedNote}` : "",
          ].join(""),
        },
      });
    });
  } catch (error) {
    return toRefusal(error, "Could not record that approval.");
  }

  revalidateBill(billId);

  return succeed(
    isFinalStep
      ? "Approved. The chain is complete and the bill is ready to pay."
      : `Approved step ${step.stepOrder} of ${total}. It is now with the next approver.`,
  );
}

/**
 * Reject the bill at the current step.
 *
 * A rejection at ANY step ends the chain and moves the bill to REJECTED
 * (ADR 0003). Later steps keep their PENDING rows on purpose: the snapshot is
 * the audit record of the chain the bill was in when it was refused. The note
 * is mandatory — a rejection without a reason is not actionable for whoever
 * has to fix the bill.
 */
export async function rejectBillAtStep(
  billId: string,
  stepId: string,
  note: string,
): Promise<ActionResult> {
  const user = await getCurrentUser();

  const trimmedNote = note?.trim() ?? "";
  if (trimmedNote.length === 0) {
    return fail("Add a reason so whoever picks this bill up knows what to fix.");
  }

  const bill = await db.bill.findUnique({
    where: { id: billId },
    include: {
      approvalSteps: {
        include: { approver: true },
        orderBy: { stepOrder: "asc" },
      },
    },
  });
  if (!bill) return fail("That bill no longer exists.");

  const refusal = refuseDecision({
    billStatus: bill.status,
    steps: bill.approvalSteps,
    stepId,
    userId: user.id,
    approverNames: Object.fromEntries(
      bill.approvalSteps.map((step) => [step.approverId, step.approver.name]),
    ),
  });
  if (refusal) return fail(refusal.message);

  const step = bill.approvalSteps.find((candidate) => candidate.id === stepId)!;

  try {
    assertTransition(bill.status, "REJECTED");

    await db.$transaction(async (tx) => {
      const now = new Date();

      const decided = await tx.approvalStep.updateMany({
        where: { id: stepId, billId: bill.id, status: "PENDING" },
        data: { status: "REJECTED", decidedAt: now, note: trimmedNote },
      });
      if (decided.count !== 1) {
        throw new ActionRefusal("This step has already been decided.");
      }

      const moved = await tx.bill.updateMany({
        where: { id: bill.id, status: "AWAITING_APPROVAL" },
        data: { status: "REJECTED", approvedAt: null },
      });
      if (moved.count !== 1) {
        throw new ActionRefusal(
          "This bill changed while you were rejecting it. Reload and try again.",
        );
      }

      await tx.activity.create({
        data: {
          billId: bill.id,
          userId: user.id,
          type: "REJECTED",
          message: `rejected this bill at step ${step.stepOrder} of ${bill.approvalSteps.length}: ${trimmedNote}`,
        },
      });
    });
  } catch (error) {
    return toRefusal(error, "Could not record that rejection.");
  }

  revalidateBill(billId);

  return succeed("Rejected. The bill has gone back to the person who raised it.");
}

// ---------------------------------------------------------------------------
// Reopen
// ---------------------------------------------------------------------------

/**
 * Send a REJECTED bill back to DRAFT so it can be corrected and re-submitted.
 *
 * The failed chain is deliberately left in place — it is what the panel shows
 * as "why this came back" — and is replaced by a fresh snapshot the moment the
 * bill is submitted again.
 */
export async function returnBillToDraft(billId: string): Promise<ActionResult> {
  const user = await getCurrentUser();

  const bill = await db.bill.findUnique({ where: { id: billId } });
  if (!bill) return fail("That bill no longer exists.");

  // Segregation of duties: a rejection is addressed to whoever raised the bill,
  // so only they (or an admin) get to act on it. Checked against the stored
  // `createdById`, never against anything the client sent.
  const refusal = refuseBillReopen({
    role: user.role,
    userId: user.id,
    billCreatedById: bill.createdById,
  });
  if (refusal) return fail(refusal.message);

  try {
    assertTransition(bill.status, "DRAFT");

    await db.$transaction(async (tx) => {
      const moved = await tx.bill.updateMany({
        where: { id: bill.id, status: "REJECTED" },
        data: { status: "DRAFT", submittedAt: null, approvedAt: null },
      });
      if (moved.count !== 1) {
        throw new ActionRefusal(
          "This bill changed while you were reopening it. Reload and try again.",
        );
      }

      await tx.activity.create({
        data: {
          billId: bill.id,
          userId: user.id,
          type: "UPDATED",
          message: "reopened this bill for editing",
        },
      });
    });
  } catch (error) {
    return toRefusal(error, "Could not reopen this bill.");
  }

  revalidateBill(billId);

  return succeed("Back in draft. Fix it, then submit it for approval again.");
}
