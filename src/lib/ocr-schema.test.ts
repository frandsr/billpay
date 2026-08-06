import { describe, expect, it } from "vitest";

import {
  buildExtractionResult,
  looksLikeSummaryLabel,
  normalizeOcrRawResult,
  normalizeSummaryLabel,
  partitionSummaryRows,
  reconcileExtraction,
  type ExtractedLineItem,
  type InvoiceExtractionPayload,
  type InvoiceExtractionPayloadLine,
} from "@/lib/ocr-schema";

/**
 * The summary-block guard.
 *
 * The bug these cover: a model returns the invoice's summary block — Subtotal,
 * Tax, Total due — as if those rows were line items. Σ(lines) then double-counts
 * the invoice ($3,635.40 against a $1,817.70 total) and no amount of human
 * coding can make it reconcile.
 *
 * Two properties matter and they pull against each other:
 *  * a summary row must not survive as a line item, and
 *  * a REAL line must never be dropped, even when it is called "Tax
 *    preparation services" or "Shipping crate assembly".
 *
 * The second one wins ties: a surviving summary row is caught by the existing
 * "lines do not sum to the total" warning (ADR 0004), whereas a vanished real
 * line corrupts the coding silently.
 */

function line(
  description: string,
  amount: string,
  extra: Partial<InvoiceExtractionPayloadLine> = {},
): InvoiceExtractionPayloadLine {
  return {
    description,
    quantity: extra.quantity ?? null,
    unitPrice: extra.unitPrice ?? null,
    amount,
  };
}

function payload(
  lineItems: InvoiceExtractionPayloadLine[],
  totalAmount: string,
): InvoiceExtractionPayload {
  return {
    vendorName: "Adobe Inc.",
    invoiceNumber: "ADB-55901",
    issueDate: "2026-06-01",
    dueDate: "2026-07-01",
    currency: "USD",
    totalAmount,
    lineItems,
    notes: [],
  };
}

function item(
  description: string,
  amountCents: number,
  extra: Partial<ExtractedLineItem> = {},
): ExtractedLineItem {
  return {
    description,
    quantity: extra.quantity ?? 1,
    unitPriceCents: extra.unitPriceCents ?? amountCents,
    amountCents,
    confidenceBasisPoints: null,
  };
}

// ---------------------------------------------------------------------------

describe("normalizeSummaryLabel", () => {
  it("strips casing, punctuation and rates so variants collapse onto one label", () => {
    expect(normalizeSummaryLabel("Sub-total")).toBe("sub total");
    expect(normalizeSummaryLabel("SUBTOTAL:")).toBe("subtotal");
    expect(normalizeSummaryLabel("Sales tax 8.625%")).toBe("sales tax");
    expect(normalizeSummaryLabel("VAT @ 20 %")).toBe("vat");
    expect(normalizeSummaryLabel("Shipping & handling")).toBe("shipping handling");
    expect(normalizeSummaryLabel("Subtotal (USD)")).toBe("subtotal");
    expect(normalizeSummaryLabel("Total   1,817.70")).toBe("total");
  });

  it("leaves a real description recognisable", () => {
    expect(normalizeSummaryLabel("Tax preparation services")).toBe(
      "tax preparation services",
    );
    expect(normalizeSummaryLabel("Creative Cloud - 18 licences Marketing")).toBe(
      "creative cloud licences marketing",
    );
  });
});

