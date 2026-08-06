/**
 * The wire contract between the recurring-bill UI and its server actions.
 *
 * Everything that crosses the boundary is a plain, serialisable value: money
 * and quantities travel as the raw strings the user typed, dates as
 * "yyyy-MM-dd". The SERVER is what turns them into integer cents and UTC dates,
 * because a client that parses its own money is a client that can be lied to —
 * keeping the parse server-side means the validation the action performs is the
 * validation that actually happened.
 *
 * PURE MODULE: types and option lists only, so both the client form and the
 * server action can import it without dragging Prisma into the browser bundle.
 */

import type { PaymentTerms, RecurringFrequency } from "@/lib/domain";

/** Currencies `formatCents` knows how to render (see `src/lib/money.ts`). */
export const SUPPORTED_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "MXN",
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/** Mirrors the `LineType` enum in `prisma/schema.prisma`. */
export const LINE_TYPES = ["EXPENSE", "ITEM"] as const;

export type RecurringLineType = (typeof LINE_TYPES)[number];

export const LINE_TYPE_LABELS: Record<RecurringLineType, string> = {
  EXPENSE: "Expense",
  ITEM: "Item",
};

/**
 * One coded template line. The GL account and department are the whole point:
 * they are what makes the generated draft arrive already coded instead of
 * arriving as data entry.
 */
export interface RecurringLineInput {
  description: string;
  /** Whole units, e.g. "42". Parsed server-side. */
  quantity: string;
  /** Raw user input, e.g. "$1,280.00". Parsed to integer cents server-side. */
  unitPrice: string;
  /** `null` leaves the line uncoded — the generated draft is then `Missing info`. */
  glAccountId: string | null;
  department: string | null;
  lineType: RecurringLineType;
}

export interface RecurringBillInput {
  vendorId: string;
  name: string;
  /** Raw user input. Authoritative amount of each generated bill. */
  amount: string;
  currency: string;
  paymentTerms: PaymentTerms;
  memo: string;
  frequency: RecurringFrequency;
  /** "yyyy-MM-dd" — the next UTC date this template owes a bill. */
  nextRunDate: string;
  /** "" when the day of month is implied by `nextRunDate`. */
  dayOfMonth: string;
  active: boolean;
  lineItems: RecurringLineInput[];
}

/**
 * Field-scoped validation messages. Line item fields are addressed positionally
 * as `lineItems.<index>.<field>` so the form can put the message on the row that
 * caused it.
 */
export type FieldErrors = Record<string, string>;

/**
 * Server actions never throw at the UI. They return a result the caller can
 * render, so a validation failure and a success take the same code path.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

/** What one "generate" run did, in numbers the UI can put in a toast. */
export interface GenerationSummary {
  /** Templates that owed at least one occurrence. */
  templatesProcessed: number;
  billsCreated: number;
  /**
   * Occurrences that were already generated and were therefore skipped. A
   * non-zero value here is the idempotency guard doing its job, not an error.
   */
  alreadyGenerated: number;
  createdBillIds: string[];
}

/** An empty summary, so callers can return early without special-casing. */
export const EMPTY_GENERATION_SUMMARY: GenerationSummary = {
  templatesProcessed: 0,
  billsCreated: 0,
  alreadyGenerated: 0,
  createdBillIds: [],
};
