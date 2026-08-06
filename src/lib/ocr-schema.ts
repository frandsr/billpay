import { PAYMENT_TERMS, type PaymentTerms } from "@/lib/domain";
import { PAYMENT_TERMS_DAYS, dueDateFrom, fromDateInputValue } from "@/lib/dates";
import { formatCents, lineAmountCents, parseAmountToCents, sumCents } from "@/lib/money";

/**
 * The OCR extraction contract.
 *
 * Two shapes live here and they are deliberately distinct:
 *
 *  1. `InvoiceExtractionPayload` — what the MODEL is asked to fill in, described
 *     by `INVOICE_EXTRACTION_JSON_SCHEMA`. Money is a STRING, verbatim as
 *     printed on the document, because asking a language model for a float is
 *     asking for a rounding bug (see `@/lib/money`: amounts are integers).
 *  2. `OcrExtractionResult` — our normalised, integer-cent view, and exactly the
 *     shape persisted in `OcrExtraction.rawResult`. The seed writes this shape
 *     too, so the review panel has one thing to read whether the run came from
 *     the seed, the mock or Gemini.
 *
 * ADR 0010: the model is asked for STRUCTURED OUTPUT against this schema — never
 * for prose to be picked apart with regexes.
 * ADR 0004: the extracted header total is authoritative. When the extracted
 * lines do not sum to it we record a warning and let the draft land in
 * `Missing info`. We never quietly rewrite either number to make them agree.
 *
 * The summary-block guard (section 3b) is the deterministic half of the same
 * rule: a model that returns "Subtotal" and "Tax" as line items double-counts
 * the invoice, so those rows are filtered out here rather than being trusted to
 * the prompt alone. What it drops is recorded, never discarded silently.
 *
 * PURE MODULE: no Prisma, no React, no `next/*`, no I/O. Provider calls live in
 * `src/server/ocr/`.
 */

// ---------------------------------------------------------------------------
// 1. The provider-facing JSON schema
// ---------------------------------------------------------------------------

/**
 * Minimal JSON-Schema node, restricted to the OpenAPI 3.0 subset that Gemini's
 * `responseSchema` accepts. Typed rather than `any` so a typo in the schema is
 * a compile error instead of a 400 at runtime.
 */
export interface JsonSchemaNode {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean";
  description?: string;
  nullable?: boolean;
  enum?: string[];
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  propertyOrdering?: string[];
}

const MONEY_STRING_HINT =
  "The amount exactly as printed on the document, digits and separators only (e.g. \"6,890.00\"). Never round, never convert currency.";

export const INVOICE_EXTRACTION_JSON_SCHEMA: JsonSchemaNode = {
  type: "object",
  description:
    "Structured reading of a single supplier invoice document. Report only what is visible on the page; use null for anything you cannot read.",
  properties: {
    vendorName: {
      type: "string",
      nullable: true,
      description:
        "The supplier issuing the invoice (the party being paid), not the customer being billed.",
    },
    invoiceNumber: {
      type: "string",
      nullable: true,
      description:
        "The invoice/document number printed by the supplier, without any label prefix.",
    },
    issueDate: {
      type: "string",
      nullable: true,
      description: "Invoice date in ISO format, YYYY-MM-DD.",
    },
    dueDate: {
      type: "string",
      nullable: true,
      description: "Payment due date in ISO format, YYYY-MM-DD.",
    },
    currency: {
      type: "string",
      nullable: true,
      description: "ISO-4217 code of the amounts on the document, e.g. USD.",
    },
    totalAmount: {
      type: "string",
      nullable: true,
      description: `The invoice grand total (the amount due), which already includes any tax, discount, shipping or surcharge printed in the summary block. ${MONEY_STRING_HINT}`,
    },
    lineItems: {
      type: "array",
      description:
        "ONLY the itemised goods or services being charged: one entry per row of the invoice's line-item table, in the order printed. " +
        "Rows from the invoice's SUMMARY BLOCK are not line items and must NOT be returned here — subtotal, tax, sales tax, VAT, GST, discount, shipping, freight, surcharge, handling, service charge, balance due, amount due and total are all summary rows, whether they sit under the table or in a totals panel beside it. " +
        "Tax and fees belong to the grand total, which is reported separately in `totalAmount`. " +
        "Returning a subtotal or tax row here double-counts the invoice. " +
        "Never invent, split, merge or adjust a line to make the lines add up to the total — the total is authoritative and the lines are allowed to disagree with it.",
      items: {
        type: "object",
        properties: {
          description: {
            type: "string",
            nullable: true,
            description:
              'The line\'s printed description — the good or service supplied. Never a summary label such as "Subtotal", "Sales tax 8.625%", "Shipping & handling", "Balance due" or "Total".',
          },
          quantity: {
            type: "number",
            nullable: true,
            description: "Printed quantity. Use 1 when the line shows none.",
          },
          unitPrice: {
            type: "string",
            nullable: true,
            description: `The per-unit price. ${MONEY_STRING_HINT}`,
          },
          amount: {
            type: "string",
            nullable: true,
            description: `The line total. ${MONEY_STRING_HINT}`,
          },
        },
        required: ["description", "amount"],
        propertyOrdering: ["description", "quantity", "unitPrice", "amount"],
      },
    },
    notes: {
      type: "array",
      description:
        "Anything a human reviewer should check: unreadable figures, ambiguous dates, lines you were unsure about. Empty when the document read cleanly.",
      items: { type: "string" },
    },
  },
  required: [
    "vendorName",
    "invoiceNumber",
    "issueDate",
    "dueDate",
    "currency",
    "totalAmount",
    "lineItems",
    "notes",
  ],
  propertyOrdering: [
    "vendorName",
    "invoiceNumber",
    "issueDate",
    "dueDate",
    "currency",
    "totalAmount",
    "lineItems",
    "notes",
  ],
};

