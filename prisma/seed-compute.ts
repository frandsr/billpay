/**
 * Pure derivations over `seed-data.ts` — no database access, no side effects.
 *
 * Shared by `prisma/seed.ts` (which writes to Postgres) and
 * `scripts/generate-invoices.ts` (which renders the placeholder invoice PDFs),
 * so the documents and the rows can never disagree.
 */

import type { LineType } from "@prisma/client";

import { distributeByBasisPoints } from "../src/lib/splits";
import {
  BILLS,
  LINE_ITEM_SPLITS,
  RECURRING_BILLS,
  type SeedAllocationRow,
  type SeedBill,
  type SeedRecurringBill,
} from "./seed-data";

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The date anchor: today at UTC midnight. */
export const TODAY = (() => {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
})();

export const TERM_DAYS: Record<string, number> = {
  DUE_ON_RECEIPT: 0,
  NET_15: 15,
  NET_30: 30,
  NET_45: 45,
  NET_60: 60,
  NET_90: 90,
};

export function dayOffset(days: number): Date {
  return new Date(TODAY.getTime() + days * MS_PER_DAY);
}

/** Same day at a fixed business hour, so timestamps look human but stay stable. */
export function at(date: Date, hour: number, minute: number): Date {
  return new Date(date.getTime() + hour * 3_600_000 + minute * 60_000);
}

export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Fixed-seed PRNG (mulberry32) for the handful of cosmetic choices. */
export function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function invoiceFileName(billNumber: string): string {
  return `${slug(billNumber)}.pdf`;
}

export interface ComputedLine {
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  glCode: string | null;
  department: string | null;
  /** `undefined` means the line did not state a type; the writer defaults it. */
  lineType: LineType | undefined;
  sortOrder: number;
}

export interface ComputedBill {
  spec: SeedBill;
  lines: ComputedLine[];
  lineTotalCents: number;
  totalCents: number;
  dueDate: Date;
  issueDate: Date;
  createdAt: Date;
}

export function computeBill(spec: SeedBill): ComputedBill {
  const lines: ComputedLine[] = spec.lines.map((line, index) => {
    const [description, quantity, unitPriceDollars, glCode, department, lineType] =
      line;
    const unitPriceCents = toCents(unitPriceDollars);
    return {
      description,
      quantity,
      unitPriceCents,
      amountCents: Math.round(quantity * unitPriceCents),
      glCode,
      department,
      lineType,
      sortOrder: index,
    };
  });

  const lineTotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const totalCents =
    spec.totalOverrideDollars !== undefined
      ? toCents(spec.totalOverrideDollars)
      : lineTotalCents;

  const dueDate = dayOffset(spec.dueInDays);
  const issueDate = new Date(
    dueDate.getTime() - TERM_DAYS[spec.terms] * MS_PER_DAY,
  );
  const createdAt = at(new Date(issueDate.getTime() + MS_PER_DAY), 9, 15);

  return {
    spec,
    lines,
    lineTotalCents,
    totalCents,
    dueDate,
    issueDate,
    createdAt,
  };
}

export const COMPUTED_BILLS: ComputedBill[] = BILLS.map(computeBill);

export const COMPUTED_BILLS_BY_KEY: Map<string, ComputedBill> = new Map(
  COMPUTED_BILLS.map((bill) => [bill.spec.key, bill]),
);

// ---------------------------------------------------------------------------
// Splits
// ---------------------------------------------------------------------------

export interface ComputedSplit {
  glCode: string;
  department: string | null;
  amountCents: number;
  percentBasisPoints: number;
  sortOrder: number;
}

export interface ComputedLineItemSplits {
  billKey: string;
  lineSortOrder: number;
  /** The line amount the splits must add back up to. */
  lineAmountCents: number;
  splits: ComputedSplit[];
}

/**
 * Turn percentage shares into cents with the SAME function the app uses
 * (`distributeByBasisPoints`), so the seeded splits satisfy the invariant the
 * UI enforces: Σ(splits) === LineItem.amountCents, exactly, with no lost cent.
 */
export function computeSplits(
  lineAmountCents: number,
  rows: readonly SeedAllocationRow[],
): ComputedSplit[] {
  const amounts = distributeByBasisPoints(
    lineAmountCents,
    rows.map((row) => row.percentBasisPoints),
  );

  return rows.map((row, index) => ({
    glCode: row.glCode,
    department: row.department,
    amountCents: amounts[index] ?? 0,
    percentBasisPoints: row.percentBasisPoints,
    sortOrder: index,
  }));
}

export const COMPUTED_LINE_ITEM_SPLITS: ComputedLineItemSplits[] =
  LINE_ITEM_SPLITS.map((spec) => {
    const bill = COMPUTED_BILLS_BY_KEY.get(spec.billKey);
    if (!bill) {
      throw new Error(`Split references an unknown bill key: ${spec.billKey}`);
    }

    const line = bill.lines[spec.lineSortOrder];
    if (!line) {
      throw new Error(
        `Split references line ${spec.lineSortOrder} of ${spec.billKey}, which has ${bill.lines.length} line(s).`,
      );
    }

    return {
      billKey: spec.billKey,
      lineSortOrder: spec.lineSortOrder,
      lineAmountCents: line.amountCents,
      splits: computeSplits(line.amountCents, spec.rows),
    };
  });

// ---------------------------------------------------------------------------
// Recurring bills
// ---------------------------------------------------------------------------

export interface ComputedRecurringBill {
  spec: SeedRecurringBill;
  lines: ComputedLine[];
  /** Authoritative amount of each generated bill (Σ of the template lines). */
  totalCents: number;
  nextRunDate: Date;
  lastGeneratedAt: Date | null;
  /** True when the template already owes a bill as of today. */
  due: boolean;
}

export function computeRecurringBill(
  spec: SeedRecurringBill,
): ComputedRecurringBill {
  const lines: ComputedLine[] = spec.lines.map((line, index) => {
    const [description, quantity, unitPriceDollars, glCode, department, lineType] =
      line;
    const unitPriceCents = toCents(unitPriceDollars);
    return {
      description,
      quantity,
      unitPriceCents,
      amountCents: Math.round(quantity * unitPriceCents),
      glCode,
      department,
      lineType,
      sortOrder: index,
    };
  });

  const totalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const nextRunDate = dayOffset(spec.nextRunInDays);

  return {
    spec,
    lines,
    totalCents,
    nextRunDate,
    lastGeneratedAt:
      spec.lastGeneratedInDays === undefined
        ? null
        : at(dayOffset(spec.lastGeneratedInDays), 6, 5),
    due: spec.active !== false && spec.nextRunInDays <= 0,
  };
}

export const COMPUTED_RECURRING_BILLS: ComputedRecurringBill[] =
  RECURRING_BILLS.map(computeRecurringBill);
