import { describe, expect, it } from "vitest";

import {
  BILL_TRANSITIONS,
  InvalidBillTransitionError,
  allowedTransitions,
  assertTransition,
  canSubmitForApproval,
  canTransition,
  draftReadiness,
  draftReadinessDetail,
  isTerminalStatus,
  type ReadinessBill,
  type ReadinessLineItem,
} from "@/lib/bill-status";
import { BILL_STATUSES, type BillStatus } from "@/lib/domain";

/**
 * The domain rules that decide whether a payable can move — and whether it can
 * move at all. No database, no React: `src/lib/` is the functional core
 * (ADR 0009), so every case here is plain data in, plain data out.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A line coded the ordinary way: its own GL account, no splits. */
function directLine(
  overrides: Partial<ReadinessLineItem> = {},
): ReadinessLineItem {
  return {
    description: "Annual subscription",
    amountCents: 100_000,
    glAccountId: "gl_software",
    splits: [],
    ...overrides,
  };
}

/**
 * A line with NO direct GL account, coded entirely by splits — the shape that
 * used to be permanently unsubmittable.
 */
function splitLine(
  splitAmounts: number[],
  overrides: Partial<ReadinessLineItem> = {},
): ReadinessLineItem {
  return {
    description: "Annual subscription",
    amountCents: 100_000,
    glAccountId: null,
    splits: splitAmounts.map((amountCents, index) => ({
      glAccountId: `gl_${index}`,
      department: null,
      amountCents,
      percentBasisPoints: null,
    })),
    ...overrides,
  };
}

