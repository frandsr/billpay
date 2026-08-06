/**
 * The expense-vs-item axis of a line item: its labels, its display metadata and
 * the summary a bill uses to say what it is made of.
 *
 * GLOSSARY (docs/GLOSSARY.md — "Expense line" / "Item line"): an EXPENSE line
 * is spend that hits a GL expense account directly, such as a service, a
 * subscription or rent. An ITEM line refers to a catalogue product — inventory
 * or a tracked good — which syncs to the accounting system as an item record
 * rather than straight to an expense account. The distinction is not cosmetic:
 * the two sync differently to the ERP, and item lines are the ones that touch
 * inventory.
 *
 * PURE MODULE: no Prisma, no React, no `next/*`. The union comes from
 * `@/lib/domain`, which `src/server/schema-parity.ts` pins to the schema.
 */

import { LINE_TYPES, type LineType } from "@/lib/domain";

export { LINE_TYPES, type LineType };

export interface LineTypeMeta {
  /** The word shown on the badge and in the Type select. */
  label: string;
  /** One plain sentence, short enough for a tooltip. */
  description: string;
  /**
   * Extra classes giving the badge its semantic colour, paired with
   * `<Badge variant="outline">` — the same contract as `BILL_STATUS_META`.
   */
  badgeClassName: string;
}

/**
 * Expense is the neutral, overwhelmingly common case, so it stays quiet.
 * Item is the exception a reviewer needs to be able to spot without reading,
 * so it carries its own colour — two identical grey pills would tell nobody
 * that the axis exists at all.
 */
export const LINE_TYPE_META: Record<LineType, LineTypeMeta> = {
  EXPENSE: {
    label: "Expense",
    description: "Spend that hits a GL expense account directly.",
    badgeClassName:
      "border-neutral-300 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  },
  ITEM: {
    label: "Item",
    description:
      "A catalogue product that syncs to accounting as an item record.",
    badgeClassName:
      "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800/60 dark:bg-violet-950/60 dark:text-violet-300",
  },
};

/** Labels alone, for the controls that need only the word. */
export const LINE_TYPE_LABELS: Record<LineType, string> = {
  EXPENSE: LINE_TYPE_META.EXPENSE.label,
  ITEM: LINE_TYPE_META.ITEM.label,
};

/** The whole distinction in one line, for helper text under the Type control. */
export const LINE_TYPE_HINT =
  "Expense hits a GL account directly; Item refers to a catalogue product that syncs as an item record.";

export function isLineType(value: unknown): value is LineType {
  return (LINE_TYPES as readonly unknown[]).includes(value);
}

/**
 * Coerce anything the database or a form can hand us into a `LineType`.
 *
 * EXPENSE is the fallback because it is the schema default: a line whose type
 * was never chosen is ordinary spend, not an inventory movement.
 */
export function normaliseLineType(value: unknown): LineType {
  return isLineType(value) ? value : "EXPENSE";
}

export function lineTypeLabel(value: unknown): string {
  return LINE_TYPE_LABELS[normaliseLineType(value)];
}

export function lineTypeMeta(value: unknown): LineTypeMeta {
  return LINE_TYPE_META[normaliseLineType(value)];
}

/** The minimum shape the counters need. Any Prisma line item satisfies it. */
export interface LineTypeCountable {
  lineType?: string | null;
}

export type LineTypeCounts = Record<LineType, number>;

export function countLineTypes(
  lines: readonly LineTypeCountable[],
): LineTypeCounts {
  const counts: LineTypeCounts = { EXPENSE: 0, ITEM: 0 };
  for (const line of lines) {
    counts[normaliseLineType(line.lineType)] += 1;
  }
  return counts;
}

/**
 * "3 expense lines, 1 item line" — or `null`.
 *
 * Null when the summary would add nothing: no lines at all, or every line the
 * same type. A bill of four expense lines already says so on every row, and
 * repeating it in the header is clutter. The sentence therefore appears exactly
 * where it earns its place — on a bill that genuinely mixes the two.
 */
export function summariseLineTypes(
  lines: readonly LineTypeCountable[],
): string | null {
  const counts = countLineTypes(lines);
  if (counts.EXPENSE === 0 || counts.ITEM === 0) return null;

  return (LINE_TYPES as readonly LineType[])
    .map(
      (type) =>
        `${counts[type]} ${LINE_TYPE_LABELS[type].toLowerCase()} ${
          counts[type] === 1 ? "line" : "lines"
        }`,
    )
    .join(", ");
}