/** The payload the model is expected to return, matching the schema above. */
export interface InvoiceExtractionPayload {
  vendorName: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string | null;
  totalAmount: string | null;
  lineItems: InvoiceExtractionPayloadLine[];
  notes: string[];
}

export interface InvoiceExtractionPayloadLine {
  description: string | null;
  quantity: number | null;
  unitPrice: string | null;
  amount: string | null;
}

// ---------------------------------------------------------------------------
// 2. The normalised result — the shape stored in `OcrExtraction.rawResult`
// ---------------------------------------------------------------------------

/** A single read value plus how sure the provider was, in BASIS POINTS. */
export interface ExtractedField<T> {
  value: T | null;
  /** 0–10000. `null` when the provider does not report a confidence. */
  confidenceBasisPoints: number | null;
}

export interface ExtractedLineItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  confidenceBasisPoints: number | null;
}

/**
 * A row the model returned as a line item that was actually part of the
 * invoice's summary block, and so was NOT imported as a line item.
 *
 * Kept on the result — and therefore in `OcrExtraction.rawResult` — so the drop
 * is auditable and can be shown to the reviewer. Nothing disappears silently.
 */
export interface ExtractedSummaryRow {
  /** The row's description, verbatim as the model returned it. */
  description: string;
  amountCents: number;
  /** The normalised summary label that matched, e.g. "sales tax". */
  matchedLabel: string;
  /** Reviewer-facing reason the guard was confident enough to drop the row. */
  reason: string;
}

export interface OcrExtractionResult {
  /** The invoice DOCUMENT the run read (glossary: invoice != bill). */
  documentFileName: string | null;
  currency: string;
  fields: {
    vendorName: ExtractedField<string>;
    billNumber: ExtractedField<string>;
    /** "yyyy-MM-dd". */
    issueDate: ExtractedField<string>;
    dueDate: ExtractedField<string>;
    paymentTerms: ExtractedField<PaymentTerms>;
    totalCents: ExtractedField<number>;
  };
  lineItems: ExtractedLineItem[];
  /** Σ(lineItems.amountCents). Stored so the disagreement survives a re-read. */
  lineTotalCents: number;
  /**
   * Rows the summary-block guard removed from `lineItems`. Empty on a clean
   * read. Surfaced in the review UI so a reviewer can see what was dropped.
   */
  removedSummaryRows: ExtractedSummaryRow[];
  /** Reviewer-facing notes: what was inferred, what did not reconcile. */
  warnings: string[];
  /** The provider's verbatim response, kept so a review can be re-derived. */
  raw?: unknown;
  /** Model id behind the run, e.g. "gemini-3.1-flash-lite". */
  model?: string | null;
}

/** One attempt against one model, successful or not. Shown as the run trail. */
export interface ExtractionAttempt {
  provider: string;
  model: string;
  ok: boolean;
  /** Reviewer-facing reason the attempt failed. */
  error?: string;
  durationMs: number;
}

/**
 * A completed extraction plus everything needed to persist it.
 *
 * This is the wire shape between the upload step and the review step: the
 * server hands it to the review form and gets it back on save, where it is
 * re-validated before it becomes an `OcrExtraction` row.
 */
export interface ExtractionEnvelope {
  result: OcrExtractionResult;
  /** Stored on `OcrExtraction.provider`. */
  provider: string;
  model: string;
  /** 0–10000, or `null` when the provider reports no confidence. */
  confidenceBasisPoints: number | null;
  attempts: ExtractionAttempt[];
  /** True when every provider failed (or none was configured) and the
   *  deterministic mock produced this result. */
  usedFallback: boolean;
}

/**
 * Read an envelope back from the review form.
 *
 * The round trip goes through the browser, so this treats its input as
 * untrusted: an unreadable envelope becomes `null` and the save is rejected
 * rather than a half-built audit row being written.
 */
