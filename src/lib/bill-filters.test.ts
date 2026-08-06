import { describe, expect, it } from "vitest";

import {
  DEFAULT_INBOX_TAB,
  INBOX_TABS,
  INBOX_TAB_META,
  defaultSortForTab,
  parseBillFilters,
  statusesForTab,
  tabSupportsStatusFilter,
} from "@/lib/bill-filters";
import { BILL_STATUSES, type BillStatus } from "@/lib/domain";

/**
 * The tab bar is a claim about the workflow, so its mapping is pinned exactly.
 * The rule that matters most: a REJECTED bill is unfinished work, not history.
 */

describe("tab to status mapping", () => {
  it("reads as the workflow, in order", () => {
    expect([...INBOX_TABS]).toEqual([
      "drafts",
      "awaiting",
      "approved",
      "rejected",
      "history",
      "all",
    ]);
  });

  it.each([
    ["drafts", ["DRAFT"]],
    ["awaiting", ["AWAITING_APPROVAL"]],
    ["approved", ["APPROVED"]],
    ["rejected", ["REJECTED"]],
    ["history", ["PAID", "ARCHIVED"]],
  ] as const)("maps %s to %j", (tab, statuses) => {
    expect([...statusesForTab(tab)]).toEqual(statuses);
  });

  it("keeps REJECTED out of History — it is actionable, not finished", () => {
    expect(statusesForTab("history")).not.toContain("REJECTED");
    expect(statusesForTab("rejected")).toEqual(["REJECTED"]);
  });

  it("shows every status under All", () => {
    expect([...statusesForTab("all")]).toEqual([...BILL_STATUSES]);
  });

  it("covers every status exactly once across the working tabs", () => {
    const workingTabs = INBOX_TABS.filter((tab) => tab !== "all");
    const seen = workingTabs.flatMap((tab) => [...statusesForTab(tab)]);
    expect([...seen].sort()).toEqual([...BILL_STATUSES].sort());
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("tab metadata", () => {
  it("gives every tab a label and an empty state", () => {
    for (const tab of INBOX_TABS) {
      const meta = INBOX_TAB_META[tab];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.emptyTitle.length).toBeGreaterThan(0);
      expect(meta.emptyDescription.length).toBeGreaterThan(0);
    }
  });

  it("words the empty Rejected tab as good news, not an error", () => {
    const meta = INBOX_TAB_META.rejected;
    expect(meta.emptyDescription).toContain("good news");
  });

  it("offers a status filter only where a tab spans more than one status", () => {
    expect(tabSupportsStatusFilter("rejected")).toBe(false);
    expect(tabSupportsStatusFilter("history")).toBe(true);
    expect(tabSupportsStatusFilter("all")).toBe(true);
  });
});

describe("parsing the tab from the URL", () => {
  it("accepts the new tab", () => {
    expect(parseBillFilters({ tab: "rejected" }).tab).toBe("rejected");
  });

  it("falls back to the default for an unknown tab", () => {
    expect(parseBillFilters({ tab: "nonsense" }).tab).toBe(DEFAULT_INBOX_TAB);
  });

  it("drops a status narrowing the tab cannot show", () => {
    const filters = parseBillFilters({ tab: "rejected", status: "PAID" });
    expect(filters.statuses).toEqual([]);
  });

  it("keeps a status narrowing the tab can show", () => {
    const filters = parseBillFilters({ tab: "history", status: "PAID" });
    expect(filters.statuses).toEqual<BillStatus[]>(["PAID"]);
  });
});

describe("default sort", () => {
  it("sorts rejected bills by due date, like the other actionable tabs", () => {
    expect(defaultSortForTab("rejected")).toEqual({
      sort: "dueDate",
      direction: "asc",
    });
  });

  it("still sorts History by most recently created", () => {
    expect(defaultSortForTab("history")).toEqual({
      sort: "createdAt",
      direction: "desc",
    });
  });
});
