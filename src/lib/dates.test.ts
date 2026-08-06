import { describe, expect, it } from "vitest";

import {
  PAYMENT_TERMS_DAYS,
  addDays,
  agingBucket,
  daysBetween,
  daysOverdue,
  daysUntilDue,
  dueDateFrom,
  isOverdue,
  startOfUtcDay,
  toDateInputValue,
} from "@/lib/dates";
import { PAYMENT_TERMS } from "@/lib/domain";

/**
 * Dates are UTC-day arithmetic here, never local time and never fractions of a
 * day — so every case below passes an explicit `asOf` and stays deterministic
 * whatever timezone the machine is in.
 */

const ISSUE = new Date("2026-03-01T00:00:00.000Z");

// ---------------------------------------------------------------------------
// dueDateFrom
// ---------------------------------------------------------------------------

describe("dueDateFrom", () => {
  const expected: Record<string, string> = {
    DUE_ON_RECEIPT: "2026-03-01",
    NET_15: "2026-03-16",
    NET_30: "2026-03-31",
    NET_45: "2026-04-15",
    NET_60: "2026-04-30",
    NET_90: "2026-05-30",
  };

  for (const terms of PAYMENT_TERMS) {
    it(`adds ${PAYMENT_TERMS_DAYS[terms]} days for ${terms}`, () => {
      expect(toDateInputValue(dueDateFrom(ISSUE, terms))).toBe(expected[terms]);
    });
  }

  it("drops the time component of the issue date", () => {
    const lateInTheDay = new Date("2026-03-01T23:59:59.999Z");

    expect(dueDateFrom(lateInTheDay, "NET_30").toISOString()).toBe(
      "2026-03-31T00:00:00.000Z",
    );
  });

  it("crosses month and leap-year boundaries by calendar day", () => {
    expect(
      toDateInputValue(dueDateFrom(new Date("2028-02-01T00:00:00.000Z"), "NET_30")),
    ).toBe("2028-03-02"); // 2028 is a leap year: Feb has 29 days.
    expect(
      toDateInputValue(dueDateFrom(new Date("2026-12-15T00:00:00.000Z"), "NET_30")),
    ).toBe("2027-01-14");
  });
});

// ---------------------------------------------------------------------------
// Day arithmetic
// ---------------------------------------------------------------------------

describe("day arithmetic", () => {
  it("normalises to UTC midnight", () => {
    expect(startOfUtcDay(new Date("2026-03-14T18:30:00.000Z")).toISOString()).toBe(
      "2026-03-14T00:00:00.000Z",
    );
  });

  it("counts whole calendar days between two instants", () => {
    expect(
      daysBetween(
        new Date("2026-03-01T23:00:00.000Z"),
        new Date("2026-03-02T01:00:00.000Z"),
      ),
    ).toBe(1);
    expect(daysBetween(ISSUE, ISSUE)).toBe(0);
    expect(daysBetween(new Date("2026-03-10T00:00:00.000Z"), ISSUE)).toBe(-9);
  });

  it("adds days without touching the time component", () => {
    expect(addDays(ISSUE, 30).toISOString()).toBe("2026-03-31T00:00:00.000Z");
    expect(addDays(ISSUE, -1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("never reports a negative overdue count", () => {
    const due = new Date("2026-03-31T00:00:00.000Z");

    expect(daysOverdue(due, new Date("2026-03-20T00:00:00.000Z"))).toBe(0);
    expect(daysOverdue(due, due)).toBe(0);
    expect(daysOverdue(due, new Date("2026-04-05T00:00:00.000Z"))).toBe(5);
    expect(isOverdue(due, due)).toBe(false);
    expect(isOverdue(due, new Date("2026-04-01T00:00:00.000Z"))).toBe(true);
  });

  it("counts down to the due date and then goes negative", () => {
    const due = new Date("2026-03-31T00:00:00.000Z");

    expect(daysUntilDue(due, new Date("2026-03-30T00:00:00.000Z"))).toBe(1);
    expect(daysUntilDue(due, due)).toBe(0);
    expect(daysUntilDue(due, new Date("2026-04-02T00:00:00.000Z"))).toBe(-2);
  });
});

// ---------------------------------------------------------------------------
// agingBucket — checked exactly on every boundary
// ---------------------------------------------------------------------------

describe("agingBucket", () => {
  const due = new Date("2026-03-01T00:00:00.000Z");

  /** `asOf` = the due date plus N days overdue. */
  const asOf = (overdueDays: number) => addDays(due, overdueDays);

  const boundaries: Array<[number, string]> = [
    [-1, "CURRENT"],
    [0, "CURRENT"],
    [1, "D1_30"],
    [30, "D1_30"],
    [31, "D31_60"],
    [60, "D31_60"],
    [61, "D61_90"],
    [90, "D61_90"],
    [91, "D90_PLUS"],
    [365, "D90_PLUS"],
  ];

  for (const [overdueDays, bucket] of boundaries) {
    it(`puts ${overdueDays} days overdue in ${bucket}`, () => {
      expect(agingBucket(due, asOf(overdueDays))).toBe(bucket);
    });
  }

  it("treats a bill due far in the future as current", () => {
    expect(agingBucket(new Date("2027-01-01T00:00:00.000Z"), due)).toBe("CURRENT");
  });
});