describe("looksLikeSummaryLabel", () => {
  it("matches the summary labels an invoice actually prints", () => {
    for (const label of [
      "Subtotal",
      "Sub-total",
      "Sales tax 8.625%",
      "Tax",
      "VAT",
      "Total due",
      "Amount due",
      "Balance due",
      "Shipping & handling",
      "Fuel surcharge",
      "Less discount",
      "Rounding adjustment",
    ]) {
      expect(looksLikeSummaryLabel(label), label).toBe(true);
    }
  });

  it("never matches a description that merely CONTAINS a summary word", () => {
    for (const description of [
      "Tax preparation services",
      "Shipping crate assembly",
      "Freight elevator inspection",
      "Total Quality Management workshop",
      "VAT registration filing",
      "Discount code platform licence",
      "Creative Cloud - 18 licences Marketing",
    ]) {
      expect(looksLikeSummaryLabel(description), description).toBe(false);
    }
  });

  it("is false for an empty or unreadable description", () => {
    expect(looksLikeSummaryLabel("")).toBe(false);
    expect(looksLikeSummaryLabel(null)).toBe(false);
    expect(looksLikeSummaryLabel("12,345.00")).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("buildExtractionResult — the adb-55901 case", () => {
  // Exactly what the model returned for public/invoices/adb-55901.pdf: two real
  // licence lines followed by the invoice's subtotal and a zero tax row.
  const result = buildExtractionResult(
    payload(
      [
        line("Creative Cloud - 18 licences Marketing", "1,529.82", {
          quantity: 18,
          unitPrice: "84.99",
        }),
        line("Acrobat Pro - 12 licences Operations", "287.88", {
          quantity: 12,
          unitPrice: "23.99",
        }),
        line("Subtotal", "1,817.70"),
        line("Tax", "0.00"),
      ],
      "1,817.70",
    ),
  );

  it("keeps only the two itemised licence lines", () => {
    expect(result.lineItems.map((entry) => entry.description)).toEqual([
      "Creative Cloud - 18 licences Marketing",
      "Acrobat Pro - 12 licences Operations",
    ]);
  });

  it("reconciles against the authoritative total instead of double-counting", () => {
    expect(result.lineTotalCents).toBe(181_770);
    expect(reconcileExtraction(result)).toMatchObject({
      totalCents: 181_770,
      lineTotalCents: 181_770,
      differenceCents: 0,
      reconciles: true,
    });
  });

  it("no longer raises the sum mismatch warning", () => {
    expect(
      result.warnings.some((warning) => warning.includes("Extracted line items sum to")),
    ).toBe(false);
  });

  it("records both dropped rows with a reviewer-facing reason", () => {
    expect(result.removedSummaryRows).toEqual([
      {
        description: "Subtotal",
        amountCents: 181_770,
        matchedLabel: "subtotal",
        // Tax is zero on this invoice, so the subtotal IS the total — the
        // strongest signal available, and the one reported.
        reason: "its amount equals the extracted invoice total",
      },
      {
        description: "Tax",
        amountCents: 0,
        matchedLabel: "tax",
        reason: "it carries no quantity or unit price of its own",
      },
    ]);
  });

  it("tells the reviewer what was not imported", () => {
    expect(result.warnings).toContain(
      "2 summary rows were not imported as line items: Subtotal ($1,817.70), Tax ($0.00). " +
        "Tax and fees belong to the invoice total, which is captured separately.",
    );
  });
});

describe("buildExtractionResult — other summary rows", () => {
  it("drops a percentage-labelled sales tax row", () => {
    const result = buildExtractionResult(
      payload(
        [
          line("Janitorial service - Suite 400, July 2026", "2,850.00", {
            quantity: 1,
            unitPrice: "2,850.00",
          }),
          line("HVAC filter replacement - quarterly programme", "558.00", {
            quantity: 12,
            unitPrice: "46.50",
          }),
          line("Sales tax 8.625%", "294.00"),
        ],
        "3,702.00",
      ),
    );

    expect(result.lineItems).toHaveLength(2);
    expect(result.removedSummaryRows).toHaveLength(1);
    expect(result.removedSummaryRows[0]).toMatchObject({
      description: "Sales tax 8.625%",
      matchedLabel: "sales tax",
    });
    // ADR 0004: the gap is real in the document and stays visible.
    expect(result.lineTotalCents).toBe(340_800);
    expect(reconcileExtraction(result).reconciles).toBe(false);
  });

  it("drops a 'Total due' row that restates the invoice total", () => {
    const result = buildExtractionResult(
      payload(
        [
          line("Annual support retainer", "4,000.00", {
            quantity: 1,
            unitPrice: "4,000.00",
          }),
          line("Total due", "4,000.00"),
        ],
        "4,000.00",
      ),
    );

    expect(result.lineItems.map((entry) => entry.description)).toEqual([
      "Annual support retainer",
    ]);
    expect(result.removedSummaryRows[0]).toMatchObject({
      description: "Total due",
      matchedLabel: "total due",
      reason: "its amount equals the extracted invoice total",
    });
    expect(reconcileExtraction(result).reconciles).toBe(true);
  });

  it("keeps a legitimate line whose description contains 'tax' or 'shipping'", () => {
    const result = buildExtractionResult(
      payload(
        [
          line("Tax preparation services", "1,200.00", {
            quantity: 1,
            unitPrice: "1,200.00",
          }),
          line("Shipping crate assembly", "450.00", {
            quantity: 1,
            unitPrice: "450.00",
          }),
          line("Subtotal", "1,650.00"),
        ],
        "1,650.00",
      ),
    );

    expect(result.lineItems.map((entry) => entry.description)).toEqual([
      "Tax preparation services",
      "Shipping crate assembly",
    ]);
    expect(result.removedSummaryRows.map((row) => row.description)).toEqual(["Subtotal"]);
  });

  it("lets an unrecognised summary row survive so the mismatch warning still fires", () => {
    const result = buildExtractionResult(
      payload(
        [
          line("Platform subscription - monthly", "420.00", {
            quantity: 1,
            unitPrice: "420.00",
          }),
          // Not on the label list — the guard has no business guessing.
          line("Sum of the above", "420.00"),
        ],
        "420.00",
      ),
    );

    expect(result.lineItems).toHaveLength(2);
    expect(result.removedSummaryRows).toHaveLength(0);
    expect(result.lineTotalCents).toBe(84_000);
    expect(reconcileExtraction(result).reconciles).toBe(false);
    expect(
      result.warnings.some((warning) =>
        warning.includes("Extracted line items sum to more than the extracted total"),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("partitionSummaryRows", () => {
  it("keeps a summary-labelled row that has a real quantity and price", () => {
    // "Shipping" charged as 3 crates at $15 is a charge line, not a totals row.
    const rows = [
      item("Consulting", 100_000),
      item("Shipping", 4_500, { quantity: 3, unitPriceCents: 1_500 }),
    ];

    const { lineItems, removed } = partitionSummaryRows(rows, 104_500);
    expect(lineItems).toHaveLength(2);
    expect(removed).toHaveLength(0);
  });

  it("never drops every row, even when they all look like summary labels", () => {
    const rows = [item("Subtotal", 50_000), item("Tax", 4_000)];

    const { lineItems, removed } = partitionSummaryRows(rows, 54_000);
    expect(lineItems).toHaveLength(2);
    expect(removed).toHaveLength(0);
  });

  it("does not call a zero amount a match against a zero total", () => {
    const rows = [item("Design work", 0), item("Total", 0)];

    const { lineItems, removed } = partitionSummaryRows(rows, 0);
    expect(lineItems.map((entry) => entry.description)).toEqual(["Design work"]);
    // Dropped on the missing quantity, not on "0 === 0" — an all-zero read must
    // not be evidence of anything.
    expect(removed[0].reason).toBe("it carries no quantity or unit price of its own");
  });

  it("works with no header total to compare against", () => {
    const rows = [
      item("Racking install", 120_000, { quantity: 4, unitPriceCents: 30_000 }),
      item("Subtotal", 120_000),
    ];

    const { lineItems, removed } = partitionSummaryRows(rows, null);
    expect(lineItems.map((entry) => entry.description)).toEqual(["Racking install"]);
    expect(removed[0].reason).toBe("its amount equals the sum of the line items above it");
  });
});

// ---------------------------------------------------------------------------

describe("normalizeOcrRawResult", () => {
  it("round-trips the removed rows through a persisted rawResult", () => {
    const result = buildExtractionResult(
      payload(
        [
          line("Creative Cloud - 18 licences Marketing", "1,529.82", {
            quantity: 18,
            unitPrice: "84.99",
          }),
          line("Acrobat Pro - 12 licences Operations", "287.88", {
            quantity: 12,
            unitPrice: "23.99",
          }),
          line("Subtotal", "1,817.70"),
          line("Tax", "0.00"),
        ],
        "1,817.70",
      ),
    );

    const readBack = normalizeOcrRawResult(JSON.parse(JSON.stringify(result)));
    expect(readBack?.removedSummaryRows).toEqual(result.removedSummaryRows);
    expect(readBack?.lineItems).toHaveLength(2);
  });

  it("reads an older extraction that predates the guard as 'nothing dropped'", () => {
    const readBack = normalizeOcrRawResult({
      currency: "USD",
      fields: { totalCents: { value: 689_000, confidenceBasisPoints: 7_400 } },
      lineItems: [
        { description: "Support retainer", quantity: 1, unitPriceCents: 624_000, amountCents: 624_000 },
      ],
      lineTotalCents: 624_000,
      warnings: [],
    });

    expect(readBack?.removedSummaryRows).toEqual([]);
    expect(readBack?.lineItems).toHaveLength(1);
  });
});