export function parseExtractionEnvelope(value: unknown): ExtractionEnvelope | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed)) return null;

  const result = normalizeOcrRawResult(parsed.result);
  if (!result) return null;

  const attempts = Array.isArray(parsed.attempts)
    ? parsed.attempts.filter(isRecord).map((attempt) => ({
        provider: String(attempt.provider ?? "unknown"),
        model: String(attempt.model ?? "unknown"),
        ok: attempt.ok === true,
        error: typeof attempt.error === "string" ? attempt.error : undefined,
        durationMs: asInteger(attempt.durationMs) ?? 0,
      }))
    : [];

  const confidence = asInteger(parsed.confidenceBasisPoints);

  return {
    result,
    provider: asString(parsed.provider) ?? "unknown",
    model: asString(parsed.model) ?? "unknown",
    confidenceBasisPoints:
      confidence === null ? null : Math.min(10_000, Math.max(0, confidence)),
    attempts,
    usedFallback: parsed.usedFallback === true,
  };
}

export const OCR_FIELD_KEYS = [
  "vendorName",
  "billNumber",
  "issueDate",
  "dueDate",
  "paymentTerms",
  "totalCents",
] as const;

export type OcrFieldKey = (typeof OCR_FIELD_KEYS)[number];

export const OCR_FIELD_LABELS: Record<OcrFieldKey, string> = {
  vendorName: "Vendor",
  billNumber: "Bill number",
  issueDate: "Issue date",
  dueDate: "Due date",
  paymentTerms: "Payment terms",
  totalCents: "Total",
};

/**
 * Below this, a field is called out as worth a second look. 85% is the point at
 * which the seeded demo run starts flagging: total (71.2%) and line items
 * (66.5%) are suspect, the vendor and bill number are not.
 */
export const LOW_CONFIDENCE_BASIS_POINTS = 8500;

export function isLowConfidence(
  confidenceBasisPoints: number | null | undefined,
): boolean {
  return (
    typeof confidenceBasisPoints === "number" &&
    confidenceBasisPoints < LOW_CONFIDENCE_BASIS_POINTS
  );
}

// ---------------------------------------------------------------------------
// 3. Building a result from a provider payload
// ---------------------------------------------------------------------------

export interface BuildExtractionOptions {
  documentFileName?: string | null;
  model?: string | null;
  /** Verbatim provider response, persisted alongside the normalised view. */
  raw?: unknown;
  /**
   * Per-field confidence, when the provider reports one. Gemini does not, so
   * these stay `null` rather than being invented — a fabricated confidence is
   * worse than an absent one.
   */
  confidence?: Partial<Record<OcrFieldKey | "lineItems", number>>;
}

/**
 * Convert a provider payload into the normalised, integer-cent result.
 *
 * Total: unparseable numbers become `null` plus a warning — never 0, which
 * would read as "this invoice is for nothing".
 */
export function buildExtractionResult(
  payload: InvoiceExtractionPayload,
  options: BuildExtractionOptions = {},
): OcrExtractionResult {
  const warnings: string[] = [];
  const confidence = options.confidence ?? {};

  const currency = normalizeCurrency(payload.currency);
  if (payload.currency && currency !== payload.currency.trim().toUpperCase()) {
    warnings.push(
      `Currency "${payload.currency}" was not recognised; the draft assumes ${currency}.`,
    );
  }

  const vendorName = trimToNull(payload.vendorName);
  if (!vendorName) warnings.push("No vendor name could be read from the document.");

  const billNumber = trimToNull(payload.invoiceNumber);
  if (!billNumber) warnings.push("No invoice number could be read from the document.");

  const issueDate = normalizeDateString(payload.issueDate);
  if (payload.issueDate && !issueDate) {
    warnings.push(`Issue date "${payload.issueDate}" could not be read as a date.`);
  }

  let dueDate = normalizeDateString(payload.dueDate);
  if (payload.dueDate && !dueDate) {
    warnings.push(`Due date "${payload.dueDate}" could not be read as a date.`);
  }

  const totalCents = parseAmountToCents(payload.totalAmount, currency);
  if (payload.totalAmount && totalCents === null) {
    warnings.push(
      `Invoice total "${payload.totalAmount}" could not be read as an amount.`,
    );
  } else if (!payload.totalAmount) {
    warnings.push("No invoice total could be read from the document.");
  }

  // Payment terms are never printed as an enum, so they are DERIVED from the
  // two dates. Say so — an inferred value should not look like a read one.
  let paymentTerms: PaymentTerms | null = null;
  if (issueDate && dueDate) {
    const inferred = inferPaymentTerms(issueDate, dueDate);
    paymentTerms = inferred.terms;
    warnings.push(
      inferred.exact
        ? "Payment terms were inferred from the issue and due dates, not read from the document."
        : `Payment terms were inferred as ${paymentTerms} from a ${inferred.days}-day gap between the issue and due dates, which matches no standard term exactly.`,
    );
  } else if (issueDate && !dueDate) {
    // A due date is required on a bill; default to the most common term and be
    // loud about it rather than leaving the draft without one.
    paymentTerms = "NET_30";
    dueDate = toIsoDate(dueDateFrom(requireDate(issueDate), "NET_30"));
    warnings.push(
      "No due date was found; the draft assumes Net 30 from the issue date. Confirm it before submitting.",
    );
  }

  const readLines = (payload.lineItems ?? [])
    .map((line) => normalizeLine(line, currency, confidence.lineItems ?? null))
    .filter((line): line is ExtractedLineItem => line !== null);

  // A model that returns the summary block as line items double-counts the
  // invoice, so the rows are removed here rather than trusted to the prompt.
  const { lineItems, removed: removedSummaryRows } = partitionSummaryRows(
    readLines,
    totalCents,
  );

  if (removedSummaryRows.length > 0) {
    warnings.push(summaryRowsWarning(removedSummaryRows, currency));
  }

  if (lineItems.length === 0) {
    warnings.push(
      "No line items could be read. Code the spend by hand before submitting this draft.",
    );
  }

  const lineTotalCents = sumCents(lineItems.map((line) => line.amountCents));

  // ADR 0004: surface the disagreement, never reconcile it.
  if (typeof totalCents === "number" && lineItems.length > 0 && lineTotalCents !== totalCents) {
    const direction = lineTotalCents < totalCents ? "less than" : "more than";
    warnings.push(
      `Extracted line items sum to ${direction} the extracted total — a line may be missing from or duplicated in the scan.`,
    );
  }

  for (const note of payload.notes ?? []) {
    const trimmed = trimToNull(note);
    if (trimmed) warnings.push(trimmed);
  }

  return {
    documentFileName: options.documentFileName ?? null,
    currency,
    fields: {
      vendorName: field(vendorName, confidence.vendorName),
      billNumber: field(billNumber, confidence.billNumber),
      issueDate: field(issueDate, confidence.issueDate),
      dueDate: field(dueDate, confidence.dueDate),
      paymentTerms: field(paymentTerms, confidence.paymentTerms),
      totalCents: field(totalCents, confidence.totalCents),
    },
    lineItems,
    lineTotalCents,
    removedSummaryRows,
    warnings: dedupe(warnings),
    raw: options.raw,
    model: options.model ?? null,
  };
}

