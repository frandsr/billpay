import { daysBetween, startOfUtcDay, todayUtc } from "@/lib/dates";
import type { PaymentStatus } from "@/lib/domain";
import {
  REGISTER_SECTIONS,
  statusesForSection,
  type RegisterSection,
} from "@/components/payments/payments-filters";

/**
 * The payments register's arithmetic, as pure functions.
 *
 * PURE MODULE: no Prisma, no React, no `next/*` — the inputs are declared
 * structurally, so the rows `@/server/queries/payments.ts` selects satisfy them
 * without this file importing the generated client. That is what makes every
 * figure on the register reachable from a test with no database, exactly as
 * `@/components/dashboard/rollups.ts` does for the landing page.
 *
 * It knows nothing about money movement rules. Which transitions are legal
 * lives in `@/lib/payment-lifecycle`; what the statuses are called lives in
 * `@/lib/bill-status`. This file only counts and buckets.
 */

/** The minimum shape every roll-up here needs. */
export interface RegisterPaymentLike {
  amountCents: number;
  status: PaymentStatus;
  scheduledDate: Date;
  completedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Headline figures
// ---------------------------------------------------------------------------

export interface PaymentRegisterTotals {
  /** Committed to a date, not yet sent. */
  scheduledCents: number;
  scheduledCount: number;
  /** Sent to the bank, not yet landed. */
  inFlightCents: number;
  inFlightCount: number;
  /** Settled within the calendar month of `asOf`. */
  paidThisMonthCents: number;
  paidThisMonthCount: number;
  /** Every failed payment — a vendor that did not get paid. */
  failedCents: number;
  failedCount: number;
  /** Scheduled payments whose send date has already passed. */
  overdueScheduledCount: number;
  /** The next send date among scheduled payments, or null when there is none. */
  nextScheduledDate: Date | null;
  /** Σ of scheduled + in flight: what is still going to leave the bank. */
  committedCents: number;
}

/**
 * The four figures at the top of the register.
 *
 * They are deliberately not one balance: scheduled money can still be stopped,
 * in-flight money cannot, completed money is history, and failed money is work.
 * Adding them together would answer no question anybody asks.
 *
 * "Paid this month" is keyed on `completedAt` — when the money actually reached
 * the vendor — falling back to the send date only for the impossible case of a
 * PAID payment with no completion timestamp, so the figure never silently drops
 * a row.
 */
export function summarisePaymentRegister(
  payments: readonly RegisterPaymentLike[],
  asOf: Date = todayUtc(),
): PaymentRegisterTotals {
  const today = startOfUtcDay(asOf);
  const month = today.getUTCMonth();
  const year = today.getUTCFullYear();

  const totals: PaymentRegisterTotals = {
    scheduledCents: 0,
    scheduledCount: 0,
    inFlightCents: 0,
    inFlightCount: 0,
    paidThisMonthCents: 0,
    paidThisMonthCount: 0,
    failedCents: 0,
    failedCount: 0,
    overdueScheduledCount: 0,
    nextScheduledDate: null,
    committedCents: 0,
  };

  for (const payment of payments) {
    switch (payment.status) {
      case "SCHEDULED": {
        totals.scheduledCents += payment.amountCents;
        totals.scheduledCount += 1;
        if (daysBetween(asOf, payment.scheduledDate) < 0) {
          totals.overdueScheduledCount += 1;
        }
        const date = startOfUtcDay(payment.scheduledDate);
        if (
          totals.nextScheduledDate === null ||
          date.getTime() < totals.nextScheduledDate.getTime()
        ) {
          totals.nextScheduledDate = date;
        }
        break;
      }
      case "INITIATED": {
        totals.inFlightCents += payment.amountCents;
        totals.inFlightCount += 1;
        break;
      }
      case "PAID": {
        const settled = startOfUtcDay(payment.completedAt ?? payment.scheduledDate);
        if (settled.getUTCFullYear() === year && settled.getUTCMonth() === month) {
          totals.paidThisMonthCents += payment.amountCents;
          totals.paidThisMonthCount += 1;
        }
        break;
      }
      case "FAILED": {
        totals.failedCents += payment.amountCents;
        totals.failedCount += 1;
        break;
      }
    }
  }

  totals.committedCents = totals.scheduledCents + totals.inFlightCents;

  return totals;
}

// ---------------------------------------------------------------------------
// Section counts
// ---------------------------------------------------------------------------

/**
 * How many payments each section holds under the current filters.
 *
 * Computed from the set that matches every filter EXCEPT the section and the
 * status narrowing, so a count never promises rows the section cannot show.
 */
export function countBySection(
  payments: readonly RegisterPaymentLike[],
): Record<RegisterSection, number> {
  const counts = Object.fromEntries(
    REGISTER_SECTIONS.map((section) => [section, 0]),
  ) as Record<RegisterSection, number>;

  for (const payment of payments) {
    for (const section of REGISTER_SECTIONS) {
      if (statusesForSection(section).includes(payment.status)) {
        counts[section] += 1;
      }
    }
  }

  return counts;
}

/** Σ of a set of payments, in integer minor units. */
export function totalCents(
  payments: readonly { amountCents: number }[],
): number {
  return payments.reduce((total, payment) => total + payment.amountCents, 0);
}

// ---------------------------------------------------------------------------
// Distance in days — "in 6 days", "3 days ago"
// ---------------------------------------------------------------------------

/**
 * Whole-day distance from `asOf` to `date`, worded for a payment row.
 *
 * Deliberately not `formatDueDistance` from `@/lib/dates`: that one says "Due
 * in 5 days" / "Overdue by 12 days", which is the Bill's vocabulary. A payment
 * is not due — it is sent, and then it lands.
 */
export function formatDayDistance(
  date: Date,
  asOf: Date = todayUtc(),
): string {
  const days = daysBetween(asOf, date);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1) return `in ${days} days`;
  return `${-days} days ago`;
}

