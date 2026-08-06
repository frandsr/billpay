/**
 * Domain enums as plain string-literal unions.
 *
 * `src/lib/` is the FUNCTIONAL CORE: pure domain logic that must never import
 * Prisma, React or `next/*`. The only exceptions are `db.ts` (the client
 * singleton) and `current-user.ts` (which needs cookies). Keeping the core free
 * of the generated Prisma client means the domain tests run without a database,
 * without `prisma generate`, and without a DOM.
 *
 * These unions mirror the enums in `prisma/schema.prisma` exactly. They are
 * structurally identical to the types Prisma generates, so values flow between
 * the two without a cast. The compile-time check that keeps them honest lives
 * in `src/server/schema-parity.ts` — the imperative shell is allowed to import
 * Prisma, so that is where the two worlds are pinned together.
 *
 * Add a member to the schema, forget it here, and `pnpm typecheck` fails.
 */

/**
 * Lifecycle of the payable record.
 *
 * NOTE: there is deliberately no `SCHEDULED` member. A scheduled payment is an
 * `APPROVED` bill that owns a `Payment` in status `SCHEDULED` (see ADR 0002).
 */
export const BILL_STATUSES = [
  "DRAFT",
  "AWAITING_APPROVAL",
  "APPROVED",
  "PAID",
  "REJECTED",
  "ARCHIVED",
] as const;

export type BillStatus = (typeof BILL_STATUSES)[number];

/** The Payment's own lifecycle, independent of `BillStatus`. */
export const PAYMENT_STATUSES = [
  "SCHEDULED",
  "INITIATED",
  "PAID",
  "FAILED",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ["ACH", "CHECK", "CARD", "WIRE"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_TERMS = [
  "DUE_ON_RECEIPT",
  "NET_15",
  "NET_30",
  "NET_45",
  "NET_60",
  "NET_90",
] as const;

export type PaymentTerms = (typeof PAYMENT_TERMS)[number];

/** State of a single materialised `ApprovalStep` on a bill. */
export const APPROVAL_STEP_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
] as const;

export type ApprovalStepStatus = (typeof APPROVAL_STEP_STATUSES)[number];
