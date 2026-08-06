import "server-only";

import type { InvoiceExtractionPayload } from "@/lib/ocr-schema";
import { toIsoDate } from "@/lib/ocr-schema";
import { addDays, todayUtc } from "@/lib/dates";

import type { InvoiceDocument } from "./types";

/**
 * The deterministic fallback extractor.
 *
 * It exists so the product runs with no `GEMINI_API_KEY` and so a reviewer who
 * clones the repo sees the whole OCR path — upload, review, draft, `Missing
 * info` — without a secret. ADR 0010: the build never depends on a key being
 * present.
 *
 * "Deterministic" means the same file always reads the same way: every value
 * below is a pure function of the file's name and bytes. The two dates are the
 * exception — they are anchored on today so a fresh draft looks current rather
 * than four years stale.
 *
 * It deliberately produces lines that do NOT sum to the total. That is the
 * realistic failure mode ADR 0004 was designed around, and it is what puts the
 * resulting draft in `Missing info` where a human has to look at it.
 */

export const MOCK_PROVIDER = "mock-ocr";
export const MOCK_MODEL = "deterministic-mock-v1";

/** Confidence the mock reports, in basis points. Below-90% values are the ones
 *  the review panel flags, which is the behaviour worth demonstrating. */
export const MOCK_CONFIDENCE = {
  overall: 7400,
  vendorName: 9650,
  billNumber: 9880,
  issueDate: 9310,
  dueDate: 8720,
  paymentTerms: 8600,
  totalCents: 7400,
  lineItems: 6900,
} as const;

const FALLBACK_VENDORS = [
  "Northwind Traders",
  "Harbourline Supply",
  "Meridian Print Works",
];

const LINE_CATALOGUE: { description: string; unitPrice: number; quantity: number }[] = [
  { description: "Professional services — implementation", unitPrice: 18_500, quantity: 12 },
  { description: "Platform subscription — monthly", unitPrice: 42_000, quantity: 1 },
  { description: "Support retainer", unitPrice: 9_500, quantity: 4 },
  { description: "Onsite installation", unitPrice: 27_500, quantity: 2 },
  { description: "Hardware — rack units", unitPrice: 63_000, quantity: 3 },
  { description: "Training workshop — per seat", unitPrice: 15_000, quantity: 6 },
];

export interface MockExtractionOptions {
  /** Existing vendor names, so the mock reads as a vendor we can actually match
   *  and the confirm-the-vendor step has something to confirm. */
  vendorNames?: readonly string[];
  /** Why the mock ran, surfaced to the reviewer as a note. */
  reason?: string;
}

export function extractWithMock(
  document: InvoiceDocument,
  options: MockExtractionOptions = {},
): { payload: InvoiceExtractionPayload; raw: unknown } {
  const seed = hashDocument(document);
  const random = makeRandom(seed);

  const vendorPool =
    options.vendorNames && options.vendorNames.length > 0
      ? options.vendorNames
      : FALLBACK_VENDORS;
  const vendorName = vendorPool[seed % vendorPool.length];

  const issueDate = addDays(todayUtc(), -(seed % 21));
  const dueDate = addDays(issueDate, 30);

  const lineCount = 2 + (seed % 3);
  const lines: { description: string; quantity: number; amountCents: number; unitPriceCents: number }[] =
    [];
  for (let index = 0; index < lineCount; index += 1) {
    const template = LINE_CATALOGUE[(seed + index * 7) % LINE_CATALOGUE.length];
    const quantity = Math.max(1, template.quantity + (random() % 3) - 1);
    const unitPriceCents = template.unitPrice + (random() % 40) * 25;
    lines.push({
      description: template.description,
      quantity,
      unitPriceCents,
      amountCents: quantity * unitPriceCents,
    });
  }

  const lineTotalCents = lines.reduce((total, line) => total + line.amountCents, 0);
  // The gap a scanner loses: tax plus a line that did not survive the scan.
  const unreadCents = 12_500 + (seed % 90) * 100;
  const totalCents = lineTotalCents + unreadCents;

  const notes = [
    options.reason ??
      "Read by the built-in mock extractor, not by a model — no GEMINI_API_KEY is configured.",
    "The extracted lines do not add up to the extracted total. Check the document for a line the scan missed before submitting.",
  ];

  const payload: InvoiceExtractionPayload = {
    vendorName,
    invoiceNumber: mockInvoiceNumber(vendorName, seed),
    issueDate: toIsoDate(issueDate),
    dueDate: toIsoDate(dueDate),
    currency: "USD",
    totalAmount: majorUnits(totalCents),
    lineItems: lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: majorUnits(line.unitPriceCents),
      amount: majorUnits(line.amountCents),
    })),
    notes,
  };

  return {
    payload,
    // The "provider response" for the mock is the payload plus how it was made,
    // so a mock run is as auditable as a real one.
    raw: {
      provider: MOCK_PROVIDER,
      model: MOCK_MODEL,
      seed,
      documentFileName: document.fileName,
      documentByteLength: document.bytes.byteLength,
      payload,
    },
  };
}

/** "AB-4821" — initials of the vendor plus a stable number from the seed. */
function mockInvoiceNumber(vendorName: string, seed: number): string {
  const initials =
    vendorName
      .split(/\s+/)
      .map((word) => word[0])
      .filter((char) => /[A-Za-z]/.test(char ?? ""))
      .join("")
      .slice(0, 3)
      .toUpperCase() || "INV";
  return `${initials}-${String(4000 + (seed % 5999))}`;
}

/** Integer cents as a plain decimal string, the shape a provider would print. */
function majorUnits(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** FNV-1a over the file name and bytes: same file in, same number out. */
function hashDocument(document: InvoiceDocument): number {
  let hash = 0x811c9dc5;
  const mix = (byte: number) => {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };

  for (let index = 0; index < document.fileName.length; index += 1) {
    mix(document.fileName.charCodeAt(index) & 0xff);
  }
  // Sample the bytes rather than reading all of them: a 5 MB scan should not
  // cost a full pass just to seed a demo.
  const bytes = document.bytes;
  const step = Math.max(1, Math.floor(bytes.byteLength / 512));
  for (let index = 0; index < bytes.byteLength; index += step) {
    mix(bytes[index]);
  }
  mix(bytes.byteLength & 0xff);

  return hash >>> 0;
}

/** Mulberry32 — small, seeded, and enough for demo jitter. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % 1000;
  };
}
