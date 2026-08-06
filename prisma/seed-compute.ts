/**
 * Pure derivations over `seed-data.ts` — no database access, no side effects.
 *
 * Shared by `prisma/seed.ts` (which writes to Postgres) and
 * `scripts/generate-invoices.ts` (which renders the placeholder invoice PDFs),
 * so the documents and the rows can never disagree.
 */

import { BILLS, type SeedBill } from "./seed-data";

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
    const [description, quantity, unitPriceDollars, glCode, department] = line;
    const unitPriceCents = toCents(unitPriceDollars);
    return {
      description,
      quantity,
      unitPriceCents,
      amountCents: Math.round(quantity * unitPriceCents),
      glCode,
      department,
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
