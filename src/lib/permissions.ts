import type { UserRole } from "@/lib/domain";

/**
 * Who may execute a payment, and who may reopen a rejected bill.
 *
 * PURE MODULE: no Prisma, no React, no `next/*`. It follows the same contract
 * as `refuseDecision` in `approval-chain.ts` — a refusal carries a sentence the
 * caller can render — and is imported by BOTH the server actions that enforce
 * it and the panels that decide what to render. The UI hides what these refuse;
 * the server refuses it again on the way in, because a hidden button is not an
 * access control.
 *
 * Two rules, and the reasoning behind each:
 *
 *  * **Payment execution needs ADMIN or APPROVER.** Moving money is the one
 *    irreversible act in the product, and segregation of duties says the person
 *    who raises a bill should not also be the person who pays it. A `MEMBER` —
 *    the AP clerk who codes and submits — can do everything up to APPROVED and
 *    nothing after it.
 *  * **Reopening a REJECTED bill needs to be its creator or an ADMIN.** A
 *    rejection is a message to the person who raised the bill, so that person
 *    must be able to act on it; letting any passer-by reopen someone else's
 *    rejected bill would erase the rejection's meaning. ADMIN is the escape
 *    hatch for when the creator is unavailable.
 *
 * Neither rule blocks the demo walkthrough: approving a bill already requires
 * switching to the Controller (an APPROVER), and that same identity can pay it.
 */

/** Roles allowed to schedule, initiate, complete or fail a payment. */
export const PAYMENT_EXECUTION_ROLES: readonly UserRole[] = ["ADMIN", "APPROVER"];

/** Roles allowed to reopen a rejected bill they did not raise. */
export const BILL_REOPEN_ROLES: readonly UserRole[] = ["ADMIN"];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Admin",
  APPROVER: "Approver",
  MEMBER: "Member",
};

export type PermissionRefusalReason =
  | "PAYMENT_REQUIRES_ELEVATED_ROLE"
  | "REOPEN_REQUIRES_CREATOR_OR_ADMIN";

export interface PermissionRefusal {
  reason: PermissionRefusalReason;
  /** Safe to render straight into the UI or return from a server action. */
  message: string;
}

/** Render "Admin or Approver" from a role list, so messages name the requirement. */
export function describeRoles(roles: readonly UserRole[]): string {
  const labels = roles.map((role) => USER_ROLE_LABELS[role]);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Payment execution
// ---------------------------------------------------------------------------

export function canExecutePayments(role: UserRole): boolean {
  return PAYMENT_EXECUTION_ROLES.includes(role);
}

/**
 * Why this user may NOT move a payment — or `null` when they may.
 *
 * Covers every payment write: scheduling, initiating, completing and failing.
 * They are one privilege because they are one act split across time, and a user
 * who cannot schedule a payment has no business marking one paid either.
 */
export function refusePaymentExecution(
  role: UserRole,
): PermissionRefusal | null {
  if (canExecutePayments(role)) return null;
  return {
    reason: "PAYMENT_REQUIRES_ELEVATED_ROLE",
    message: `Executing a payment requires the ${describeRoles(
      PAYMENT_EXECUTION_ROLES,
    )} role. Switch to an approver to schedule or settle this payment.`,
  };
}

// ---------------------------------------------------------------------------
// Reopening a rejected bill
// ---------------------------------------------------------------------------

export interface BillReopenInput {
  role: UserRole;
  /** `getCurrentUser().id` on the server — never a value sent by the client. */
  userId: string;
  /** `Bill.createdById`, read back from the database, not from the request. */
  billCreatedById: string;
}

export function canReopenBill(input: BillReopenInput): boolean {
  return (
    input.userId === input.billCreatedById || BILL_REOPEN_ROLES.includes(input.role)
  );
}

/** Why this user may NOT reopen this rejected bill — or `null` when they may. */
export function refuseBillReopen(
  input: BillReopenInput,
): PermissionRefusal | null {
  if (canReopenBill(input)) return null;
  return {
    reason: "REOPEN_REQUIRES_CREATOR_OR_ADMIN",
    message: `Only the person who raised this bill, or an ${describeRoles(
      BILL_REOPEN_ROLES,
    )}, can reopen it after a rejection.`,
  };
}
