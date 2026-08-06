/**
 * Recurring bill schedules.
 *
 * A recurring bill is a **generator**, not a bill: it owes a DRAFT bill on each
 * occurrence of its cadence, and nothing about the bill lifecycle changes
 * (ADR 0005). This module is the arithmetic of "when is it owed", kept separate
 * from the writing of the drafts so the answer is testable without a database.
 *
 * Everything is **UTC-day based**. A schedule that fires "on the 1st" fires on
 * the 1st for a reviewer in Buenos Aires and one in Berlin — comparing local
 * dates would generate a bill a day early or late depending on who looked.
 *
 * Month-end is clamped, never wrapped: a schedule anchored on the 31st fires on
 * 28 (or 29) February and returns to the 31st in March. The preferred day is
 * remembered on the schedule, so clamping one month never permanently drags the
 * series backwards — which is the classic "billed on the 28th forever" bug.
 *
 * PURE MODULE: no Prisma, no React, no `next/*`. Every function is total.
 */

import { startOfUtcDay, todayUtc } from "@/lib/dates";
import type { RecurringFrequency } from "@/lib/domain";

/** Months advanced by one occurrence of each cadence. */
export const RECURRING_FREQUENCY_MONTHS: Record<RecurringFrequency, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  ANNUALLY: 12,
};

export const RECURRING_FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUALLY: "Annually",
};

/**
 * The shape a persisted `RecurringBill` and an unsaved form both satisfy.
 * Structural on purpose: the schedule maths never needs the vendor, the amount
 * or the line items.
 */
export interface RecurringSchedule {
  frequency: RecurringFrequency;
  /** The next UTC date this schedule owes a bill. */
  nextRunDate: Date;
  /** Preferred day of month (1–31), clamped to the month length. */
  dayOfMonth?: number | null;
  /** A paused schedule owes nothing. Absent means active. */
  active?: boolean | null;
}

/** Days in a UTC month. `monthIndex` is 0-based and may be out of range. */
export function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * The occurrence that follows `from`.
 *
 *   nextOccurrence(2026-01-31, "MONTHLY", 31)  // 2026-02-28  (clamped)
 *   nextOccurrence(2026-02-28, "MONTHLY", 31)  // 2026-03-31  (restored)
 *   nextOccurrence(2026-01-15, "QUARTERLY")    // 2026-04-15
 *
 * Always strictly later than `from`, so any loop over occurrences terminates.
 */
export function nextOccurrence(
  from: Date,
  frequency: RecurringFrequency,
  dayOfMonth?: number | null,
): Date {
  const anchor = startOfUtcDay(from);
  const step = RECURRING_FREQUENCY_MONTHS[frequency] ?? 1;

  // Date.UTC normalises a month index past 11 into the following year.
  const targetMonth = anchor.getUTCMonth() + step;
  const targetYear = anchor.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalisedMonth = ((targetMonth % 12) + 12) % 12;

  const preferred = normaliseDayOfMonth(dayOfMonth) ?? anchor.getUTCDate();
  const day = Math.min(preferred, daysInUtcMonth(targetYear, normalisedMonth));

  return new Date(Date.UTC(targetYear, normalisedMonth, day));
}

/** True when the schedule is active and its next run date has arrived. */
export function isDue(
  schedule: RecurringSchedule,
  today: Date = todayUtc(),
): boolean {
  if (schedule.active === false) return false;
  return (
    startOfUtcDay(schedule.nextRunDate).getTime() <=
    startOfUtcDay(today).getTime()
  );
}

/**
 * Every occurrence the schedule owes as of `today`, oldest first.
 *
 * Usually one. It is a list because a template that was paused, or a demo
 * database seeded weeks ago, can owe several — and generating one bill while
 * silently dropping the rest is the kind of quiet data loss an AP team finds
 * out about at month end.
 *
 * Returns `[]` for a paused schedule or one whose next run is in the future.
 * `limit` is a safety cap on pathological inputs, not a business rule.
 */
export function dueOccurrences(
  schedule: RecurringSchedule,
  today: Date = todayUtc(),
  limit = 60,
): Date[] {
  if (schedule.active === false) return [];

  const end = startOfUtcDay(today).getTime();
  const occurrences: Date[] = [];
  let cursor = startOfUtcDay(schedule.nextRunDate);

  while (cursor.getTime() <= end && occurrences.length < limit) {
    occurrences.push(cursor);
    cursor = nextOccurrence(cursor, schedule.frequency, schedule.dayOfMonth);
  }

  return occurrences;
}

/**
 * The `nextRunDate` to store after generating everything currently due.
 *
 * Derived from the same walk as `dueOccurrences`, so "generate now" can never
 * leave a schedule pointing at a date it already generated (a duplicate bill on
 * the next run) or skip past one it never generated.
 */
export function nextRunDateAfter(
  schedule: RecurringSchedule,
  today: Date = todayUtc(),
): Date {
  const due = dueOccurrences(schedule, today);
  const last = due.at(-1);
  if (!last) return startOfUtcDay(schedule.nextRunDate);
  return nextOccurrence(last, schedule.frequency, schedule.dayOfMonth);
}

/**
 * The next `count` occurrences from the schedule's current position, for the
 * "next runs" preview on a template. Includes `nextRunDate` itself.
 */
export function upcomingOccurrences(
  schedule: RecurringSchedule,
  count = 3,
): Date[] {
  if (count <= 0) return [];

  const occurrences: Date[] = [startOfUtcDay(schedule.nextRunDate)];
  while (occurrences.length < count) {
    occurrences.push(
      nextOccurrence(
        occurrences[occurrences.length - 1],
        schedule.frequency,
        schedule.dayOfMonth,
      ),
    );
  }
  return occurrences;
}

/** Clamp a user-supplied day of month into 1–31, or `null` when unusable. */
function normaliseDayOfMonth(dayOfMonth?: number | null): number | null {
  if (dayOfMonth === null || dayOfMonth === undefined) return null;
  if (!Number.isFinite(dayOfMonth)) return null;
  return Math.min(31, Math.max(1, Math.trunc(dayOfMonth)));
}