// ---------------------------------------------------------------------------
// Grouping upcoming payments by date
// ---------------------------------------------------------------------------

/**
 * How far out a send date sits, so "this week" is legible without reading dates.
 *
 * `PAST_DUE` is not a payment status — it is a scheduled payment whose send date
 * has come and gone, which is a real operational problem the status alone cannot
 * express.
 */
export type ScheduleBand =
  | "PAST_DUE"
  | "TODAY"
  | "THIS_WEEK"
  | "NEXT_WEEK"
  | "LATER";

export const SCHEDULE_BAND_LABELS: Record<ScheduleBand, string> = {
  PAST_DUE: "Past due",
  TODAY: "Today",
  THIS_WEEK: "This week",
  NEXT_WEEK: "Next week",
  LATER: "Later",
};

/** Days from today at which each band starts. `THIS_WEEK` covers days 1–6. */
export const NEXT_WEEK_STARTS_IN_DAYS = 7;
export const LATER_STARTS_IN_DAYS = 14;

export function scheduleBand(
  date: Date,
  asOf: Date = todayUtc(),
): ScheduleBand {
  const days = daysBetween(asOf, date);
  if (days < 0) return "PAST_DUE";
  if (days === 0) return "TODAY";
  if (days < NEXT_WEEK_STARTS_IN_DAYS) return "THIS_WEEK";
  if (days < LATER_STARTS_IN_DAYS) return "NEXT_WEEK";
  return "LATER";
}

export interface PaymentDateGroup<T> {
  /** `yyyy-MM-dd`, stable across renders. */
  key: string;
  date: Date;
  band: ScheduleBand;
  bandLabel: string;
  /** "in 6 days", "today", "3 days ago". */
  distanceLabel: string;
  count: number;
  totalCents: number;
  payments: T[];
}

/**
 * Group payments by their send date, soonest first.
 *
 * One group per calendar day, each tagged with the band it falls in, so a
 * renderer can print "This week" once above the days it covers instead of
 * repeating a relative phrase on every row. Empty days are not invented — a
 * register with nothing scheduled on Wednesday should not show a Wednesday.
 */
export function groupPaymentsByScheduledDate<T extends RegisterPaymentLike>(
  payments: readonly T[],
  asOf: Date = todayUtc(),
): PaymentDateGroup<T>[] {
  const groups = new Map<string, PaymentDateGroup<T>>();

  for (const payment of payments) {
    const date = startOfUtcDay(payment.scheduledDate);
    const key = date.toISOString().slice(0, 10);

    let group = groups.get(key);
    if (!group) {
      const band = scheduleBand(date, asOf);
      group = {
        key,
        date,
        band,
        bandLabel: SCHEDULE_BAND_LABELS[band],
        distanceLabel: formatDayDistance(date, asOf),
        count: 0,
        totalCents: 0,
        payments: [],
      };
      groups.set(key, group);
    }

    group.count += 1;
    group.totalCents += payment.amountCents;
    group.payments.push(payment);
  }

  return [...groups.values()].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
}