function field<T>(
  value: T | null,
  confidenceBasisPoints: number | undefined,
): ExtractedField<T> {
  return {
    value,
    confidenceBasisPoints:
      typeof confidenceBasisPoints === "number" ? confidenceBasisPoints : null,
  };
}

function normalizeLine(
  line: InvoiceExtractionPayloadLine,
  currency: string,
  confidenceBasisPoints: number | null,
): ExtractedLineItem | null {
  const description = trimToNull(line?.description);
  const amountCents = parseAmountToCents(line?.amount ?? null, currency);
  const unitPriceRaw = parseAmountToCents(line?.unitPrice ?? null, currency);

  const quantity =
    typeof line?.quantity === "number" && Number.isFinite(line.quantity) && line.quantity > 0
      ? Math.round(line.quantity)
      : 1;

  // A line with neither a description nor an amount is noise from the scan.
  if (!description && amountCents === null) return null;

  const resolvedAmount =
    amountCents ?? (unitPriceRaw !== null ? lineAmountCents(quantity, unitPriceRaw) : 0);
  const resolvedUnitPrice =
    unitPriceRaw ?? (quantity > 0 ? Math.round(resolvedAmount / quantity) : resolvedAmount);

  return {
    description: description ?? "Unlabelled line",
    quantity,
    unitPriceCents: resolvedUnitPrice,
    amountCents: resolvedAmount,
    confidenceBasisPoints,
  };
}

// ---------------------------------------------------------------------------
// 3b. The summary-block guard
//
// Invoices print two different kinds of row and models conflate them: the
// itemised goods or services, and the summary block underneath (subtotal, tax,
// shipping, total due). Only the first kind is a line item. Returning the
// second kind as line items double-counts the invoice — an $1,817.70 bill whose
// "lines" sum to $3,635.40 — which then reads as a reconciliation failure that
// no amount of human coding can fix.
//
// The prompt asks the model not to do this. This is the layer that has to hold
// when it does it anyway.
//
// The rule is deliberately conservative. A row is dropped ONLY when BOTH hold:
//
//   1. Its description, normalised, IS a known summary label — a whole-string
//      match, never a substring. "Tax preparation services" and "Shipping crate
//      assembly" are goods and services and never match.
//   2. At least one CORROBORATING signal agrees that it is not a real charge
//      line: it has no real quantity (qty 1 with the unit price equal to the
//      amount), or its amount equals the extracted total, or its amount equals
//      the sum of the rows above it.
//
// Prefer a false negative to a false positive: a surviving summary row is
// caught by the existing "lines do not sum to the total" warning and a human
// deletes it, whereas a vanished real line silently corrupts the coding.
// ---------------------------------------------------------------------------

