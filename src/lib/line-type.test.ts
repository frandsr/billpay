import { describe, expect, it } from "vitest";

import { LINE_TYPES } from "@/lib/domain";
import {
  LINE_TYPE_LABELS,
  LINE_TYPE_META,
  countLineTypes,
  isLineType,
  lineTypeLabel,
  lineTypeMeta,
  normaliseLineType,
  summariseLineTypes,
} from "@/lib/line-type";

/**
 * The expense-vs-item axis is the kind of feature that is easy to implement and
 * easy to leave invisible. These tests pin the two things that make it legible:
 * every member has its own label and its own colour, and the bill-level summary
 * only speaks up when the bill actually mixes the two.
 */

describe("LINE_TYPE_META", () => {
  it("covers every member of the schema enum", () => {
    expect(Object.keys(LINE_TYPE_META).sort()).toEqual([...LINE_TYPES].sort());
  });

  it("gives the two types different labels", () => {
    expect(LINE_TYPE_META.EXPENSE.label).not.toBe(LINE_TYPE_META.ITEM.label);
  });

  it("gives the two types different badge colours, so they are not two identical pills", () => {
    expect(LINE_TYPE_META.EXPENSE.badgeClassName).not.toBe(
      LINE_TYPE_META.ITEM.badgeClassName,
    );
  });

  it("describes each type in one plain sentence", () => {
    for (const type of LINE_TYPES) {
      expect(LINE_TYPE_META[type].description).toMatch(/\.$/);
      expect(LINE_TYPE_META[type].description.length).toBeLessThan(120);
    }
  });

  it("keeps LINE_TYPE_LABELS in step with the meta", () => {
    for (const type of LINE_TYPES) {
      expect(LINE_TYPE_LABELS[type]).toBe(LINE_TYPE_META[type].label);
    }
  });
});

describe("isLineType", () => {
  it.each([...LINE_TYPES])("accepts %s", (type) => {
    expect(isLineType(type)).toBe(true);
  });

  it.each([["expense"], ["SERVICE"], [""], [null], [undefined], [7]])(
    "rejects %p",
    (value) => {
      expect(isLineType(value)).toBe(false);
    },
  );
});

describe("normaliseLineType", () => {
  it("passes valid members through untouched", () => {
    expect(normaliseLineType("ITEM")).toBe("ITEM");
    expect(normaliseLineType("EXPENSE")).toBe("EXPENSE");
  });

  it("falls back to EXPENSE — the schema default — for anything else", () => {
    expect(normaliseLineType(null)).toBe("EXPENSE");
    expect(normaliseLineType(undefined)).toBe("EXPENSE");
    expect(normaliseLineType("item")).toBe("EXPENSE");
  });

  it("is what lineTypeLabel and lineTypeMeta lean on", () => {
    expect(lineTypeLabel("ITEM")).toBe("Item");
    expect(lineTypeLabel("nonsense")).toBe("Expense");
    expect(lineTypeMeta("ITEM")).toBe(LINE_TYPE_META.ITEM);
    expect(lineTypeMeta(null)).toBe(LINE_TYPE_META.EXPENSE);
  });
});

describe("countLineTypes", () => {
  it("counts an empty bill as zero of each", () => {
    expect(countLineTypes([])).toEqual({ EXPENSE: 0, ITEM: 0 });
  });

  it("counts both types on a mixed bill", () => {
    const counts = countLineTypes([
      { lineType: "EXPENSE" },
      { lineType: "ITEM" },
      { lineType: "EXPENSE" },
    ]);
    expect(counts).toEqual({ EXPENSE: 2, ITEM: 1 });
  });

  it("counts an unset type as EXPENSE rather than dropping the line", () => {
    expect(countLineTypes([{}, { lineType: null }])).toEqual({
      EXPENSE: 2,
      ITEM: 0,
    });
  });
});

describe("summariseLineTypes", () => {
  it("names both sides of a mixed bill", () => {
    expect(
      summariseLineTypes([
        { lineType: "EXPENSE" },
        { lineType: "EXPENSE" },
        { lineType: "EXPENSE" },
        { lineType: "ITEM" },
      ]),
    ).toBe("3 expense lines, 1 item line");
  });

  it("singularises a count of one on either side", () => {
    expect(
      summariseLineTypes([{ lineType: "EXPENSE" }, { lineType: "ITEM" }]),
    ).toBe("1 expense line, 1 item line");
  });

  it("stays silent on a bill whose lines are all the same type", () => {
    expect(
      summariseLineTypes([{ lineType: "EXPENSE" }, { lineType: "EXPENSE" }]),
    ).toBeNull();
    expect(summariseLineTypes([{ lineType: "ITEM" }])).toBeNull();
  });

  it("stays silent on a bill with no lines", () => {
    expect(summariseLineTypes([])).toBeNull();
  });
});
