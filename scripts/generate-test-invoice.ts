/**
 * Renders `test-invoice.pdf` in the repo root: one realistic invoice document
 * to drop into the OCR upload at `/bills/upload`.
 *
 * This is a FIXTURE, not a rehearsal. Two things are wrong with it on purpose,
 * and both are the point:
 *
 * 1. **The vendor is not in the seed.** Copperline Facilities Group exists
 *    nowhere in `prisma/seed-data.ts`, so vendor matching has to come back with
 *    "no match" and ask, instead of quietly binding the extraction to whichever
 *    seeded vendor scored highest.
 *
 * 2. **The total is more than the line items add up to.** Tax and a surcharge
 *    sit below the subtotal and are not line items, so Σ(lines) < total by
 *    design. ADR 0004 makes the total authoritative and requires the lines to
 *    reconcile to it; ADR 0010 says an extraction lands as a draft for review.
 *    Together they predict this document becomes a `Missing info` draft — and
 *    a run that produces anything else is a bug worth seeing.
 *
 * The PDF is committed so a reviewer can upload it straight after cloning.
 * Regenerate with `pnpm invoice:test`.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { formatCents } from "../src/lib/money";
import { PAGE_HEIGHT, PAGE_WIDTH, PdfPage, buildPdf } from "./pdf";

const OUT_FILE = join(process.cwd(), "test-invoice.pdf");

// ---------------------------------------------------------------------------
// The document's data. Mid-2026, to sit alongside the seeded demo.
// ---------------------------------------------------------------------------

/**
 * Invented on purpose — grep `prisma/seed-data.ts` and you will not find it.
 * A facilities contractor is a plausible thing for an office to owe money to,
 * which is what makes the "no match" prompt feel real rather than contrived.
 */
const VENDOR = {
  name: "Copperline Facilities Group",
  addressLine1: "4180 Bayshore Boulevard, Suite 210",
  addressLine2: "Oakland, CA 94607",
  email: "billing@copperlinefacilities.example",
  phone: "(510) 555-0148",
  taxId: "94-3827104",
  remittance: "First Cascade Bank - account ending 4417, routing ending 0021",
};

/** The demo company, same letterhead the seeded invoices are billed to. */
const BILL_TO = {
  name: "Northwind Labs, Inc.",
  addressLine1: "1200 Harrison Street, Suite 400",
  addressLine2: "San Francisco, CA 94103",
  email: "ap@northwind.example",
};

const INVOICE_NUMBER = "CFG-2026-04871";
const ISSUE_DATE = new Date(Date.UTC(2026, 6, 14));
const TERMS_DAYS = 30;
const TERMS_LABEL = "Net 30";
const SERVICE_PERIOD = "Jul 1 - Jul 31, 2026";

interface FixtureLine {
  description: string;
  quantity: number;
  unitPriceCents: number;
}

const LINES: FixtureLine[] = [
  {
    description: "Janitorial service - Suite 400, July 2026",
    quantity: 1,
    unitPriceCents: 285_000,
  },
  {
    description: "HVAC filter replacement - quarterly programme",
    quantity: 12,
    unitPriceCents: 4_650,
  },
  {
    description: "After-hours plumbing call-out - 2nd floor",
    quantity: 4,
    unitPriceCents: 16_500,
  },
  {
    description: "Restroom consumables restock",
    quantity: 6,
    unitPriceCents: 7_825,
  },
];

/**
 * The two amounts that live BELOW the subtotal rather than in the table. They
 * are what pushes the total past Σ(lines) — a real invoice does this constantly
 * and an extractor that only sums the table will always come up short.
 */
const SALES_TAX_RATE = 0.08625; // Alameda County combined rate, mid-2026.
const SURCHARGE_RATE = 0.015;

// ---------------------------------------------------------------------------
// Derived figures — computed, so the document can never disagree with itself.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_DATE = new Date(ISSUE_DATE.getTime() + TERMS_DAYS * DAY_MS);

const lineAmounts = LINES.map((line) => ({
  ...line,
  amountCents: line.quantity * line.unitPriceCents,
}));

const SUBTOTAL_CENTS = lineAmounts.reduce(
  (sum, line) => sum + line.amountCents,
  0,
);
const TAX_CENTS = Math.round(SUBTOTAL_CENTS * SALES_TAX_RATE);
const SURCHARGE_CENTS = Math.round(SUBTOTAL_CENTS * SURCHARGE_RATE);
const TOTAL_CENTS = SUBTOTAL_CENTS + TAX_CENTS + SURCHARGE_CENTS;

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

// ---------------------------------------------------------------------------
// Layout — the same one-page shape as the seeded placeholders.
// ---------------------------------------------------------------------------