/**
 * Whole-string labels that mean "this is part of the summary block".
 *
 * Matched against `normalizeSummaryLabel` output, so punctuation, casing,
 * percentages and trailing amounts are already gone: "Sub-total", "SUBTOTAL"
 * and "Subtotal:" all arrive here as "sub total"/"subtotal".
 */
const SUMMARY_LABELS: ReadonlySet<string> = new Set([
  // Subtotals
  "subtotal",
  "sub total",
  "subtotals",
  "sub totals",
  "net subtotal",
  "line subtotal",
  "items subtotal",
  "subtotal before tax",
  // Totals and what is owed
  "total",
  "totals",
  "grand total",
  "final total",
  "gross total",
  "net total",
  "invoice total",
  "order total",
  "total due",
  "total amount",
  "total amount due",
  "total payable",
  "total invoice amount",
  "total charges",
  "total charge",
  "amount due",
  "amount payable",
  "amount owed",
  "amount owing",
  "amount remaining",
  "net amount",
  "net amount due",
  "net payable",
  "balance",
  "balance due",
  "balance owing",
  "balance remaining",
  "please pay this amount",
  // Tax
  "tax",
  "taxes",
  "sales tax",
  "sales taxes",
  "use tax",
  "state tax",
  "local tax",
  "city tax",
  "county tax",
  "tax total",
  "total tax",
  "tax amount",
  "taxable amount",
  "estimated tax",
  "vat",
  "vat total",
  "value added tax",
  "gst",
  "hst",
  "pst",
  "qst",
  "gst hst",
  "iva",
  "igv",
  // Discounts, credits and money already paid
  "discount",
  "discounts",
  "discount applied",
  "less discount",
  "trade discount",
  "volume discount",
  "early payment discount",
  "credit",
  "credits",
  "credit applied",
  "amount paid",
  "payments received",
  "less payments",
  "previous balance",
  "deposit",
  "deposit paid",
  // Shipping and fees printed below the table
  "shipping",
  "shipping handling",
  "shipping and handling",
  "handling",
  "handling charge",
  "freight",
  "freight charge",
  "delivery",
  "delivery charge",
  "postage",
  "postage and packing",
  "surcharge",
  "fuel surcharge",
  "service charge",
  "service fee",
  "processing fee",
  "admin fee",
  "administration fee",
  "administrative fee",
  "convenience fee",
  "late fee",
  // Rounding
  "rounding",
  "rounding adjustment",
  "rounding difference",
]);

/** Qualifiers a summary row may carry that do not change what it is. */
const SUMMARY_LEADING_QUALIFIERS = /^(?:less|plus|add|incl|including|est|estimated|total)\s+/;

/**
 * Reduce a printed description to the bare label it would be in a summary
 * block, or "" when there is nothing left to compare.
 *
 * Drops the decoration a totals row picks up — a rate ("Sales tax 8.625%"), a
 * parenthetical ("Subtotal (USD)"), an inline amount, punctuation — so the
 * comparison in `looksLikeSummaryLabel` can be an exact whole-string match.
 * That exactness is the whole safety property: it is why "Tax preparation
 * services" is not a tax row.
 */