/** A draft that is READY, so each test can break exactly one thing. */
function readyBill(overrides: Partial<ReadinessBill> = {}): ReadinessBill {
  return {
    billNumber: "INV-1042",
    vendorId: "vendor_acme",
    issueDate: new Date("2026-03-01T00:00:00.000Z"),
    dueDate: new Date("2026-03-31T00:00:00.000Z"),
    totalCents: 100_000,
    currency: "USD",
    lineItems: [directLine()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Readiness — coding
// ---------------------------------------------------------------------------

describe("draftReadinessDetail — line item coding", () => {
  it("is READY when a line carries its own GL account", () => {
    const result = draftReadinessDetail(readyBill());

    expect(result.state).toBe("READY");
    expect(result.issues).toEqual([]);
    expect(result.differenceCents).toBe(0);
  });

  it("is READY when a line is coded only by splits that reconcile", () => {
    // The regression this rule exists for: no `glAccountId` at all, but the
    // splits distribute the whole line amount, so the coding IS present.
    const result = draftReadinessDetail(
      readyBill({ lineItems: [splitLine([60_000, 40_000])] }),
    );

    expect(result.issues).toEqual([]);
    expect(result.state).toBe("READY");
  });

  it("is READY when a three-way split reconciles to an odd amount", () => {
    const result = draftReadinessDetail(
      readyBill({
        totalCents: 100_001,
        lineItems: [
          splitLine([33_334, 33_334, 33_333], { amountCents: 100_001 }),
        ],
      }),
    );

    expect(result.state).toBe("READY");
  });

  it("names the delta when splits are under the line amount", () => {
    const result = draftReadinessDetail(
      readyBill({ lineItems: [splitLine([60_000, 34_848])] }),
    );

    expect(result.state).toBe("MISSING_INFO");
    expect(result.issues).toContain("Line 1 splits are under by $51.52");
  });

  it("names the delta when splits are over the line amount", () => {
    const result = draftReadinessDetail(
      readyBill({ lineItems: [splitLine([60_000, 45_152])] }),
    );

    expect(result.state).toBe("MISSING_INFO");
    expect(result.issues).toContain("Line 1 splits are over by $51.52");
  });

  it("points at the offending line when several are split", () => {
    const result = draftReadinessDetail(
      readyBill({
        totalCents: 300_000,
        lineItems: [
          directLine(),
          splitLine([50_000, 50_000]),
          splitLine([50_000, 48_000]),
        ],
      }),
    );

    expect(result.issues).toContain("Line 3 splits are under by $20.00");
    expect(result.issues.filter((issue) => issue.includes("splits"))).toHaveLength(
      1,
    );
  });

  it("reports a split with no GL account against its line", () => {
    const line = splitLine([60_000, 40_000]);
    const splits = [...(line.splits ?? [])];
    splits[1] = { ...splits[1], glAccountId: null };

    const result = draftReadinessDetail(
      readyBill({ lineItems: [{ ...line, splits }] }),
    );

    expect(result.state).toBe("MISSING_INFO");
    expect(result.issues).toContain("Line 1: Split 2 has no GL account.");
  });

  it("counts a line with neither a GL account nor splits as uncoded", () => {
    const result = draftReadinessDetail(
      readyBill({ lineItems: [directLine({ glAccountId: null })] }),
    );

    expect(result.state).toBe("MISSING_INFO");
    expect(result.issues).toContain(
      "Line 1 is not coded — it needs a GL account or a split",
    );
  });

  it("counts every uncoded line and says which ones", () => {
    const result = draftReadinessDetail(
      readyBill({
        totalCents: 300_000,
        lineItems: [
          directLine({ glAccountId: null }),
          splitLine([60_000, 40_000]),
          directLine({ glAccountId: null }),
        ],
      }),
    );

    expect(result.issues).toContain("2 line items are not coded (lines 1, 3)");
  });

  it("still reports a line with splits AND no description", () => {
    const result = draftReadinessDetail(
      readyBill({
        lineItems: [splitLine([60_000, 40_000], { description: "  " })],
      }),
    );

    expect(result.issues).toContain("Line 1 is missing a description");
  });

  it("treats a bill with no line items as not ready", () => {
    const result = draftReadinessDetail(readyBill({ lineItems: [] }));

    expect(result.state).toBe("MISSING_INFO");
    expect(result.issues).toContain("No line items");
  });
});

// ---------------------------------------------------------------------------
// Readiness — reconciliation against the authoritative total
// ---------------------------------------------------------------------------

describe("draftReadinessDetail — line items vs the bill total", () => {
  it("is not ready when the lines fall short of the total", () => {
    const result = draftReadinessDetail(
      readyBill({ totalCents: 150_000, lineItems: [directLine()] }),
    );

    expect(result.state).toBe("MISSING_INFO");
    expect(result.lineItemTotalCents).toBe(100_000);
    expect(result.differenceCents).toBe(-50_000);
    expect(result.issues).toContain(
      "Line items add up to $1,000.00, $500.00 under the bill total of $1,500.00",
    );
  });

  it("is not ready when the lines overshoot the total", () => {
    const result = draftReadinessDetail(
      readyBill({
        totalCents: 100_000,
        lineItems: [directLine(), directLine({ amountCents: 25_000 })],
      }),
    );

    expect(result.differenceCents).toBe(25_000);
    expect(result.issues).toContain(
      "Line items add up to $1,250.00, $250.00 over the bill total of $1,000.00",
    );
  });

  it("renders the delta in the bill's own currency", () => {
    const result = draftReadinessDetail(
      readyBill({ currency: "EUR", totalCents: 150_000 }),
    );

    expect(result.issues.some((issue) => issue.includes("€1,500.00"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Readiness — required header fields
// ---------------------------------------------------------------------------

describe("draftReadinessDetail — required header fields", () => {
  const cases: Array<[string, Partial<ReadinessBill>, string]> = [
    ["no vendor", { vendorId: null }, "No vendor selected"],
    ["a blank bill number", { billNumber: "   " }, "Missing bill number"],
    ["no issue date", { issueDate: null }, "Missing issue date"],
    ["no due date", { dueDate: null }, "Missing due date"],
    ["no total", { totalCents: 0 }, "Missing bill amount"],
  ];

  for (const [label, override, expected] of cases) {
    it(`is not ready with ${label}`, () => {
      const result = draftReadinessDetail(readyBill(override));

      expect(result.state).toBe("MISSING_INFO");
      expect(result.issues).toContain(expected);
    });
  }

  it("lists every missing field at once", () => {
    const result = draftReadinessDetail(
      readyBill({ vendorId: null, billNumber: "", issueDate: null }),
    );

    expect(result.issues).toEqual([
      "No vendor selected",
      "Missing bill number",
      "Missing issue date",
    ]);
  });

  it("survives a completely empty bill", () => {
    const result = draftReadinessDetail({});

    expect(result.state).toBe("MISSING_INFO");
    expect(result.lineItemTotalCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Submission gate
// ---------------------------------------------------------------------------

describe("canSubmitForApproval", () => {
  it("lets a draft coded only by splits through", () => {
    expect(
      canSubmitForApproval({
        ...readyBill({ lineItems: [splitLine([60_000, 40_000])] }),
        status: "DRAFT",
      }),
    ).toBe(true);
  });

  it("blocks a draft whose splits do not reconcile", () => {
    expect(
      canSubmitForApproval({
        ...readyBill({ lineItems: [splitLine([60_000, 39_000])] }),
        status: "DRAFT",
      }),
    ).toBe(false);
  });

  it("blocks any bill that is no longer a draft", () => {
    expect(
      canSubmitForApproval({ ...readyBill(), status: "AWAITING_APPROVAL" }),
    ).toBe(false);
  });

  it("agrees with the readiness shorthand", () => {
    expect(draftReadiness(readyBill())).toBe("READY");
    expect(draftReadiness(readyBill({ vendorId: null }))).toBe("MISSING_INFO");
  });
});

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

describe("bill transitions", () => {
  it("allows every edge in the transition table", () => {
    for (const from of BILL_STATUSES) {
      for (const to of BILL_TRANSITIONS[from]) {
        expect(canTransition(from, to)).toBe(true);
        expect(() => assertTransition(from, to)).not.toThrow();
      }
    }
  });

  it("rejects everything the table does not list", () => {
    for (const from of BILL_STATUSES) {
      const legal = new Set<BillStatus>(BILL_TRANSITIONS[from]);
      for (const to of BILL_STATUSES) {
        if (legal.has(to)) continue;
        expect(canTransition(from, to)).toBe(false);
        expect(() => assertTransition(from, to)).toThrow(
          InvalidBillTransitionError,
        );
      }
    }
  });

  const illegal: Array<[BillStatus, BillStatus]> = [
    ["DRAFT", "PAID"],
    ["DRAFT", "APPROVED"],
    ["DRAFT", "REJECTED"],
    ["DRAFT", "DRAFT"],
    ["AWAITING_APPROVAL", "PAID"],
    ["AWAITING_APPROVAL", "DRAFT"],
    ["APPROVED", "AWAITING_APPROVAL"],
    ["APPROVED", "REJECTED"],
    ["REJECTED", "AWAITING_APPROVAL"],
    ["PAID", "DRAFT"],
    ["PAID", "ARCHIVED"],
    ["PAID", "PAID"],
    ["ARCHIVED", "DRAFT"],
    ["ARCHIVED", "PAID"],
  ];

  for (const [from, to] of illegal) {
    it(`refuses ${from} → ${to}`, () => {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).toThrow(
        InvalidBillTransitionError,
      );
    });
  }

  it("carries the attempted move on the error", () => {
    try {
      assertTransition("DRAFT", "PAID");
      throw new Error("assertTransition should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidBillTransitionError);
      const invalid = error as InvalidBillTransitionError;
      expect(invalid.from).toBe("DRAFT");
      expect(invalid.to).toBe("PAID");
      expect(invalid.message).toBe("Cannot move a bill from Draft to Paid.");
    }
  });

  it("treats PAID and ARCHIVED as the only terminal statuses", () => {
    expect(BILL_STATUSES.filter(isTerminalStatus)).toEqual(["PAID", "ARCHIVED"]);
    expect(allowedTransitions("PAID")).toEqual([]);
    expect(allowedTransitions("DRAFT")).toEqual([
      "AWAITING_APPROVAL",
      "ARCHIVED",
    ]);
  });
});
