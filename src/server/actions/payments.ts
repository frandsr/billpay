"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import {
  BILL_STATUS_META,
  InvalidBillTransitionError,
  assertTransition,
} from "@/lib/bill-status";
import { getCurrentUser } from "@/lib/current-user";
import { formatDate, fromDateInputValue, todayUtc } from "@/lib/dates";
import { db } from "@/lib/db";
import { PAYMENT_METHODS, type PaymentMethod, type UserRole } from "@/lib/domain";
import { formatCents } from "@/lib/money";
import {
  InvalidPaymentTransitionError,
  PAYMENT_METHOD_LABELS,
  assertPaymentTransition,
  isPaymentSettled,
  missingVendorPaymentDetails,
  paymentReference,
} from "@/lib/payment-lifecycle";
import { refusePaymentExecution } from "@/lib/permissions";

/**
 * Payment server actions — money movement, simulated but modelled honestly.
 *
 * A Payment is a SEPARATE entity with its own lifecycle (ADR 0002). These
 * actions therefore touch two state machines and are careful about which:
 * `assertPaymentTransition` guards `Payment.status`, `assertTransition` guards
 * `Bill.status`, and only ONE payment outcome — completion — moves the bill.
 * A failed payment leaves the bill APPROVED and payable again.
 *
 * Same four beats as the approval actions: re-read server-side, check the rules
 * against `getCurrentUser()` and the stored state, write inside a transaction
 * guarded on the previous status, revalidate. The client supplies ids and form
 * values, never state.
 */

class ActionRefusal extends Error {}

function fail(message: string): ActionResult {
  return { ok: false, message };
}

function succeed(message: string): ActionResult {
  return { ok: true, message };
}

function toRefusal(error: unknown, fallback: string): ActionResult {
  if (error instanceof ActionRefusal) return fail(error.message);
  if (error instanceof InvalidBillTransitionError) return fail(error.message);
  if (error instanceof InvalidPaymentTransitionError) return fail(error.message);
  console.error(fallback, error);
  return fail(fallback);
}

function revalidateBill(billId: string): void {
  revalidatePath(`/bills/${billId}`);
  revalidatePath("/bills");
  revalidatePath("/dashboard");
}

function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}

/**
 * Segregation of duties: moving money needs an elevated role.
 *
 * Every payment write starts here, because scheduling, initiating, completing
 * and failing are one privilege split across time — a user who may not schedule
 * a payment has no business marking one paid either. The panel hides these
 * controls from a member; this is what actually enforces it.
 */
function refuseUnlessPayer(role: UserRole): ActionResult | null {
  const refusal = refusePaymentExecution(role);
  return refusal ? fail(refusal.message) : null;
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/**
 * Schedule the payment for an APPROVED bill.
 *
 * The bill never gains a "scheduled" status — scheduling is entirely a property
 * of the Payment row created here (ADR 0002). One full payment per bill: the
 * schema is 1:N-capable so partial payments stay additive, but the application
 * refuses a second live payment today. A payment that FAILED does not block a
 * replacement.
 */
export async function schedulePayment(
  billId: string,
  method: string,
  scheduledDate: string,
): Promise<ActionResult> {
  const user = await getCurrentUser();

  const denied = refuseUnlessPayer(user.role);
  if (denied) return denied;

  if (!isPaymentMethod(method)) {
    return fail("Pick a payment method.");
  }

  const date = fromDateInputValue(scheduledDate);
  if (!date) {
    return fail("Pick a valid send date.");
  }
  if (date.getTime() < todayUtc().getTime()) {
    return fail("A payment cannot be scheduled for a date in the past.");
  }

  const bill = await db.bill.findUnique({
    where: { id: billId },
    include: { vendor: true, payments: true },
  });
  if (!bill) return fail("That bill no longer exists.");

  if (bill.status !== "APPROVED") {
    return fail(
      `Only an approved bill can be paid — this one is ${BILL_STATUS_META[bill.status].label.toLowerCase()}.`,
    );
  }

  const livePayment = bill.payments.find(
    (payment) => payment.status !== "FAILED",
  );
  if (livePayment) {
    return fail(
      "This bill already has a payment. A bill is settled by a single full payment.",
    );
  }

  // The precondition that actually bites in practice: you cannot send money to
  // a vendor you have no rail for.
  const missing = missingVendorPaymentDetails(bill.vendor, method);
  if (missing) return fail(missing.message);

  const reference = paymentReference(method);

  try {
    await db.$transaction(async (tx) => {
      // Re-check under the transaction: two clerks scheduling at once must not
      // both succeed.
      const live = await tx.payment.count({
        where: { billId: bill.id, status: { not: "FAILED" } },
      });
      if (live > 0) {
        throw new ActionRefusal("This bill already has a payment.");
      }

      await tx.payment.create({
        data: {
          billId: bill.id,
          amountCents: bill.totalCents,
          method,
          scheduledDate: date,
          status: "SCHEDULED",
          reference,
        },
      });

      await tx.activity.create({
        data: {
          billId: bill.id,
          userId: user.id,
          type: "PAYMENT_SCHEDULED",
          message: `scheduled the payment — ${formatCents(bill.totalCents, { currency: bill.currency })} by ${PAYMENT_METHOD_LABELS[method]} on ${formatDate(date)} (${reference})`,
        },
      });
    });
  } catch (error) {
    return toRefusal(error, "Could not schedule this payment.");
  }

  revalidateBill(billId);

  return succeed(
    `Payment scheduled for ${formatDate(date)} by ${PAYMENT_METHOD_LABELS[method]}. The bill stays approved until it clears.`,
  );
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

/** Send the payment to the rail: SCHEDULED → INITIATED. The bill does not move. */
export async function initiatePayment(paymentId: string): Promise<ActionResult> {
  const user = await getCurrentUser();

  const denied = refuseUnlessPayer(user.role);
  if (denied) return denied;

  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { bill: true },
  });
  if (!payment) return fail("That payment no longer exists.");

  try {
    assertPaymentTransition(payment.status, "INITIATED");

    await db.$transaction(async (tx) => {
      const moved = await tx.payment.updateMany({
        where: { id: payment.id, status: "SCHEDULED" },
        data: { status: "INITIATED", initiatedAt: new Date() },
      });
      if (moved.count !== 1) {
        throw new ActionRefusal(
          "This payment changed while you were sending it. Reload and try again.",
        );
      }

      await tx.activity.create({
        data: {
          billId: payment.billId,
          userId: user.id,
          type: "UPDATED",
          message: `initiated the payment by ${PAYMENT_METHOD_LABELS[payment.method]}${payment.reference ? ` (${payment.reference})` : ""} — in transit to the vendor`,
        },
      });
    });
  } catch (error) {
    return toRefusal(error, "Could not initiate this payment.");
  }

  revalidateBill(payment.billId);

  return succeed("Payment initiated — in transit. The bill is not paid yet.");
}

