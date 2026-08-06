/**
 * Line-item splits and allocation templates.
 *
 * GLOSSARY: a **split** is the distribution of ONE line across several GL
 * accounts/dimensions, by percentage or fixed amount, and Σ(splits) equals the
 * line amount. An **allocation template** is a saved, named split pattern.
 *
 * Two rules drive every function here:
 *
 * 1. **Money stays integer.** Percentages are basis points (1% = 100,
 *    100% = 10000), never floats, so a 1/3 split of $100 is exact and
 *    reproducible instead of "close enough".
 * 2. **Cents are conserved.** `distributeByBasisPoints` uses the largest
 *    remainder method: the parts always sum back to the amount handed in — no
 *    cent is lost, none is invented.
 *
 * PURE MODULE: no Prisma, no React, no `next/*`. Every function is total —
 * nothing throws, so the caller decides what an invalid split means.
 */

/** Basis points in 100%. 1% = 100 bp. */
export const BASIS_POINTS_TOTAL = 10_000;

/**
 * The shape both a persisted `LineItemSplit` and an unsaved editor row satisfy.
 * Structural on purpose so the UI can validate before anything is written.
 */
export interface SplitLike {
  glAccountId?: string | null;
  department?: string | null;
  amountCents: number;
  percentBasisPoints?: number | null;
}

/** A split computed from a template, before it is persisted. */
export interface DraftSplit {
  glAccountId: string;
  department: string | null;
  amountCents: number;
  percentBasisPoints: number;
  sortOrder: number;
}

/** One row of an allocation template: coding plus a share, never an amount. */
export interface AllocationRowLike {
  glAccountId: string;
  department?: string | null;
  percentBasisPoints: number;
}

// ---------------------------------------------------------------------------
// Distribution
// ---------------------------------------------------------------------------

/**
 * Split an integer amount across shares expressed in basis points, conserving
 * every cent (largest remainder method).
 *
 * The naive `Math.round(amount * bp / total)` per part either loses or invents
 * cents — on a $100 three-way even split it produces 33.33/33.33/33.33 and
 * silently drops a cent that an accountant will later have to find. Here the
 * remainders are ranked and the leftover cents handed out one at a time,
 * largest remainder first, ties broken by position so the result is
 * deterministic.
 *
 *   distributeByBasisPoints(10_000, [3333, 3333, 3334]) // [3333, 3333, 3334]
 *   distributeByBasisPoints(10_000, [1, 1, 1])          // [3334, 3333, 3333]
 *   distributeByBasisPoints(-999, [5000, 5000])         // [-500, -499]
 *
 * Total by construction: an empty array returns `[]`, and shares that are
 * missing, negative or non-finite count as zero (validation reports those
 * separately — this function never throws).
 */
export function distributeByBasisPoints(
  amountCents: number,
  basisPoints: readonly number[],
): number[] {
  if (basisPoints.length === 0) return [];

  const shares = basisPoints.map((bp) =>
    Number.isFinite(bp) && bp > 0 ? Math.trunc(bp) : 0,
  );
  const totalShares = shares.reduce((sum, share) => sum + share, 0);
  if (totalShares === 0) return shares.map(() => 0);

  const amount = Number.isFinite(amountCents) ? Math.trunc(amountCents) : 0;
  const sign = amount < 0 ? -1 : 1;
  const magnitude = Math.abs(amount);

  // Integer division keeps the exact remainder available for ranking.
  const base = shares.map((share) =>
    Math.floor((magnitude * share) / totalShares),
  );
  const remainder = shares.map(
    (share, index) => magnitude * share - base[index] * totalShares,
  );

  let leftover = magnitude - base.reduce((sum, part) => sum + part, 0);

  const order = remainder
    .map((value, index) => ({ value, index }))
    .sort((a, b) => (b.value - a.value) || (a.index - b.index));

  for (const { index } of order) {
    if (leftover <= 0) break;
    base[index] += 1;
    leftover -= 1;
  }

  return base.map((part) => part * sign);
}

/**
 * Turn an allocation template into concrete splits for a line of a given
 * amount. This is the ONLY place a template becomes money, so "apply template"
 * behaves identically in the UI, the server action and the seed.
 */
export function applyAllocationTemplate(
  lineAmountCents: number,
  rows: readonly AllocationRowLike[],
): DraftSplit[] {
  const amounts = distributeByBasisPoints(
    lineAmountCents,
    rows.map((row) => row.percentBasisPoints),
  );

  return rows.map((row, index) => ({
    glAccountId: row.glAccountId,
    department: row.department ?? null,
    amountCents: amounts[index] ?? 0,
    percentBasisPoints: row.percentBasisPoints,
    sortOrder: index,
  }));
}

/** Σ of the split amounts. Safe on an empty array. */
export function sumSplitCents(splits: readonly SplitLike[]): number {
  return splits.reduce(
    (total, split) =>
      total + (Number.isFinite(split.amountCents) ? split.amountCents : 0),
    0,
  );
}

/**
 * The share one amount represents of a line, in basis points, rounded to the
 * nearest bp. `null` when the line amount is zero and the share is undefined.
 */
export function basisPointsOf(
  amountCents: number,
  lineAmountCents: number,
): number | null {
  if (!Number.isFinite(lineAmountCents) || lineAmountCents === 0) return null;
  return Math.round((amountCents * BASIS_POINTS_TOTAL) / lineAmountCents);
}

