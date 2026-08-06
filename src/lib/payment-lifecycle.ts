import type { PaymentMethod, PaymentStatus } from "@/lib/domain";

/**
 * The PAYMENT state machine and its preconditions.
 *
 * A Payment is a separate entity from the Bill with its own lifecycle
 * (ADR 0002): `SCHEDULED → INITIATED → PAID | FAILED`. The bill has no
 * `SCHEDULED` status — a scheduled payment is an APPROVED bill that owns a
 * Payment in status SCHEDULED.
 *
 * PURE MODULE: no Prisma, no React, no `next/*`. Imported by both
 * `src/server/actions/payments.ts` and `payment-panel.tsx` so the actions the
 * UI offers and the moves the server accepts come from one table.
 *
 * It mirrors `src/lib/bill-status.ts` deliberately and lives beside it in the
 * functional core.
 */

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export const PAYMENT_TRANSITIONS: Record<
  PaymentStatus,
  readonly PaymentStatus[]
> = {
  // A payment can be completed straight from SCHEDULED (a check handed over in
  // person) or walked through INITIATED, which is what an ACH file does.
  SCHEDULED: ["INITIATED", "PAID", "FAILED"],
  INITIATED: ["PAID", "FAILED"],
  PAID: [],
  FAILED: [],
} as const;

export function canTransitionPayment(
  from: PaymentStatus,
  to: PaymentStatus,
): boolean {
  return (PAYMENT_TRANSITIONS[from] ?? []).includes(to);
}

export class InvalidPaymentTransitionError extends Error {
  readonly from: PaymentStatus;
  readonly to: PaymentStatus;

  constructor(from: PaymentStatus, to: PaymentStatus) {
    super(
      `Cannot move a payment from ${PAYMENT_STATUS_LABELS[from]} to ${PAYMENT_STATUS_LABELS[to]}.`,
    );
    this.name = "InvalidPaymentTransitionError";
    this.from = from;
    this.to = to;
  }
}

/** Enforce the payment state machine. MUST be called before every write. */
export function assertPaymentTransition(
  from: PaymentStatus,
  to: PaymentStatus,
): void {
  if (!canTransitionPayment(from, to)) {
    throw new InvalidPaymentTransitionError(from, to);
  }
}

/** A payment in a terminal state no longer settles the bill or blocks a retry. */
export function isPaymentSettled(status: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[status].length === 0;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  SCHEDULED: "Scheduled",
  INITIATED: "Initiated",
  PAID: "Paid",
  FAILED: "Failed",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  ACH: "ACH transfer",
  CHECK: "Paper check",
  CARD: "Virtual card",
  WIRE: "Wire transfer",
};

/** Short helper text shown next to the method picker. */
export const PAYMENT_METHOD_HINTS: Record<PaymentMethod, string> = {
  ACH: "Bank transfer, arrives in 1–3 business days.",
  CHECK: "Printed and mailed to the vendor's remittance address.",
  CARD: "A single-use card number is emailed to the vendor.",
  WIRE: "Same-day settlement, for large or urgent payments.",
};

// ---------------------------------------------------------------------------
// Vendor payment details — the precondition for scheduling
// ---------------------------------------------------------------------------

/** The vendor fields a payment method needs. Structural, so a Prisma `Vendor`
 *  satisfies it without this module importing Prisma. */
export interface VendorPaymentDetailsLike {
  name: string;
  bankName?: string | null;
  accountLast4?: string | null;
  routingLast4?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  email?: string | null;
}

type VendorDetailField = keyof Omit<VendorPaymentDetailsLike, "name">;

const DETAIL_LABELS: Record<VendorDetailField, string> = {
  bankName: "bank name",
  accountLast4: "bank account number",
  routingLast4: "routing number",
  addressLine1: "street address",
  city: "city",
  state: "state",
  postalCode: "postal code",
  email: "email address",
};

/** What each rail actually needs before money can move. */
const REQUIRED_DETAILS: Record<PaymentMethod, readonly VendorDetailField[]> = {
  ACH: ["bankName", "accountLast4", "routingLast4"],
  WIRE: ["bankName", "accountLast4", "routingLast4"],
  CHECK: ["addressLine1", "city", "state", "postalCode"],
  CARD: ["email"],
};

export interface MissingVendorDetails {
  method: PaymentMethod;
  /** Human labels of the missing fields, e.g. ["routing number"]. */
  missing: string[];
  /** Ready-to-render sentence naming the vendor and what it is missing. */
  message: string;
}

/**
 * Which payment details the vendor is missing for `method` — or `null` when it
 * has everything the rail needs.
 */
export function missingVendorPaymentDetails(
  vendor: VendorPaymentDetailsLike,
  method: PaymentMethod,
): MissingVendorDetails | null {
  const missingFields = REQUIRED_DETAILS[method].filter((field) => {
    const value = vendor[field];
    return typeof value !== "string" || value.trim() === "";
  });

  if (missingFields.length === 0) return null;

  const missing = missingFields.map((field) => DETAIL_LABELS[field]);
  return {
    method,
    missing,
    message: `${vendor.name} cannot be paid by ${PAYMENT_METHOD_LABELS[method]} yet — missing ${formatList(missing)}. Add the payment details on the vendor, then schedule the payment.`,
  };
}

/** The methods this vendor can actually be paid by today. */
export function availablePaymentMethods(
  vendor: VendorPaymentDetailsLike,
  methods: readonly PaymentMethod[],
): PaymentMethod[] {
  return methods.filter(
    (method) => missingVendorPaymentDetails(vendor, method) === null,
  );
}

function formatList(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Reference numbers — simulated, no real rail
// ---------------------------------------------------------------------------

const REFERENCE_PREFIX: Record<PaymentMethod, string> = {
  ACH: "ACH",
  CHECK: "CHK",
  CARD: "CARD",
  WIRE: "WIRE",
};

/** "ACH-482913" — the same shape the seed uses, so demo data reads uniformly. */
export function paymentReference(method: PaymentMethod): string {
  const suffix = Math.floor(Math.random() * 900_000) + 100_000;
  return `${REFERENCE_PREFIX[method]}-${suffix}`;
}