/**
 * Complete the payment (simulated — there is no real rail behind it).
 *
 * This is the ONLY action that marks a bill PAID, and it does so through
 * `assertTransition`, after moving the Payment to PAID. Both writes share one
 * transaction so a bill can never read as paid without a completed payment.
 */
export async function completePayment(paymentId: string): Promise<ActionResult> {
  const user = await getCurrentUser();

  const denied = refuseUnlessPayer(user.role);
  if (denied) return denied;

  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { bill: true },
  });
  if (!payment) return fail("That payment no longer exists.");

  if (isPaymentSettled(payment.status)) {
    return fail("This payment has already been settled.");
  }

  try {
    assertPaymentTransition(payment.status, "PAID");
    assertTransition(payment.bill.status, "PAID");

    await db.$transaction(async (tx) => {
      const now = new Date();

      const moved = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: { in: ["SCHEDULED", "INITIATED"] },
        },
        data: {
          status: "PAID",
          completedAt: now,
          initiatedAt: payment.initiatedAt ?? now,
        },
      });
      if (moved.count !== 1) {
        throw new ActionRefusal(
          "This payment changed while you were completing it. Reload and try again.",
        );
      }

      const billMoved = await tx.bill.updateMany({
        where: { id: payment.billId, status: "APPROVED" },
        data: { status: "PAID" },
      });
      if (billMoved.count !== 1) {
        throw new ActionRefusal(
          "This bill changed while you were completing the payment. Reload and try again.",
        );
      }

      await tx.activity.create({
        data: {
          billId: payment.billId,
          userId: user.id,
          type: "PAID",
          message: `marked the payment as completed — ${formatCents(payment.amountCents, { currency: payment.bill.currency })}${payment.reference ? ` (${payment.reference})` : ""}`,
        },
      });
    });
  } catch (error) {
    return toRefusal(error, "Could not complete this payment.");
  }

  revalidateBill(payment.billId);

  return succeed("Payment completed. The bill is now paid.");
}

/**
 * Mark the payment FAILED with a reason.
 *
 * The bill deliberately does NOT move: a failed payment leaves an approved,
 * unpaid bill, which is exactly the state someone has to act on. A replacement
 * payment can then be scheduled.
 */
export async function failPayment(
  paymentId: string,
  reason: string,
): Promise<ActionResult> {
  const user = await getCurrentUser();

  const denied = refuseUnlessPayer(user.role);
  if (denied) return denied;

  const trimmedReason = reason?.trim() ?? "";
  if (trimmedReason.length === 0) {
    return fail("Say why the payment failed — it is what the retry acts on.");
  }

  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return fail("That payment no longer exists.");

  try {
    assertPaymentTransition(payment.status, "FAILED");

    await db.$transaction(async (tx) => {
      const moved = await tx.payment.updateMany({
        where: { id: payment.id, status: { in: ["SCHEDULED", "INITIATED"] } },
        data: { status: "FAILED" },
      });
      if (moved.count !== 1) {
        throw new ActionRefusal(
          "This payment changed while you were updating it. Reload and try again.",
        );
      }

      // There is no PAYMENT_FAILED activity type in the schema (owned by the
      // foundation), so the audit trail records it as an UPDATE that names what
      // happened rather than inventing a type.
      await tx.activity.create({
        data: {
          billId: payment.billId,
          userId: user.id,
          type: "UPDATED",
          message: `marked the payment as failed${payment.reference ? ` (${payment.reference})` : ""}: ${trimmedReason}`,
        },
      });
    });
  } catch (error) {
    return toRefusal(error, "Could not mark this payment as failed.");
  }

  revalidateBill(payment.billId);

  return succeed(
    "Payment marked as failed. The bill stays approved so a new payment can be scheduled.",
  );
}