export function normalizeSummaryLabel(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    // "Subtotal (USD)", "Tax [8.625%]"
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    // "Sales tax 8.625%", "VAT @ 20 %"
    .replace(/\d+(?:[.,]\d+)?\s*%/g, " ")
    // "Shipping $45.00", "Total 1,817.70"
    .replace(/[$€£¥]\s*\d[\d.,]*/g, " ")
    .replace(/\d[\d.,]*/g, " ")
    .replace(/[^a-z]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Whether a description IS a summary label rather than merely mentioning one.
 *
 * Whole-string only. "Tax" matches; "Tax preparation services" does not.
 */
export function looksLikeSummaryLabel(value: string | null | undefined): boolean {
  const normalized = normalizeSummaryLabel(value);
  if (!normalized) return false;
  if (SUMMARY_LABELS.has(normalized)) return true;

  // "Less discount", "Estimated sales tax" — the qualifier is noise.
  const stripped = normalized.replace(SUMMARY_LEADING_QUALIFIERS, "");
  return stripped !== normalized && SUMMARY_LABELS.has(stripped);
}

export interface SummaryRowPartition {
  /** The rows that are genuinely itemised goods or services. */
  lineItems: ExtractedLineItem[];
  /** The rows removed, with why. Empty on a clean read. */
  removed: ExtractedSummaryRow[];
}

/**
 * Split read rows into real line items and summary-block rows.
 *
 * `totalCents` is the extracted header total, used only as a corroborating
 * signal — ADR 0004 keeps it authoritative, and nothing here adjusts it or the
 * lines to make them agree.
 *
 * Two rails stop the guard from doing damage:
 *  * A row is never dropped on its label alone.
 *  * The last line is never dropped. If every row looks like a summary row the
 *    read is too strange to act on, so everything is kept and the existing
 *    reconciliation warning does the talking.
 */
export function partitionSummaryRows(
  lines: readonly ExtractedLineItem[],
  totalCents: number | null,
): SummaryRowPartition {
  const lineItems: ExtractedLineItem[] = [];
  const removed: ExtractedSummaryRow[] = [];
  let keptRunningTotal = 0;

  for (const line of lines) {
    const matchedLabel = looksLikeSummaryLabel(line.description)
      ? normalizeSummaryLabel(line.description)
      : null;

    if (matchedLabel === null) {
      lineItems.push(line);
      keptRunningTotal += line.amountCents;
      continue;
    }

    const reason = corroborateSummaryRow(line, totalCents, keptRunningTotal, lineItems.length);
    if (reason === null) {
      // The label matched but nothing else did — it may be a real charge line
      // called "Shipping". Keep it; the mismatch warning is the safety net.
      lineItems.push(line);
      keptRunningTotal += line.amountCents;
      continue;
    }

    removed.push({
      description: line.description,
      amountCents: line.amountCents,
      matchedLabel,
      reason,
    });
  }

  // Never leave the draft with nothing to code.
  if (lineItems.length === 0) {
    return { lineItems: [...lines], removed: [] };
  }

  return { lineItems, removed };
}

/**
 * The second half of the rule: evidence beyond the label that this row is not
 * an itemised charge. Returns the reviewer-facing reason, or `null` to keep.
 */
function corroborateSummaryRow(
  line: ExtractedLineItem,
  totalCents: number | null,
  precedingTotalCents: number,
  precedingCount: number,
): string | null {
  // Equals the whole invoice — a "Total due" row restated inside the table.
  if (totalCents !== null && line.amountCents === totalCents && totalCents !== 0) {
    return "its amount equals the extracted invoice total";
  }

  // Equals everything above it — the classic subtotal row.
  if (
    precedingCount > 0 &&
    line.amountCents !== 0 &&
    line.amountCents === precedingTotalCents
  ) {
    return "its amount equals the sum of the line items above it";
  }

  // No real quantity: a summary row is a single figure, not quantity × price.
  if (line.quantity <= 1 && (line.unitPriceCents === line.amountCents || line.unitPriceCents === 0)) {
    return "it carries no quantity or unit price of its own";
  }

  return null;
}

/** One reviewer-facing sentence naming every row the guard removed. */
function summaryRowsWarning(
  removed: readonly ExtractedSummaryRow[],
  currency: string,
): string {
  const listed = removed
    .map((row) => `${row.description} (${formatCents(row.amountCents, { currency })})`)
    .join(", ");
  const subject =
    removed.length === 1 ? "1 summary row was" : `${removed.length} summary rows were`;
  return `${subject} not imported as line items: ${listed}. Tax and fees belong to the invoice total, which is captured separately.`;
}

// ---------------------------------------------------------------------------
// 4. Reading a persisted `rawResult` back
// ---------------------------------------------------------------------------

/**
 * Tolerant read of an `OcrExtraction.rawResult` column.
 *
 * `rawResult` is a `Json` column written by three different producers (the
 * seed, the mock, Gemini) across time, so this never throws: unknown shapes
 * come back as `null` and the panel renders nothing rather than crashing the
 * bill detail page.
 */
export function normalizeOcrRawResult(raw: unknown): OcrExtractionResult | null {
  if (!isRecord(raw)) return null;

  const fieldsRaw = isRecord(raw.fields) ? raw.fields : {};
  const lineItemsRaw = Array.isArray(raw.lineItems) ? raw.lineItems : [];

  const lineItems: ExtractedLineItem[] = lineItemsRaw
    .map((entry): ExtractedLineItem | null => {
      if (!isRecord(entry)) return null;
      const amountCents = asInteger(entry.amountCents);
      const description = typeof entry.description === "string" ? entry.description : null;
      if (amountCents === null && !description) return null;
      const quantity = asInteger(entry.quantity) ?? 1;
      const unitPriceCents = asInteger(entry.unitPriceCents) ?? 0;
      return {
        description: description ?? "Unlabelled line",
        quantity: quantity > 0 ? quantity : 1,
        unitPriceCents,
        amountCents: amountCents ?? 0,
        confidenceBasisPoints: asInteger(entry.confidenceBasisPoints),
      };
    })
    .filter((line): line is ExtractedLineItem => line !== null);

  // Runs written before the summary-block guard existed have no such rows, so
  // an absent key reads as "nothing was dropped" rather than as a broken row.
  const removedSummaryRows: ExtractedSummaryRow[] = (
    Array.isArray(raw.removedSummaryRows) ? raw.removedSummaryRows : []
  )
    .map((entry): ExtractedSummaryRow | null => {
      if (!isRecord(entry)) return null;
      const description = asString(entry.description);
      if (!description) return null;
      return {
        description,
        amountCents: asInteger(entry.amountCents) ?? 0,
        matchedLabel: asString(entry.matchedLabel) ?? normalizeSummaryLabel(description),
        reason: asString(entry.reason) ?? "it reads as part of the invoice summary block",
      };
    })
    .filter((row): row is ExtractedSummaryRow => row !== null);

  return {
    documentFileName:
      typeof raw.documentFileName === "string" ? raw.documentFileName : null,
    currency: normalizeCurrency(typeof raw.currency === "string" ? raw.currency : null),
    fields: {
      vendorName: readField(fieldsRaw.vendorName, asString),
      billNumber: readField(fieldsRaw.billNumber, asString),
      issueDate: readField(fieldsRaw.issueDate, (value) =>
        normalizeDateString(asString(value)),
      ),
      dueDate: readField(fieldsRaw.dueDate, (value) =>
        normalizeDateString(asString(value)),
      ),
      paymentTerms: readField(fieldsRaw.paymentTerms, asPaymentTerms),
      totalCents: readField(fieldsRaw.totalCents, asInteger),
    },
    lineItems,
    lineTotalCents:
      asInteger(raw.lineTotalCents) ?? sumCents(lineItems.map((line) => line.amountCents)),
    removedSummaryRows,
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.filter((entry): entry is string => typeof entry === "string")
      : [],
    raw: raw.raw,
    model: typeof raw.model === "string" ? raw.model : null,
  };
}

function readField<T>(
  raw: unknown,
  cast: (value: unknown) => T | null,
): ExtractedField<T> {
  if (!isRecord(raw)) {
    // Tolerate a bare value where a {value, confidence} object was expected.
    return { value: cast(raw), confidenceBasisPoints: null };
  }
  return {
    value: cast(raw.value),
    confidenceBasisPoints: asInteger(raw.confidenceBasisPoints),
  };
}

// ---------------------------------------------------------------------------
// 5. Reconciliation and vendor matching
// ---------------------------------------------------------------------------

export interface ExtractionReconciliation {
  totalCents: number | null;
  lineTotalCents: number;
  /** lineTotalCents - totalCents. Zero when the coding balances. */
  differenceCents: number;
  reconciles: boolean;
}

/**
 * Lines vs. header total for an extraction.
 *
 * ADR 0004: the header total wins. This function reports the gap; it is not
 * allowed to close it.
 */
export function reconcileExtraction(
  result: OcrExtractionResult,
): ExtractionReconciliation {
  const totalCents = result.fields.totalCents.value;
  const lineTotalCents = result.lineTotalCents;
  if (typeof totalCents !== "number") {
    return { totalCents: null, lineTotalCents, differenceCents: 0, reconciles: false };
  }
  return {
    totalCents,
    lineTotalCents,
    differenceCents: lineTotalCents - totalCents,
    reconciles: lineTotalCents === totalCents,
  };
}

export interface VendorCandidate {
  id: string;
  name: string;
  /** 0–1. 1 means the normalised names are identical. */
  score: number;
}

export interface VendorMatch {
  /** Ranked candidates, best first, above the noise floor. */
  candidates: VendorCandidate[];
  /**
   * The single candidate confident enough to PRESELECT in the review form.
   * Preselecting is not applying: ADR 0010 keeps a human in the loop, and a
   * vendor is never created from an extraction.
   */
  suggested: VendorCandidate | null;
}

const VENDOR_MATCH_FLOOR = 0.45;
const VENDOR_SUGGEST_THRESHOLD = 0.72;

/**
 * Fuzzy-match an extracted vendor name against the vendors we already have.
 *
 * Deliberately returns candidates rather than a decision: the human confirms or
 * picks, and an unmatched name never silently creates a vendor.
 */
export function matchVendorName(
  extractedName: string | null | undefined,
  vendors: readonly { id: string; name: string }[],
  limit = 5,
): VendorMatch {
  const needle = normalizeName(extractedName ?? "");
  if (!needle) return { candidates: [], suggested: null };

  const candidates = vendors
    .map((vendor) => ({
      id: vendor.id,
      name: vendor.name,
      score: similarity(needle, normalizeName(vendor.name)),
    }))
    .filter((candidate) => candidate.score >= VENDOR_MATCH_FLOOR)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);

  const best = candidates[0] ?? null;
  const runnerUp = candidates[1] ?? null;

  // Two vendors that match almost equally well is exactly when a human should
  // choose, so suggest nothing.
  const ambiguous =
    best !== null && runnerUp !== null && best.score - runnerUp.score < 0.08;

  return {
    candidates,
    suggested:
      best && best.score >= VENDOR_SUGGEST_THRESHOLD && !ambiguous ? best : null,
  };
}

/** Dice coefficient over character bigrams, with an exact-match short circuit. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    return 0.9 * (Math.min(a.length, b.length) / Math.max(a.length, b.length)) + 0.1;
  }

  const left = bigrams(a);
  const right = bigrams(b);
  if (left.length === 0 || right.length === 0) return 0;

  const pool = [...right];
  let hits = 0;
  for (const gram of left) {
    const index = pool.indexOf(gram);
    if (index !== -1) {
      pool.splice(index, 1);
      hits += 1;
    }
  }
  return (2 * hits) / (left.length + right.length);
}

function bigrams(value: string): string[] {
  const grams: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    grams.push(value.slice(index, index + 2));
  }
  return grams;
}

/** Lowercase, drop punctuation and the corporate suffixes that add no signal. */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(inc|llc|llp|ltd|limited|corp|corporation|co|company|gmbh|sa|srl|plc|technologies|labs)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// 6. Small pure helpers
// ---------------------------------------------------------------------------

export interface InferredTerms {
  terms: PaymentTerms;
  days: number;
  /** Whether the gap matched a standard term exactly. */
  exact: boolean;
}

/**
 * Derive payment terms from the gap between issue and due date.
 *
 * Invoices print "Net 30" as free text at best, so the enum is always inferred.
 * The nearest standard term wins, and the caller is told whether it was exact.
 */
export function inferPaymentTerms(
  issueDate: string,
  dueDate: string,
): InferredTerms {
  const issue = fromDateInputValue(issueDate);
  const due = fromDateInputValue(dueDate);
  if (!issue || !due) return { terms: "NET_30", days: 30, exact: false };

  const days = Math.round((due.getTime() - issue.getTime()) / 86_400_000);
  let best: PaymentTerms = "NET_30";
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const terms of PAYMENT_TERMS) {
    const distance = Math.abs(PAYMENT_TERMS_DAYS[terms] - days);
    if (distance < bestDistance) {
      best = terms;
      bestDistance = distance;
    }
  }

  return { terms: best, days, exact: bestDistance === 0 };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Coerce whatever a document (or a model) calls a date into "yyyy-MM-dd".
 *
 * Handles ISO, US `M/D/YYYY`, `D Mon YYYY` and `Mon D, YYYY`. Ambiguous
 * all-numeric forms are read US-style, which is what the invoices in this
 * product look like; anything else returns `null` so the caller can warn rather
 * than guess wrong in silence.
 */
export function normalizeDateString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return isoOrNull(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slashed = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (slashed) {
    const year = Number(slashed[3]);
    return isoOrNull(
      year < 100 ? 2000 + year : year,
      Number(slashed[1]),
      Number(slashed[2]),
    );
  }

  const dayFirst = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2].slice(0, 3).toLowerCase()];
    if (month) return isoOrNull(Number(dayFirst[3]), month, Number(dayFirst[1]));
  }

  const monthFirst = raw.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].slice(0, 3).toLowerCase()];
    if (month) return isoOrNull(Number(monthFirst[3]), month, Number(monthFirst[2]));
  }

  return null;
}

