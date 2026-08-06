/**
 * Renders one placeholder invoice PDF per seeded bill into `public/invoices/`.
 *
 * These stand in for the real scanned documents: the bill detail page shows
 * them in the invoice preview pane. They are generated from the SAME data the
 * seed writes to Postgres (`prisma/seed-compute.ts`), so the document always
 * matches the row.
 *
 * The PDFs are committed to the repo — regenerate with `pnpm invoices:generate`
 * only when the seed data changes.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { VENDORS } from "../prisma/seed-data";
import { COMPUTED_BILLS, invoiceFileName } from "../prisma/seed-compute";
import { PAGE_HEIGHT, PAGE_WIDTH, PdfPage, buildPdf } from "./pdf";

const OUT_DIR = join(process.cwd(), "public", "invoices");

const COMPANY = {
  name: "Northwind Labs, Inc.",
  addressLine1: "1200 Harrison Street, Suite 400",
  addressLine2: "San Francisco, CA 94103",
  email: "ap@northwind.example",
};

// ---------------------------------------------------------------------------
// Invoice layout
// ---------------------------------------------------------------------------

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const TERMS_LABELS: Record<string, string> = {
  DUE_ON_RECEIPT: "Due on receipt",
  NET_15: "Net 15",
  NET_30: "Net 30",
  NET_45: "Net 45",
  NET_60: "Net 60",
  NET_90: "Net 90",
};

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function renderInvoice(bill: (typeof COMPUTED_BILLS)[number]): Buffer {
  const vendor = VENDORS.find((v) => v.key === bill.spec.vendorKey);
  if (!vendor) throw new Error(`Unknown vendor: ${bill.spec.vendorKey}`);

  const page = new PdfPage();
  const left = 56;
  const right = PAGE_WIDTH - 56;

  // Header ----------------------------------------------------------------
  page.box(0, PAGE_HEIGHT - 118, PAGE_WIDTH, 118, 0.97);
  page.gray(0);
  page.text(left, PAGE_HEIGHT - 60, 18, "F2", vendor.name);
  page.gray(0.35);
  // A vendor may legitimately have no remittance address — that is what makes
  // the check rail unusable for it — so the letterhead collapses to the lines
  // it actually has rather than printing "undefined, undefined undefined".
  const cityLine = [vendor.city, vendor.state].filter(Boolean).join(", ");
  const addressLines = [
    vendor.addressLine1,
    [cityLine, vendor.postalCode].filter(Boolean).join(" "),
    vendor.email,
  ].filter((line): line is string => typeof line === "string" && line.trim() !== "");

  addressLines.forEach((line, index) => {
    page.text(left, PAGE_HEIGHT - 78 - index * 12, 9, "F1", line);
  });

  page.gray(0);
  page.textRight(right, PAGE_HEIGHT - 60, 22, "F2", "INVOICE");
  page.gray(0.35);
  page.textRight(right, PAGE_HEIGHT - 80, 10, "F1", bill.spec.billNumber);

  // Meta ------------------------------------------------------------------
  let y = PAGE_HEIGHT - 160;
  page.gray(0.45);
  page.text(left, y, 8, "F2", "BILL TO");
  page.textRight(right, y, 8, "F2", "INVOICE DETAILS");
  y -= 16;

  page.gray(0);
  page.text(left, y, 10, "F2", COMPANY.name);
  page.textRight(right, y, 9, "F1", `Issued  ${DATE_FORMAT.format(bill.issueDate)}`);
  y -= 13;
  page.gray(0.35);
  page.text(left, y, 9, "F1", COMPANY.addressLine1);
  page.textRight(right, y, 9, "F1", `Due  ${DATE_FORMAT.format(bill.dueDate)}`);
  y -= 13;
  page.text(left, y, 9, "F1", COMPANY.addressLine2);
  page.textRight(
    right,
    y,
    9,
    "F1",
    `Terms  ${TERMS_LABELS[bill.spec.terms] ?? bill.spec.terms}`,
  );
  y -= 13;
  page.text(left, y, 9, "F1", COMPANY.email);
  if (vendor.taxId) {
    page.textRight(right, y, 9, "F1", `Tax ID  ${vendor.taxId}`);
  }

  // Line item table --------------------------------------------------------
  y -= 44;
  const qtyX = 400;
  const unitX = 480;
  const amountX = right;

  page.box(left - 8, y - 6, right - left + 16, 22, 0.93);
  page.gray(0.25);
  page.text(left, y, 8, "F2", "DESCRIPTION");
  page.textRight(qtyX, y, 8, "F2", "QTY");
  page.textRight(unitX, y, 8, "F2", "UNIT");
  page.textRight(amountX, y, 8, "F2", "AMOUNT");
  y -= 24;

  page.gray(0);
  if (bill.lines.length === 0) {
    page.gray(0.5);
    page.text(left, y, 10, "F1", "See attached statement for the itemised detail.");
    y -= 20;
    page.gray(0);
  }

  for (const line of bill.lines) {
    page.text(left, y, 10, "F1", truncate(line.description, 58));
    page.textRight(qtyX, y, 10, "F1", String(line.quantity));
    page.textRight(unitX, y, 10, "F1", money(line.unitPriceCents));
    page.textRight(amountX, y, 10, "F1", money(line.amountCents));
    y -= 12;
    if (line.department) {
      page.gray(0.5);
      page.text(left + 10, y, 8, "F1", line.department);
      page.gray(0);
      y -= 12;
    }
    page.rule(left, y + 4, right, 0.4, 0.88);
    y -= 10;
  }

  // Totals -----------------------------------------------------------------
  y -= 8;
  page.rule(unitX - 40, y + 16, right, 0.8, 0.6);
  page.gray(0.4);
  page.textRight(unitX + 20, y, 9, "F1", "Subtotal");
  page.gray(0);
  page.textRight(amountX, y, 10, "F1", money(bill.lineTotalCents || bill.totalCents));
  y -= 20;

  page.gray(0.4);
  page.textRight(unitX + 20, y, 9, "F1", "Tax");
  page.gray(0);
  page.textRight(amountX, y, 10, "F1", money(0));
  y -= 24;

  page.box(unitX - 90, y - 8, right - unitX + 98, 26, 0.93);
  page.gray(0);
  page.textRight(unitX - 10, y, 11, "F2", "Total due");
  page.textRight(amountX, y, 13, "F2", money(bill.totalCents));

  // Footer -----------------------------------------------------------------
  page.gray(0.45);
  page.text(
    left,
    92,
    8,
    "F1",
    `Remit to ${vendor.bankName} - account ending ${vendor.accountLast4}, routing ending ${vendor.routingLast4}.`,
  );
  page.text(
    left,
    80,
    8,
    "F1",
    "Placeholder document generated for the Bill Pay demo. Not a real invoice.",
  );

  return buildPdf(page);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

// ---------------------------------------------------------------------------

function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  let written = 0;
  for (const bill of COMPUTED_BILLS) {
    if (bill.spec.noInvoice) continue;
    const fileName = invoiceFileName(bill.spec.billNumber);
    writeFileSync(join(OUT_DIR, fileName), renderInvoice(bill));
    written += 1;
  }

  console.log(`Generated ${written} placeholder invoice PDFs in public/invoices/`);
}

main();
