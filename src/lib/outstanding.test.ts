import { describe, expect, it } from "vitest";

import { BILL_STATUSES, type BillStatus } from "@/lib/domain";
import {
  DUE_DATE_RELEVANT_STATUSES,
  OUTSTANDING_STATUSES,
  UNPAID_INCLUDING_DRAFTS_STATUSES,
  isOutstanding,
  isUnpaidIncludingDrafts,
} from "@/lib/outstanding";

/**
 * These tests exist to stop the definitions drifting apart again. Two figures
 * labelled "outstanding" that disagree about drafts is a reporting bug, not a
 * styling detail, so the sets are pinned exactly rather than sampled.
 */

describe("OUTSTANDING_STATUSES — a submitted, unpaid obligation", () => {
  it("is exactly awaiting approval and approved", () => {
    expect([...OUTSTANDING_STATUSES]).toEqual(["AWAITING_APPROVAL", "APPROVED"]);
  });

  it("excludes DRAFT — an unsubmitted bill is not yet owed", () => {
    expect(isOutstanding("DRAFT")).toBe(false);
  });

  it.each(["PAID", "REJECTED", "ARCHIVED"] as const)(
    "excludes %s — it will never be settled from here",
    (status) => {
      expect(isOutstanding(status)).toBe(false);
    },
  );
});

describe("UNPAID_INCLUDING_DRAFTS_STATUSES — every unpaid row on the ledger", () => {
  it("is the outstanding set plus DRAFT, and nothing else", () => {
    expect([...UNPAID_INCLUDING_DRAFTS_STATUSES]).toEqual([
      "DRAFT",
      "AWAITING_APPROVAL",
      "APPROVED",
    ]);
  });

  it("is a strict superset of the outstanding set", () => {
    for (const status of OUTSTANDING_STATUSES) {
      expect(isUnpaidIncludingDrafts(status)).toBe(true);
    }
    expect(UNPAID_INCLUDING_DRAFTS_STATUSES.length).toBe(
      OUTSTANDING_STATUSES.length + 1,
    );
  });

  it("differs from the outstanding set only by DRAFT", () => {
    const difference = UNPAID_INCLUDING_DRAFTS_STATUSES.filter(
      (status) => !OUTSTANDING_STATUSES.includes(status),
    );
    expect(difference).toEqual(["DRAFT"]);
  });
});

describe("DUE_DATE_RELEVANT_STATUSES — when an overdue marker is meaningful", () => {
  it("adds REJECTED, whose due date has not moved", () => {
    expect([...DUE_DATE_RELEVANT_STATUSES]).toEqual([
      "DRAFT",
      "AWAITING_APPROVAL",
      "APPROVED",
      "REJECTED",
    ]);
  });

  it("never marks a settled or abandoned bill overdue", () => {
    for (const status of ["PAID", "ARCHIVED"] as const) {
      expect(DUE_DATE_RELEVANT_STATUSES.includes(status)).toBe(false);
    }
  });
});

describe("coverage of the status union", () => {
  it("classifies every BillStatus without leaving one unaccounted for", () => {
    const settled: BillStatus[] = ["PAID", "ARCHIVED"];
    for (const status of BILL_STATUSES) {
      const known =
        DUE_DATE_RELEVANT_STATUSES.includes(status) || settled.includes(status);
      expect(known, `${status} belongs to no bucket`).toBe(true);
    }
  });
});
