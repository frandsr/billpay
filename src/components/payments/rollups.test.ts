import { describe, expect, it } from "vitest";

import {
  countBySection,
  formatDayDistance,
  groupPaymentsByScheduledDate,
  scheduleBand,
  summarisePaymentRegister,
  totalCents,
  type RegisterPaymentLike,
} from "@/components/payments/rollups";

/** Fixed "today" so every expectation is a whole number of days from it. */
const TODAY = new Date("2026-08-06T00:00:00.000Z");

function utc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function payment(
  overrides: Partial<RegisterPaymentLike> = {},
): RegisterPaymentLike {
  return {
    amountCents: 100_00,
    status: "SCHEDULED",
    scheduledDate: utc("2026-08-13"),
    completedAt: null,
    ...overrides,
  };
}

describe("summarisePaymentRegister", () => {
  it("returns zeroes for an empty register", () => {
    const totals = summarisePaymentRegister([], TODAY);

    expect(totals.scheduledCents).toBe(0);
    expect(totals.inFlightCents).toBe(0);
    expect(totals.paidThisMonthCents).toBe(0);
    expect(totals.failedCents).toBe(0);
    expect(totals.nextScheduledDate).toBeNull();
    expect(totals.committedCents).toBe(0);
  });

  it("keeps the four lifecycle figures separate", () => {
    const totals = summarisePaymentRegister(
      [
        payment({ status: "SCHEDULED", amountCents: 1_000 }),
        payment({ status: "SCHEDULED", amountCents: 2_000 }),
        payment({ status: "INITIATED", amountCents: 400 }),
        payment({
          status: "PAID",
          amountCents: 900,
          completedAt: utc("2026-08-03"),
        }),
        payment({ status: "FAILED", amountCents: 700 }),
      ],
      TODAY,
    );

    expect(totals.scheduledCents).toBe(3_000);
    expect(totals.scheduledCount).toBe(2);
    expect(totals.inFlightCents).toBe(400);
    expect(totals.inFlightCount).toBe(1);
    expect(totals.paidThisMonthCents).toBe(900);
    expect(totals.paidThisMonthCount).toBe(1);
    expect(totals.failedCents).toBe(700);
    expect(totals.failedCount).toBe(1);
  });

  it("counts as committed only what has not left the bank yet", () => {
    const totals = summarisePaymentRegister(
      [
        payment({ status: "SCHEDULED", amountCents: 1_000 }),
        payment({ status: "INITIATED", amountCents: 500 }),
        payment({
          status: "PAID",
          amountCents: 9_999,
          completedAt: utc("2026-08-01"),
        }),
        payment({ status: "FAILED", amountCents: 8_888 }),
      ],
      TODAY,
    );

    expect(totals.committedCents).toBe(1_500);
  });

  it("counts only settlements inside the calendar month of `asOf`", () => {
    const totals = summarisePaymentRegister(
      [
        payment({
          status: "PAID",
          amountCents: 100,
          completedAt: utc("2026-08-01"),
        }),
        payment({
          status: "PAID",
          amountCents: 200,
          completedAt: utc("2026-08-31"),
        }),
        payment({
          status: "PAID",
          amountCents: 400,
          completedAt: utc("2026-07-31"),
        }),
        payment({
          status: "PAID",
          amountCents: 800,
          completedAt: utc("2026-09-01"),
        }),
        // Same month, but a year out.
        payment({
          status: "PAID",
          amountCents: 1_600,
          completedAt: utc("2025-08-10"),
        }),
      ],
      TODAY,
    );

    expect(totals.paidThisMonthCents).toBe(300);
    expect(totals.paidThisMonthCount).toBe(2);
  });

  it("falls back to the send date when a paid payment has no completion date", () => {
    const totals = summarisePaymentRegister(
      [
        payment({
          status: "PAID",
          amountCents: 550,
          scheduledDate: utc("2026-08-04"),
          completedAt: null,
        }),
      ],
      TODAY,
    );

    expect(totals.paidThisMonthCents).toBe(550);
  });

  it("flags scheduled payments whose send date has passed", () => {
    const totals = summarisePaymentRegister(
      [
        payment({ status: "SCHEDULED", scheduledDate: utc("2026-08-04") }),
        payment({ status: "SCHEDULED", scheduledDate: utc("2026-08-06") }),
        payment({ status: "SCHEDULED", scheduledDate: utc("2026-08-20") }),
        // An initiated payment keeps its original send date; it is in transit,
        // not late, so it must never count as overdue.
        payment({ status: "INITIATED", scheduledDate: utc("2026-07-01") }),
      ],
      TODAY,
    );

    expect(totals.overdueScheduledCount).toBe(1);
  });

  it("reports the soonest send date still scheduled", () => {
    const totals = summarisePaymentRegister(
      [
        payment({ status: "SCHEDULED", scheduledDate: utc("2026-08-29") }),
        payment({ status: "SCHEDULED", scheduledDate: utc("2026-08-13") }),
        payment({ status: "INITIATED", scheduledDate: utc("2026-07-31") }),
      ],
      TODAY,
    );

    expect(totals.nextScheduledDate?.toISOString().slice(0, 10)).toBe(
      "2026-08-13",
    );
  });
});