function renderTestInvoice(): Buffer {
  const page = new PdfPage();
  const left = 56;
  const right = PAGE_WIDTH - 56;

  // Header ------------------------------------------------------------------
  page.box(0, PAGE_HEIGHT - 128, PAGE_WIDTH, 128, 0.97);
  page.gray(0);
  page.text(left, PAGE_HEIGHT - 60, 18, "F2", VENDOR.name);
  page.gray(0.35);
  [
    VENDOR.addressLine1,
    VENDOR.addressLine2,
    VENDOR.email,
    VENDOR.phone,
  ].forEach((line, index) => {
    page.text(left, PAGE_HEIGHT - 78 - index * 12, 9, "F1", line);
  });

  page.gray(0);
  page.textRight(right, PAGE_HEIGHT - 60, 22, "F2", "INVOICE");
  page.gray(0.35);
  page.textRight(right, PAGE_HEIGHT - 80, 10, "F1", INVOICE_NUMBER);

  // Meta --------------------------------------------------------------------
  let y = PAGE_HEIGHT - 172;
  page.gray(0.45);
  page.text(left, y, 8, "F2", "BILL TO");
  page.textRight(right, y, 8, "F2", "INVOICE DETAILS");
  y -= 16;

  page.gray(0);
  page.text(left, y, 10, "F2", BILL_TO.name);
  page.textRight(right, y, 9, "F1", `Issued  ${DATE_FORMAT.format(ISSUE_DATE)}`);
  y -= 13;
  page.gray(0.35);
  page.text(left, y, 9, "F1", BILL_TO.addressLine1);
  page.textRight(right, y, 9, "F1", `Terms  ${TERMS_LABEL}`);
  y -= 13;
  page.text(left, y, 9, "F1", BILL_TO.addressLine2);
  page.textRight(right, y, 9, "F1", `Due  ${DATE_FORMAT.format(DUE_DATE)}`);
  y -= 13;
  page.text(left, y, 9, "F1", BILL_TO.email);
  page.textRight(right, y, 9, "F1", `Tax ID  ${VENDOR.taxId}`);
  y -= 13;
  page.textRight(right, y, 9, "F1", `Service period  ${SERVICE_PERIOD}`);

  // Line item table ---------------------------------------------------------
  y -= 44;
  const qtyX = 400;
  const unitX = 480;
  const amountX = right;

  page.box(left - 8, y - 6, right - left + 16, 22, 0.93);
  page.gray(0.25);
  page.text(left, y, 8, "F2", "DESCRIPTION");
  page.textRight(qtyX, y, 8, "F2", "QTY");
  page.textRight(unitX, y, 8, "F2", "UNIT PRICE");
  page.textRight(amountX, y, 8, "F2", "AMOUNT");
  y -= 24;

  for (const line of lineAmounts) {
    page.gray(0);
    page.text(left, y, 10, "F1", line.description);
    page.textRight(qtyX, y, 10, "F1", String(line.quantity));
    page.textRight(unitX, y, 10, "F1", formatCents(line.unitPriceCents));
    page.textRight(amountX, y, 10, "F1", formatCents(line.amountCents));
    y -= 14;
    page.rule(left, y + 4, right, 0.4, 0.88);
    y -= 10;
  }

  // Totals ------------------------------------------------------------------
  y -= 8;
  page.rule(unitX - 40, y + 16, right, 0.8, 0.6);

  const summaryRows: Array<[string, number]> = [
    ["Subtotal", SUBTOTAL_CENTS],
    [`Sales tax (${(SALES_TAX_RATE * 100).toFixed(3)}%)`, TAX_CENTS],
    ["Fuel & environmental surcharge", SURCHARGE_CENTS],
  ];

  for (const [label, cents] of summaryRows) {
    page.gray(0.4);
    page.textRight(unitX + 20, y, 9, "F1", label);
    page.gray(0);
    page.textRight(amountX, y, 10, "F1", formatCents(cents));
    y -= 18;
  }

  y -= 6;
  page.box(unitX - 90, y - 8, right - unitX + 98, 26, 0.93);
  page.gray(0);
  page.textRight(unitX - 10, y, 11, "F2", "Total due");
  page.textRight(amountX, y, 13, "F2", formatCents(TOTAL_CENTS));

  // Footer ------------------------------------------------------------------
  page.gray(0.45);
  page.text(
    left,
    116,
    8,
    "F1",
    `Payable ${TERMS_LABEL}. Remit to ${VENDOR.remittance}.`,
  );
  page.text(
    left,
    104,
    8,
    "F1",
    `Please quote invoice ${INVOICE_NUMBER} with your remittance advice.`,
  );
  page.text(
    left,
    80,
    8,
    "F1",
    "Test fixture generated for the Bill Pay demo. Not a real invoice.",
  );

  return buildPdf(page);
}

// ---------------------------------------------------------------------------

function main() {
  writeFileSync(OUT_FILE, renderTestInvoice());

  const gapCents = TOTAL_CENTS - SUBTOTAL_CENTS;

  console.log(`Wrote ${OUT_FILE}`);
  console.log(`  Vendor        ${VENDOR.name} (deliberately not in the seed)`);
  console.log(`  Invoice       ${INVOICE_NUMBER}`);
  console.log(
    `  Issued / due  ${DATE_FORMAT.format(ISSUE_DATE)} / ${DATE_FORMAT.format(DUE_DATE)} (${TERMS_LABEL})`,
  );
  console.log(`  Line items    ${formatCents(SUBTOTAL_CENTS)} over ${LINES.length} lines`);
  console.log(`  Total due     ${formatCents(TOTAL_CENTS)}`);
  console.log(
    `  Expect a Missing info draft: the lines are ${formatCents(gapCents)} short of the total.`,
  );
}

main();