/** "50%", "33.33%", "12.5%" — trailing zeros trimmed, fixed locale-free output. */
export function formatBasisPoints(basisPoints: number): string {
  if (!Number.isFinite(basisPoints)) return "—";
  // toFixed always emits a decimal point, so trimming trailing zeros and then a
  // dangling dot can never eat into the integer part.
  const rendered = (basisPoints / 100)
    .toFixed(2)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  return `${rendered}%`;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export interface SplitReconciliation {
  /** Whether the line carries splits at all. */
  hasSplits: boolean;
  /** The line amount the splits must add up to. */
  lineAmountCents: number;
  /** Σ(splits), or the line amount itself when the line is not split. */
  codedCents: number;
  /** `lineAmountCents - codedCents`. Positive = under-coded. */
  differenceCents: number;
  /** True when the coding adds up. An unsplit line is balanced by definition. */
  balanced: boolean;
}

/**
 * Reconcile a line's splits against the line amount.
 *
 * A line with **zero splits** is coded directly by its own `glAccountId`, so it
 * counts as fully coded (`codedCents = lineAmountCents`, difference 0). A line
 * **with** splits is coded by the splits, and they must sum to the line amount
 * exactly — the same posture `Bill.totalCents` takes towards its line items
 * (ADR 0004): surface the difference, never silently correct it.
 */
export function splitsReconcile(
  lineAmountCents: number,
  splits: readonly SplitLike[],
): SplitReconciliation {
  const amount = Number.isFinite(lineAmountCents) ? lineAmountCents : 0;

  if (splits.length === 0) {
    return {
      hasSplits: false,
      lineAmountCents: amount,
      codedCents: amount,
      differenceCents: 0,
      balanced: true,
    };
  }

  const codedCents = sumSplitCents(splits);
  const differenceCents = amount - codedCents;

  return {
    hasSplits: true,
    lineAmountCents: amount,
    codedCents,
    differenceCents,
    balanced: differenceCents === 0,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type SplitIssueCode =
  | "OUT_OF_BALANCE"
  | "MISSING_GL_ACCOUNT"
  | "ZERO_AMOUNT"
  | "SIGN_MISMATCH"
  | "PERCENT_OUT_OF_RANGE"
  | "PERCENT_TOTAL_MISMATCH";

export interface SplitIssue {
  code: SplitIssueCode;
  /** Reviewer-facing sentence, already written for the UI. */
  message: string;
  /** Index of the offending split, or `null` for line-level issues. */
  index: number | null;
}

/**
 * Everything wrong with a line's splits, as a list rather than a boolean, so
 * the editor can point at the row that is wrong instead of just refusing.
 * Returns `[]` for an unsplit line — that is a valid state, not an empty split.
 */
export function validateSplits(
  lineAmountCents: number,
  splits: readonly SplitLike[],
): SplitIssue[] {
  if (splits.length === 0) return [];

  const issues: SplitIssue[] = [];
  const lineSign = Math.sign(lineAmountCents);

  splits.forEach((split, index) => {
    const position = index + 1;

    if (!split.glAccountId) {
      issues.push({
        code: "MISSING_GL_ACCOUNT",
        message: `Split ${position} has no GL account.`,
        index,
      });
    }

    if (!Number.isFinite(split.amountCents) || split.amountCents === 0) {
      issues.push({
        code: "ZERO_AMOUNT",
        message: `Split ${position} has no amount.`,
        index,
      });
    } else if (lineSign !== 0 && Math.sign(split.amountCents) !== lineSign) {
      issues.push({
        code: "SIGN_MISMATCH",
        message: `Split ${position} runs the opposite way to the line amount.`,
        index,
      });
    }

    const percent = split.percentBasisPoints;
    if (
      percent !== null &&
      percent !== undefined &&
      (!Number.isFinite(percent) || percent < 0 || percent > BASIS_POINTS_TOTAL)
    ) {
      issues.push({
        code: "PERCENT_OUT_OF_RANGE",
        message: `Split ${position} has a percentage outside 0–100%.`,
        index,
      });
    }
  });

  // Percentages only have to add up when the whole line was entered that way.
  // A mix of percentage and fixed-amount splits is legitimate; only the money
  // has to reconcile then.
  const percents = splits
    .map((split) => split.percentBasisPoints)
    .filter((percent): percent is number => typeof percent === "number");

  if (percents.length === splits.length) {
    const totalBp = percents.reduce(
      (total, percent) => total + (Number.isFinite(percent) ? percent : 0),
      0,
    );
    if (totalBp !== BASIS_POINTS_TOTAL) {
      issues.push({
        code: "PERCENT_TOTAL_MISMATCH",
        message: `Split percentages add up to ${formatBasisPoints(totalBp)}, not 100%.`,
        index: null,
      });
    }
  }

  const reconciliation = splitsReconcile(lineAmountCents, splits);
  if (!reconciliation.balanced) {
    const difference = reconciliation.differenceCents;
    issues.push({
      code: "OUT_OF_BALANCE",
      message:
        difference > 0
          ? `Splits are under the line amount by ${difference} cents.`
          : `Splits are over the line amount by ${Math.abs(difference)} cents.`,
      index: null,
    });
  }

  return issues;
}

/** Convenience predicate over `validateSplits`. */
export function splitsAreValid(
  lineAmountCents: number,
  splits: readonly SplitLike[],
): boolean {
  return validateSplits(lineAmountCents, splits).length === 0;
}