describe("countBySection", () => {
  it("counts every section, including the ones that are empty", () => {
    const counts = countBySection([
      payment({ status: "SCHEDULED" }),
      payment({ status: "SCHEDULED" }),
      payment({ status: "PAID", completedAt: utc("2026-08-01") }),
    ]);

    expect(counts.scheduled).toBe(2);
    expect(counts.inflight).toBe(0);
    expect(counts.completed).toBe(1);
    expect(counts.failed).toBe(0);
    expect(counts.all).toBe(3);
  });
});

describe("totalCents", () => {
  it("sums integer minor units and is safe on an empty list", () => {
    expect(totalCents([])).toBe(0);
    expect(totalCents([{ amountCents: 1_250 }, { amountCents: 99 }])).toBe(
      1_349,
    );
  });
});

describe("formatDayDistance", () => {
  it("words the near days as words, not as counts", () => {
    expect(formatDayDistance(utc("2026-08-06"), TODAY)).toBe("today");
    expect(formatDayDistance(utc("2026-08-07"), TODAY)).toBe("tomorrow");
    expect(formatDayDistance(utc("2026-08-05"), TODAY)).toBe("yesterday");
  });

  it("counts days forward and backward", () => {
    expect(formatDayDistance(utc("2026-08-13"), TODAY)).toBe("in 7 days");
    expect(formatDayDistance(utc("2026-07-30"), TODAY)).toBe("7 days ago");
  });
});

describe("scheduleBand", () => {
  it("puts a send date that has passed in its own band", () => {
    expect(scheduleBand(utc("2026-08-05"), TODAY)).toBe("PAST_DUE");
  });

  it("separates today, this week, next week and later", () => {
    expect(scheduleBand(utc("2026-08-06"), TODAY)).toBe("TODAY");
    expect(scheduleBand(utc("2026-08-07"), TODAY)).toBe("THIS_WEEK");
    expect(scheduleBand(utc("2026-08-12"), TODAY)).toBe("THIS_WEEK");
    expect(scheduleBand(utc("2026-08-13"), TODAY)).toBe("NEXT_WEEK");
    expect(scheduleBand(utc("2026-08-19"), TODAY)).toBe("NEXT_WEEK");
    expect(scheduleBand(utc("2026-08-20"), TODAY)).toBe("LATER");
  });
});

describe("groupPaymentsByScheduledDate", () => {
  it("returns nothing for an empty list", () => {
    expect(groupPaymentsByScheduledDate([], TODAY)).toEqual([]);
  });

  it("groups by calendar day, soonest first, with a subtotal per day", () => {
    const groups = groupPaymentsByScheduledDate(
      [
        payment({ scheduledDate: utc("2026-08-29"), amountCents: 300 }),
        payment({ scheduledDate: utc("2026-08-13"), amountCents: 100 }),
        payment({ scheduledDate: utc("2026-08-13"), amountCents: 200 }),
      ],
      TODAY,
    );

    expect(groups.map((group) => group.key)).toEqual([
      "2026-08-13",
      "2026-08-29",
    ]);
    expect(groups[0].count).toBe(2);
    expect(groups[0].totalCents).toBe(300);
    expect(groups[1].count).toBe(1);
    expect(groups[1].totalCents).toBe(300);
  });

  it("ignores the time component so one day is one group", () => {
    const groups = groupPaymentsByScheduledDate(
      [
        payment({ scheduledDate: new Date("2026-08-13T00:00:00.000Z") }),
        payment({ scheduledDate: new Date("2026-08-13T23:59:59.000Z") }),
      ],
      TODAY,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
  });

  it("labels each day with its band and its distance", () => {
    const groups = groupPaymentsByScheduledDate(
      [
        payment({ scheduledDate: utc("2026-08-06") }),
        payment({ scheduledDate: utc("2026-08-13") }),
      ],
      TODAY,
    );

    expect(groups[0].band).toBe("TODAY");
    expect(groups[0].bandLabel).toBe("Today");
    expect(groups[0].distanceLabel).toBe("today");
    expect(groups[1].band).toBe("NEXT_WEEK");
    expect(groups[1].distanceLabel).toBe("in 7 days");
  });
});
