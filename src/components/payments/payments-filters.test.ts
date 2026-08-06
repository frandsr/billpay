import { describe, expect, it } from "vitest";

import {
  CLEARED_PAYMENT_FILTERS,
  DEFAULT_REGISTER_SECTION,
  activePaymentFilterChips,
  activePaymentFilterCount,
  buildPaymentsHref,
  effectivePaymentStatuses,
  hasActivePaymentFilters,
  parsePaymentFilters,
  sectionSupportsStatusFilter,
  statusesForSection,
} from "@/components/payments/payments-filters";

describe("parsePaymentFilters", () => {
  it("falls back to the scheduled section with nothing filtered", () => {
    const filters = parsePaymentFilters({});

    expect(filters.section).toBe(DEFAULT_REGISTER_SECTION);
    expect(filters.section).toBe("scheduled");
    expect(filters.statuses).toEqual([]);
    expect(filters.methods).toEqual([]);
    expect(filters.vendorIds).toEqual([]);
    expect(filters.from).toBeNull();
    expect(filters.to).toBeNull();
  });

  it("ignores a section that does not exist", () => {
    expect(parsePaymentFilters({ section: "everything" }).section).toBe(
      "scheduled",
    );
  });

  it("reads repeatable params as both a list and a comma-joined string", () => {
    expect(parsePaymentFilters({ method: ["ACH", "WIRE"] }).methods).toEqual([
      "ACH",
      "WIRE",
    ]);
    expect(parsePaymentFilters({ method: "ACH,WIRE" }).methods).toEqual([
      "ACH",
      "WIRE",
    ]);
  });

  it("drops unknown methods and de-duplicates the rest", () => {
    expect(
      parsePaymentFilters({ method: "ACH,CRYPTO,ACH,CHECK" }).methods,
    ).toEqual(["ACH", "CHECK"]);
  });

  it("drops a status the section cannot show", () => {
    // The scheduled section spans SCHEDULED only, so a PAID narrowing is noise.
    expect(
      parsePaymentFilters({ section: "scheduled", status: "PAID" }).statuses,
    ).toEqual([]);
    expect(
      parsePaymentFilters({ section: "all", status: "PAID,FAILED" }).statuses,
    ).toEqual(["PAID", "FAILED"]);
  });

  it("only accepts yyyy-MM-dd date bounds", () => {
    expect(parsePaymentFilters({ from: "2026-08-06" }).from).toBe("2026-08-06");
    expect(parsePaymentFilters({ from: "August 6" }).from).toBeNull();
    expect(parsePaymentFilters({ to: "2026-8-6" }).to).toBeNull();
  });
});

describe("statusesForSection", () => {
  it("maps each section onto the payment lifecycle", () => {
    expect(statusesForSection("scheduled")).toEqual(["SCHEDULED"]);
    expect(statusesForSection("inflight")).toEqual(["INITIATED"]);
    expect(statusesForSection("completed")).toEqual(["PAID"]);
    expect(statusesForSection("failed")).toEqual(["FAILED"]);
    expect(statusesForSection("all")).toEqual([
      "SCHEDULED",
      "INITIATED",
      "PAID",
      "FAILED",
    ]);
  });

  it("offers a status filter only where a section spans more than one status", () => {
    expect(sectionSupportsStatusFilter("scheduled")).toBe(false);
    expect(sectionSupportsStatusFilter("all")).toBe(true);
  });
});

describe("effectivePaymentStatuses", () => {
  it("uses the section's statuses when nothing is narrowed", () => {
    expect(
      effectivePaymentStatuses(parsePaymentFilters({ section: "completed" })),
    ).toEqual(["PAID"]);
  });

  it("uses the narrowing when there is one", () => {
    expect(
      effectivePaymentStatuses(
        parsePaymentFilters({ section: "all", status: "FAILED" }),
      ),
    ).toEqual(["FAILED"]);
  });
});

describe("buildPaymentsHref", () => {
  it("omits the default section so the bare URL is the default view", () => {
    expect(buildPaymentsHref(parsePaymentFilters({}))).toBe("/payments");
  });

  it("round-trips through parse unchanged", () => {
    const filters = parsePaymentFilters({
      section: "all",
      status: "FAILED",
      method: "ACH",
      vendor: "v1",
      from: "2026-08-01",
      to: "2026-08-31",
    });

    const href = buildPaymentsHref(filters);
    const params = Object.fromEntries(
      new URL(href, "https://example.test").searchParams.entries(),
    );

    expect(parsePaymentFilters(params)).toEqual(filters);
  });

  it("drops a status narrowing the new section cannot show", () => {
    const filters = parsePaymentFilters({ section: "all", status: "PAID" });

    expect(buildPaymentsHref(filters, { section: "failed" })).toBe(
      "/payments?section=failed",
    );
  });

  it("keeps the other filters when the section changes", () => {
    const filters = parsePaymentFilters({ method: "ACH", vendor: "v1" });

    expect(buildPaymentsHref(filters, { section: "failed" })).toBe(
      "/payments?section=failed&method=ACH&vendor=v1",
    );
  });

  it("clears every filter but the section", () => {
    const filters = parsePaymentFilters({
      section: "all",
      method: "ACH",
      vendor: "v1",
      from: "2026-08-01",
    });

    expect(buildPaymentsHref(filters, CLEARED_PAYMENT_FILTERS)).toBe(
      "/payments?section=all",
    );
  });
});

describe("activePaymentFilterCount", () => {
  it("counts filters but never the section", () => {
    expect(activePaymentFilterCount(parsePaymentFilters({}))).toBe(0);
    expect(
      hasActivePaymentFilters(parsePaymentFilters({ section: "failed" })),
    ).toBe(false);
    expect(
      activePaymentFilterCount(
        parsePaymentFilters({
          section: "all",
          status: "PAID",
          method: "ACH,WIRE",
          vendor: "v1",
          from: "2026-08-01",
          to: "2026-08-31",
        }),
      ),
    ).toBe(6);
  });
});

describe("activePaymentFilterChips", () => {
  it("names each chip in the register's vocabulary", () => {
    const filters = parsePaymentFilters({
      section: "all",
      status: "FAILED",
      method: "ACH",
      vendor: "v1",
      from: "2026-08-01",
    });

    const chips = activePaymentFilterChips(filters, {
      vendorNameById: { v1: "Datadog" },
      formatDate: () => "Aug 1, 2026",
    });

    expect(chips.map((chip) => [chip.group, chip.value])).toEqual([
      ["Status", "Failed"],
      ["Method", "ACH transfer"],
      ["Vendor", "Datadog"],
      ["Sending on or after", "Aug 1, 2026"],
    ]);
  });

  it("hands back a patch that removes only that chip", () => {
    const filters = parsePaymentFilters({ method: "ACH,WIRE" });
    const chips = activePaymentFilterChips(filters);

    expect(chips[0].removePatch).toEqual({ methods: ["WIRE"] });
    expect(chips[1].removePatch).toEqual({ methods: ["ACH"] });
  });

  it("falls back to the vendor id when no name was supplied", () => {
    const chips = activePaymentFilterChips(
      parsePaymentFilters({ vendor: "v9" }),
    );

    expect(chips[0].value).toBe("v9");
  });
});