function isoOrNull(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const candidate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return fromDateInputValue(candidate) ? candidate : null;
}

/** "yyyy-MM-dd" from a Date, in UTC. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function requireDate(value: string): Date {
  const parsed = fromDateInputValue(value);
  if (!parsed) throw new Error(`Not a date input value: ${value}`);
  return parsed;
}

const KNOWN_CURRENCIES = new Set(["USD", "EUR", "GBP", "CAD", "MXN"]);

export function normalizeCurrency(value: string | null | undefined): string {
  const upper = (value ?? "").trim().toUpperCase();
  return KNOWN_CURRENCIES.has(upper) ? upper : "USD";
}

export function asPaymentTerms(value: unknown): PaymentTerms | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  const direct = (PAYMENT_TERMS as readonly string[]).includes(normalized)
    ? (normalized as PaymentTerms)
    : null;
  if (direct) return direct;

  // "net30", "Net 30 days", "due on receipt"
  const compact = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (compact.startsWith("dueonreceipt") || compact === "cod" || compact === "immediate") {
    return "DUE_ON_RECEIPT";
  }
  const net = compact.match(/^net(\d{1,3})/);
  if (net) {
    const days = Number(net[1]);
    const match = PAYMENT_TERMS.find((terms) => PAYMENT_TERMS_DAYS[terms] === days);
    if (match) return match;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// 7. Server-action state
//
// The two OCR actions are `useActionState` reducers, so their state is a plain
// serialisable union. It lives in this pure module because both the action and
// the client form need it, and neither should have to import the other.
// ---------------------------------------------------------------------------

export type OcrUploadState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      envelope: ExtractionEnvelope;
      /** Existing vendors that look like the extracted name. Never applied
       *  automatically — a human confirms or picks (ADR 0010). */
      vendorCandidates: VendorCandidate[];
      /** Preselected candidate, or `null` when the match is not clear-cut. */
      suggestedVendorId: string | null;
      documentFileName: string;
      /** Set only when a document of that name already ships under
       *  /public/invoices, so the saved bill can link to something real. */
      invoiceFileUrl: string | null;
    };

export type OcrSaveState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> }
  | { status: "saved"; billId: string; billNumber: string; vendorName: string };

/** Shared shape for the small one-shot ingest actions (apply / re-run). */
export type IngestActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; message: string };
