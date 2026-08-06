import { describe, expect, it } from "vitest";

import {
  BASIS_POINTS_TOTAL,
  applyAllocationTemplate,
  basisPointsOf,
  distributeByBasisPoints,
  formatBasisPoints,
  splitsAreValid,
  splitsReconcile,
  sumSplitCents,
  validateSplits,
  type SplitLike,
} from "@/lib/splits";

/**
 * Splitting is where money is most easily lost: a percentage becomes cents, and
 * the cents have to add back up to exactly what was handed in. These tests pin
 * that down, plus the boundaries of what counts as a valid split set.
 */

function split(
  amountCents: number,
  overrides: Partial<SplitLike> = {},
): SplitLike {
  return {
    glAccountId: "gl_software",
    department: null,
    amountCents,
    percentBasisPoints: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// distributeByBasisPoints
// ---------------------------------------------------------------------------

describe("distributeByBasisPoints", () => {
  it("splits an even amount evenly", () => {
    expect(distributeByBasisPoints(10_000, [5000, 5000])).toEqual([5000, 5000]);
  });

  it("conserves every cent on a three-way 1/3 split", () => {
    // $100.00 across three equal shares: 33.34 / 33.33 / 33.33, never 33.33 × 3.
    const parts = distributeByBasisPoints(10_000, [1, 1, 1]);

    expect(parts).toEqual([3334, 3333, 3333]);
    expect(sum(parts)).toBe(10_000);
  });

  it("conserves every cent on a three-way 1/3 split of an ODD amount", () => {
    const parts = distributeByBasisPoints(10_001, [1, 1, 1]);

    expect(parts).toEqual([3334, 3334, 3333]);
    expect(sum(parts)).toBe(10_001);
  });

  it("hands leftovers out largest-remainder first, ties by position", () => {
    expect(distributeByBasisPoints(10_000, [3333, 3333, 3334])).toEqual([
      3333, 3333, 3334,
    ]);
  });

  it("conserves cents for negative amounts too", () => {
    const parts = distributeByBasisPoints(-999, [5000, 5000]);

    expect(parts).toEqual([-500, -499]);
    expect(sum(parts)).toBe(-999);
  });

  it("conserves cents across a spread of awkward amounts and shares", () => {
    const shapes: Array<[number, number[]]> = [
      [1, [1, 1, 1]],
      [7, [1, 1, 1, 1, 1, 1]],
      [99_999, [1, 1, 1]],
      [123_457, [1000, 2000, 7000]],
      [500_003, [3333, 3333, 3334]],
      [-123_457, [1, 1, 1]],
      [0, [5000, 5000]],
    ];

    for (const [amount, shares] of shapes) {
      expect(sum(distributeByBasisPoints(amount, shares))).toBe(amount);
    }
  });

  it("returns an empty array for no shares", () => {
    expect(distributeByBasisPoints(10_000, [])).toEqual([]);
  });

  it("treats missing, zero and negative shares as zero", () => {
    expect(distributeByBasisPoints(10_000, [0, 0])).toEqual([0, 0]);
    expect(distributeByBasisPoints(10_000, [-100, 10_000])).toEqual([0, 10_000]);
  });
});

// ---------------------------------------------------------------------------
// applyAllocationTemplate
// ---------------------------------------------------------------------------

describe("applyAllocationTemplate", () => {
  it("turns percentages into cents that reconcile to the line", () => {
    const drafted = applyAllocationTemplate(10_001, [
      { glAccountId: "gl_a", percentBasisPoints: 3333 },
      { glAccountId: "gl_b", department: "Sales", percentBasisPoints: 3333 },
      { glAccountId: "gl_c", percentBasisPoints: 3334 },
    ]);

    expect(sumSplitCents(drafted)).toBe(10_001);
    expect(drafted.map((row) => row.sortOrder)).toEqual([0, 1, 2]);
    expect(drafted[1].department).toBe("Sales");
    expect(drafted[0].department).toBeNull();
    expect(splitsReconcile(10_001, drafted).balanced).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Percentage helpers
// ---------------------------------------------------------------------------

describe("basisPointsOf / formatBasisPoints", () => {
  it("expresses a share of the line in basis points", () => {
    expect(basisPointsOf(2500, 10_000)).toBe(2500);
    expect(basisPointsOf(3333, 10_000)).toBe(3333);
    expect(basisPointsOf(10_000, 10_000)).toBe(BASIS_POINTS_TOTAL);
  });

  it("has no answer for a share of nothing", () => {
    expect(basisPointsOf(2500, 0)).toBeNull();
  });

  it("trims trailing zeros without eating the integer part", () => {
    expect(formatBasisPoints(5000)).toBe("50%");
    expect(formatBasisPoints(3333)).toBe("33.33%");
    expect(formatBasisPoints(1250)).toBe("12.5%");
    expect(formatBasisPoints(10_000)).toBe("100%");
    expect(formatBasisPoints(0)).toBe("0%");
  });
});

// ---------------------------------------------------------------------------
// splitsReconcile
// ---------------------------------------------------------------------------

describe("splitsReconcile", () => {
  it("calls an unsplit line balanced and fully coded", () => {
    const result = splitsReconcile(10_000, []);

    expect(result).toEqual({
      hasSplits: false,
      lineAmountCents: 10_000,
      codedCents: 10_000,
      differenceCents: 0,
      balanced: true,
    });
  });

  it("balances when the splits add up exactly", () => {
    const result = splitsReconcile(10_000, [split(6000), split(4000)]);

    expect(result.hasSplits).toBe(true);
    expect(result.codedCents).toBe(10_000);
    expect(result.differenceCents).toBe(0);
    expect(result.balanced).toBe(true);
  });

  it("reports a positive difference when under-coded", () => {
    const result = splitsReconcile(10_000, [split(6000), split(3999)]);

    expect(result.differenceCents).toBe(1);
    expect(result.balanced).toBe(false);
  });

  it("reports a negative difference when over-coded", () => {
    const result = splitsReconcile(10_000, [split(6000), split(4001)]);

    expect(result.differenceCents).toBe(-1);
    expect(result.balanced).toBe(false);
  });

  it("is out of balance for a single cent, not just for big gaps", () => {
    expect(splitsReconcile(10_000, [split(9999)]).balanced).toBe(false);
    expect(splitsReconcile(10_000, [split(10_000)]).balanced).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateSplits
// ---------------------------------------------------------------------------

describe("validateSplits", () => {
  it("says nothing about an unsplit line — that is a valid state", () => {
    expect(validateSplits(10_000, [])).toEqual([]);
    expect(splitsAreValid(10_000, [])).toBe(true);
  });

  it("accepts a balanced fixed-amount split set", () => {
    expect(splitsAreValid(10_000, [split(6000), split(4000)])).toBe(true);
  });

  it("accepts a percentage split set that adds to exactly 100%", () => {
    expect(
      splitsAreValid(10_001, [
        split(3334, { percentBasisPoints: 3333 }),
        split(3334, { percentBasisPoints: 3333 }),
        split(3333, { percentBasisPoints: 3334 }),
      ]),
    ).toBe(true);
  });

  it("flags an out-of-balance set with the cent difference", () => {
    const issues = validateSplits(10_000, [split(6000), split(3000)]);

    expect(codes(issues)).toEqual(["OUT_OF_BALANCE"]);
    expect(issues[0].message).toBe("Splits are under the line amount by 1000 cents.");
    expect(issues[0].index).toBeNull();
  });

  it("flags an over-coded set", () => {
    const issues = validateSplits(10_000, [split(6000), split(5000)]);

    expect(issues[0].message).toBe("Splits are over the line amount by 1000 cents.");
  });

  it("flags a split with no GL account, pointing at the row", () => {
    const issues = validateSplits(10_000, [
      split(6000),
      split(4000, { glAccountId: null }),
    ]);

    expect(codes(issues)).toEqual(["MISSING_GL_ACCOUNT"]);
    expect(issues[0].index).toBe(1);
    expect(issues[0].message).toBe("Split 2 has no GL account.");
  });

  it("flags a zero-amount split", () => {
    const issues = validateSplits(10_000, [split(10_000), split(0)]);

    expect(codes(issues)).toContain("ZERO_AMOUNT");
  });

  it("flags a split running the opposite way to the line", () => {
    const issues = validateSplits(10_000, [split(11_000), split(-1000)]);

    expect(codes(issues)).toEqual(["SIGN_MISMATCH"]);
  });

  it("flags a percentage outside 0–100%", () => {
    const issues = validateSplits(10_000, [
      split(10_000, { percentBasisPoints: BASIS_POINTS_TOTAL + 1 }),
    ]);

    expect(codes(issues)).toContain("PERCENT_OUT_OF_RANGE");
  });

  it("flags percentages that do not add to 100% when the whole set is a percentage", () => {
    const issues = validateSplits(10_000, [
      split(6000, { percentBasisPoints: 6000 }),
      split(4000, { percentBasisPoints: 3000 }),
    ]);

    expect(codes(issues)).toEqual(["PERCENT_TOTAL_MISMATCH"]);
    expect(issues[0].message).toBe("Split percentages add up to 90%, not 100%.");
  });

  it("leaves a mixed percentage/amount set alone as long as the money reconciles", () => {
    expect(
      splitsAreValid(10_000, [
        split(6000, { percentBasisPoints: 6000 }),
        split(4000),
      ]),
    ).toBe(true);
  });
});

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function codes(issues: ReturnType<typeof validateSplits>): string[] {
  return issues.map((issue) => issue.code);
}
