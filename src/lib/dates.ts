import type { PaymentTerms } from "@/lib/domain";

/**
 * Date helpers for the AP domain.
 *
 * Everything here is UTC-day based: a bill is "overdue by N days" as a whole
 * number of calendar days, never a fraction. Server and client must agree, so
 * we normalise to UTC midnight before comparing and format with a fixed locale.
 *
 * PURE MODULE: no Prisma, no React, no `next/*`.
 */

/** Aging buckets used by the AP Aging report. */
export type AgingBucket =
  | "CURRENT"
  | "D1_30"
  | "D31_60"
  | "D61_90"
  | "D90_PLUS";

export const AGING_BUCKETS: readonly AgingBucket[] = [
  "CURRENT",
  "D1_30",
  "D31_60",
  "D61_90",
  "D90_PLUS",
] as const;

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  CURRENT: "Current",
  D1_30: "1–30 days",
  D31_60: "31–60 days",
  D61_90: "61–90 days",
  D90_PLUS: "90+ days",
};

/** Net days added to the issue date for each payment term. */
export const PAYMENT_TERMS_DAYS: Record<PaymentTerms, number> = {
  DUE_ON_RECEIPT: 0,
  NET_15: 15,
  NET_30: 30,
  NET_45: 45,
  NET_60: 60,
  NET_90: 90,
};

export const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  DUE_ON_RECEIPT: "Due on receipt",
  NET_15: "Net 15",
  NET_30: "Net 30",
  NET_45: "Net 45",
  NET_60: "Net 60",
  NET_90: "Net 90",
};

/** Strip the time component, in UTC. */
export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** Today at UTC midnight. Single source of "now" for the whole domain. */
export function todayUtc(): Date {
  return startOfUtcDay(new Date());
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Whole calendar days between two dates (b - a). */
export function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round(
    (startOfUtcDay(b).getTime() - startOfUtcDay(a).getTime()) / MS_PER_DAY,
  );
}

/** Derive the due date from the issue date and the agreed payment terms. */
export function dueDateFrom(issueDate: Date, terms: PaymentTerms): Date {
  return addDays(startOfUtcDay(issueDate), PAYMENT_TERMS_DAYS[terms]);
}

/**
 * Days a bill is past due. 0 when it is not due yet (never negative), so
 * callers can use it directly as an "overdue by" figure.
 */
export function daysOverdue(dueDate: Date, asOf: Date = todayUtc()): number {
  return Math.max(0, daysBetween(dueDate, asOf));
}

/** Days remaining until the due date. Negative once overdue. */
export function daysUntilDue(dueDate: Date, asOf: Date = todayUtc()): number {
  return daysBetween(asOf, dueDate);
}

export function isOverdue(dueDate: Date, asOf: Date = todayUtc()): boolean {
  return daysOverdue(dueDate, asOf) > 0;
}

/** Classify an outstanding bill into an AP aging bucket. */
export function agingBucket(
  dueDate: Date,
  asOf: Date = todayUtc(),
): AgingBucket {
  const overdue = daysOverdue(dueDate, asOf);
  if (overdue <= 0) return "CURRENT";
  if (overdue <= 30) return "D1_30";
  if (overdue <= 60) return "D31_60";
  if (overdue <= 90) return "D61_90";
  return "D90_PLUS";
}

// ---------------------------------------------------------------------------
// Formatting — fixed locale + UTC so SSR and the client never disagree.
// ---------------------------------------------------------------------------

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const SHORT_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

/** "Mar 14, 2026" */
export function formatDate(date: Date | string): string {
  return DATE_FORMAT.format(toDate(date));
}

/** "Mar 14" */
export function formatShortDate(date: Date | string): string {
  return SHORT_DATE_FORMAT.format(toDate(date));
}

/** "Mar 14, 2026, 9:41 AM" */
export function formatDateTime(date: Date | string): string {
  return DATE_TIME_FORMAT.format(toDate(date));
}

/** "yyyy-MM-dd" — the value shape `<input type="date">` expects. */
export function toDateInputValue(date: Date | string): string {
  return toDate(date).toISOString().slice(0, 10);
}

/** Parse a "yyyy-MM-dd" input value into a UTC-midnight Date. */
export function fromDateInputValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Human due-date phrasing for list rows: "Due in 5 days", "Due today",
 * "Overdue by 12 days".
 */
export function formatDueDistance(
  dueDate: Date | string,
  asOf: Date = todayUtc(),
): string {
  const days = daysUntilDue(toDate(dueDate), asOf);
  if (days === 0) return "Due today";
  if (days > 0) return `Due in ${days} ${plural(days, "day")}`;
  const overdue = Math.abs(days);
  return `Overdue by ${overdue} ${plural(overdue, "day")}`;
}

/** "2 hours ago", "3 days ago" — for the activity feed. */
export function formatRelativeTime(date: Date | string, asOf = new Date()): string {
  const target = toDate(date);
  const seconds = Math.round((asOf.getTime() - target.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${plural(minutes, "minute")} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, "hour")} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${plural(days, "day")} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} ${plural(months, "month")} ago`;
  const years = Math.round(months / 12);
  return `${years} ${plural(years, "year")} ago`;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
