"use server";

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

import {
  buildBillKey,
  buildImportPreview,
  type ImportBillDraft,
  type ImportOutcome,
  type ImportPreviewState,
  type ImportRunState,
  type ImportSummary,
} from "@/lib/csv-import";
import { getCurrentUser } from "@/lib/current-user";
import { dueDateFrom, fromDateInputValue } from "@/lib/dates";
import { db } from "@/lib/db";
import type { PaymentTerms } from "@/lib/domain";
import { lineAmountCents, parseAmountToCents } from "@/lib/money";
import {
  OCR_FIELD_LABELS,
  asPaymentTerms,
  matchVendorName,
  normalizeCurrency,
  normalizeDateString,
  parseExtractionEnvelope,
  type IngestActionState,
  type OcrFieldKey,
  type OcrSaveState,
  type OcrUploadState,
} from "@/lib/ocr-schema";
import {
  MAX_CSV_UPLOAD_BYTES,
  MAX_INVOICE_UPLOAD_BYTES,
  formatBytes,
} from "@/lib/uploads";
import {
  SUPPORTED_INVOICE_TYPES_LABEL,
  extractInvoice,
  isSupportedInvoiceType,
} from "@/server/ocr/extract";

/**
 * Ingestion server actions — invoice OCR and CSV import.
 *
 * Two rules shape everything here.
 *
 *  * ADR 0010 — an extraction is a PROPOSAL. It always produces a new `DRAFT`
 *    with `source = OCR`, never a finished bill, never a submission, and never
 *    an overwrite of a bill a person has already worked on. The one path that
 *    writes an extracted value onto an existing bill (`applyExtractedField`) is
 *    driven by a human clicking a specific field on a specific draft.
 *  * ADR 0004 — the header total is authoritative. Neither channel adjusts a
 *    total to match its lines or pads its lines to match a total; a mismatch is
 *    reported and the draft lands in `Missing info`.
 *
 * Every action re-validates its input server-side. The CSV preview the browser
 * rendered is advisory: the import re-parses the original text against fresh
 * reference data before writing anything.
 */

// ---------------------------------------------------------------------------
// 1. OCR — extract (no writes)
// ---------------------------------------------------------------------------

export async function extractInvoiceAction(
  _previous: OcrUploadState,
  formData: FormData,
): Promise<OcrUploadState> {
  const file = formData.get("document");

  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose an invoice document to scan." };
  }
  if (file.size > MAX_INVOICE_UPLOAD_BYTES) {
    return {
      status: "error",
      message: `That file is ${formatBytes(file.size)}. The demo accepts documents up to ${formatBytes(MAX_INVOICE_UPLOAD_BYTES)}.`,
    };
  }

  const mimeType = file.type || guessMimeType(file.name);
  if (!isSupportedInvoiceType(mimeType)) {
    return {
      status: "error",
      message: `An invoice must be a ${SUPPORTED_INVOICE_TYPES_LABEL} document.`,
    };
  }

  const vendors = await db.vendor.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  let envelope;
  try {
    envelope = await extractInvoice(
      {
        fileName: file.name,
        mimeType,
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
      { vendorNames: vendors.map((vendor) => vendor.name) },
    );
  } catch (error) {
    // The cascade already falls back to the mock, so reaching here means
    // something structural broke rather than a provider being unavailable.
    return {
      status: "error",
      message: `Extraction failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const match = matchVendorName(envelope.result.fields.vendorName.value, vendors);

  return {
    status: "ready",
    envelope,
    vendorCandidates: match.candidates,
    suggestedVendorId: match.suggested?.id ?? null,
    documentFileName: file.name,
    invoiceFileUrl: resolveBundledInvoiceUrl(file.name),
  };
}

// ---------------------------------------------------------------------------
// 2. OCR — save the reviewed draft
// ---------------------------------------------------------------------------

interface ReviewedLine {
  description: string;
  quantity: number;
  unitPriceCents: number;
  glAccountId: string | null;
  department: string | null;
}

export async function createBillFromExtractionAction(
  _previous: OcrSaveState,
  formData: FormData,
): Promise<OcrSaveState> {
  const envelope = parseExtractionEnvelope(formData.get("envelope"));
  if (!envelope) {
    return {
      status: "error",
      message:
        "The extraction could not be read back. Re-run the scan so the saved bill has an audit trail.",
    };
  }

  const fieldErrors: Record<string, string> = {};

  const vendorId = text(formData, "vendorId");
  const vendor = vendorId
    ? await db.vendor.findUnique({ where: { id: vendorId }, select: { id: true, name: true } })
    : null;
  if (!vendor) {
    // ADR 0010: an extraction never creates a vendor. A human picks one.
    fieldErrors.vendorId = "Pick the vendor this invoice is from.";
  }

  const billNumber = text(formData, "billNumber");
  if (!billNumber) fieldErrors.billNumber = "The bill number is required.";

  const currency = normalizeCurrency(text(formData, "currency"));

  const issueDateValue = normalizeDateString(text(formData, "issueDate"));
  const issueDate = issueDateValue ? fromDateInputValue(issueDateValue) : null;
  if (!issueDate) fieldErrors.issueDate = "Enter the issue date as YYYY-MM-DD.";

  const paymentTerms = asPaymentTerms(text(formData, "paymentTerms"));
  if (!paymentTerms) fieldErrors.paymentTerms = "Choose the payment terms.";

  const totalCents = parseAmountToCents(text(formData, "totalAmount"), currency);
  if (totalCents === null) {
    fieldErrors.totalAmount = "Enter the invoice total.";
  } else if (totalCents <= 0) {
    fieldErrors.totalAmount = "The total must be greater than zero.";
  }

  const lines = parseReviewedLines(formData.get("lines"));
  if (lines === null) {
    fieldErrors.lines = "The line items could not be read.";
  }

  if (Object.keys(fieldErrors).length > 0 || !vendor || !issueDate || !paymentTerms || !lines) {
    return {
      status: "error",
      message: "Check the highlighted fields before saving this draft.",
      fieldErrors,
    };
  }

  const glAccountIds = [
    ...new Set(lines.map((line) => line.glAccountId).filter((id): id is string => id !== null)),
  ];
  if (glAccountIds.length > 0) {
    const known = await db.glAccount.count({ where: { id: { in: glAccountIds } } });
    if (known !== glAccountIds.length) {
      return {
        status: "error",
        message: "One of the GL accounts no longer exists. Reload the page and try again.",
      };
    }
  }

  const currentUser = await getCurrentUser();
  // One rule for the due date across every channel: derived, never extracted.
  const dueDate = dueDateFrom(issueDate, paymentTerms);
  const documentFileName = text(formData, "documentFileName") || envelope.result.documentFileName;
  const invoiceFileUrl = resolveBundledInvoiceUrl(documentFileName ?? "");

  try {
    const bill = await db.$transaction(async (tx) => {
      const created = await tx.bill.create({
        data: {
          billNumber,
          vendorId: vendor.id,
          issueDate,
          dueDate,
          paymentTerms,
          // ADR 0004: exactly what the reviewer confirmed. The lines are not
          // allowed to move it, and it is not allowed to move the lines.
          totalCents: totalCents as number,
          currency,
          memo: text(formData, "memo") || null,
          // ADR 0010: an extraction lands as a DRAFT for review. Never READY,
          // never submitted — `submittedAt` stays null on purpose.
          status: "DRAFT",
          source: "OCR",
          invoiceFileName: documentFileName,
          invoiceFileUrl,
          createdById: currentUser.id,
          lineItems: {
            create: lines.map((line, index) => ({
              description: line.description,
              quantity: line.quantity,
              unitPriceCents: line.unitPriceCents,
              amountCents: lineAmountCents(line.quantity, line.unitPriceCents),
              glAccountId: line.glAccountId,
              department: line.department,
              sortOrder: index,
            })),
          },
        },
        select: { id: true, billNumber: true },
      });

      // The auditable run. Extractions are 1:N and append-only — a re-run adds
      // a row so a reviewer can compare, it never overwrites this one.
      await tx.ocrExtraction.create({
        data: {
          billId: created.id,
          provider: envelope.provider,
          confidenceBasisPoints: envelope.confidenceBasisPoints,
          rawResult: toJson(envelope.result),
        },
      });

      await tx.activity.create({
        data: {
          billId: created.id,
          userId: currentUser.id,
          type: "CREATED",
          message: `created this bill from a scanned invoice (${envelope.provider})`,
        },
      });

      return created;
    });

    revalidatePath("/bills");
    revalidatePath(`/bills/${bill.id}`);

    return {
      status: "saved",
      billId: bill.id,
      billNumber: bill.billNumber,
      vendorName: vendor.name,
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        status: "error",
        message: `${vendor.name} already has a bill numbered ${billNumber}.`,
        fieldErrors: { billNumber: "This bill number is already used for this vendor." },
      };
    }
    return {
      status: "error",
      message: `The draft could not be saved: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// 3. OCR — review panel actions on an existing bill
// ---------------------------------------------------------------------------

/**
 * Write ONE extracted value onto a draft bill.
 *
 * This is the only path that touches an existing bill, and it is deliberately
 * narrow: a person clicks one field on one `DRAFT`. ADR 0010 forbids applying
 * an extraction wholesale over work a human has already done, so there is no
 * "accept everything" and no automatic application anywhere.
 */
export async function applyExtractedFieldAction(
  _previous: IngestActionState,
  formData: FormData,
): Promise<IngestActionState> {
  const billId = text(formData, "billId");
  const field = text(formData, "field") as OcrFieldKey;
  if (!billId || !(field in OCR_FIELD_LABELS)) {
    return { status: "error", message: "Nothing to apply." };
  }

  const bill = await db.bill.findUnique({
    where: { id: billId },
    include: { ocrExtractions: { orderBy: { extractedAt: "desc" }, take: 1 } },
  });
  if (!bill) return { status: "error", message: "That bill no longer exists." };
  if (bill.status !== "DRAFT") {
    return {
      status: "error",
      message: "Only a draft can take an extracted value. This bill has left draft.",
    };
  }

  const envelope = parseExtractionEnvelope({
    result: bill.ocrExtractions[0]?.rawResult,
    provider: bill.ocrExtractions[0]?.provider,
  });
  if (!envelope) return { status: "error", message: "This bill has no readable extraction." };

  const fields = envelope.result.fields;
  const currentUser = await getCurrentUser();
  const data: Prisma.BillUpdateInput = {};

  switch (field) {
    case "vendorName": {
      // A name is not an id: the panel makes the reviewer choose which existing
      // vendor it means, and an unmatched name never creates one.
      const vendorId = text(formData, "vendorId");
      const vendor = vendorId
        ? await db.vendor.findUnique({ where: { id: vendorId }, select: { id: true, name: true } })
        : null;
      if (!vendor) return { status: "error", message: "Choose which vendor this invoice is from." };
      data.vendor = { connect: { id: vendor.id } };
      break;
    }
    case "billNumber": {
      const value = fields.billNumber.value;
      if (!value) return { status: "error", message: "No bill number was extracted." };
      data.billNumber = value;
      break;
    }
    case "issueDate": {
      const parsed = fields.issueDate.value
        ? fromDateInputValue(fields.issueDate.value)
        : null;
      if (!parsed) return { status: "error", message: "The extracted date is not usable." };
      data.issueDate = parsed;
      break;
    }
    case "dueDate": {
      const parsed = fields.dueDate.value ? fromDateInputValue(fields.dueDate.value) : null;
      if (!parsed) return { status: "error", message: "The extracted date is not usable." };
      data.dueDate = parsed;
      break;
    }
    case "paymentTerms": {
      const terms = asPaymentTerms(fields.paymentTerms.value);
      if (!terms) return { status: "error", message: "No payment terms were extracted." };
      data.paymentTerms = terms;
      break;
    }
    case "totalCents": {
      const value = fields.totalCents.value;
      if (value === null || value <= 0) {
        return { status: "error", message: "The extracted total is not usable." };
      }
      // ADR 0004: the header total moves on its own. The lines are NOT touched
      // to keep up — the resulting gap is the point.
      data.totalCents = value;
      break;
    }
  }

  try {
    await db.$transaction([
      db.bill.update({ where: { id: bill.id }, data }),
      db.activity.create({
        data: {
          billId: bill.id,
          userId: currentUser.id,
          type: "UPDATED",
          message: `applied the extracted ${OCR_FIELD_LABELS[field].toLowerCase()} to this bill`,
        },
      }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        status: "error",
        message: "That vendor already has a bill with this number.",
      };
    }
    throw error;
  }

  revalidatePath(`/bills/${bill.id}`);
  revalidatePath("/bills");

  return { status: "done", message: `${OCR_FIELD_LABELS[field]} updated from the extraction.` };
}

/**
 * Run extraction again over the bill's attached document.
 *
 * Appends a row: extractions are 1:N so two runs can be compared, and a re-run
 * never edits the bill (ADR 0010).
 */
export async function rerunExtractionAction(
  _previous: IngestActionState,
  formData: FormData,
): Promise<IngestActionState> {
  const billId = text(formData, "billId");
  if (!billId) return { status: "error", message: "Nothing to re-run." };

  const bill = await db.bill.findUnique({
    where: { id: billId },
    select: { id: true, invoiceFileName: true, invoiceFileUrl: true },
  });
  if (!bill) return { status: "error", message: "That bill no longer exists." };

  const document = readBundledInvoice(bill.invoiceFileUrl);
  if (!document) {
    return {
      status: "error",
      message: "This bill has no stored invoice document to re-read.",
    };
  }

  const vendors = await db.vendor.findMany({
    where: { status: "ACTIVE" },
    select: { name: true },
  });

  const envelope = await extractInvoice(document, {
    vendorNames: vendors.map((vendor) => vendor.name),
  });

  await db.ocrExtraction.create({
    data: {
      billId: bill.id,
      provider: envelope.provider,
      confidenceBasisPoints: envelope.confidenceBasisPoints,
      rawResult: toJson(envelope.result),
    },
  });

  revalidatePath(`/bills/${bill.id}`);

  return {
    status: "done",
    message: `Re-read by ${envelope.model}. The previous run is kept for comparison.`,
  };
}

// ---------------------------------------------------------------------------
// 4. CSV import — preview (no writes)
// ---------------------------------------------------------------------------

export async function previewBillImportAction(
  _previous: ImportPreviewState,
  formData: FormData,
): Promise<ImportPreviewState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a CSV file to import." };
  }
  if (file.size > MAX_CSV_UPLOAD_BYTES) {
    return {
      status: "error",
      message: `That file is ${formatBytes(file.size)}. The demo accepts imports up to ${formatBytes(MAX_CSV_UPLOAD_BYTES)}.`,
    };
  }

  const csvText = await file.text();
  const preview = buildImportPreview(csvText, await loadImportReference());

  return { status: "ready", preview, fileName: file.name, csvText };
}

// ---------------------------------------------------------------------------
// 5. CSV import — run
// ---------------------------------------------------------------------------

export async function runBillImportAction(
  _previous: ImportRunState,
  formData: FormData,
): Promise<ImportRunState> {
  const csvText = text(formData, "csvText");
  if (!csvText) {
    return { status: "error", message: "Nothing to import — upload the file again." };
  }

  // Re-parse the ORIGINAL text against fresh reference data. The preview the
  // browser rendered is advisory; this is the check that decides what is
  // written, so a stale or edited preview cannot smuggle a row past validation.
  const preview = buildImportPreview(csvText, await loadImportReference());
  if (preview.fileErrors.length > 0) {
    return { status: "error", message: preview.fileErrors.join(" ") };
  }

  const currentUser = await getCurrentUser();
  const outcomes: ImportOutcome[] = [];

  for (const draft of preview.bills) {
    if (!draft.valid) {
      outcomes.push({
        billNumber: draft.billNumber || "(no number)",
        vendorName: draft.vendorName,
        status: "SKIPPED",
        reasons: draft.errors.map((issue) => `Line ${issue.line}: ${issue.message}`),
        sourceLines: draft.sourceLines,
      });
      continue;
    }

    try {
      const bill = await createImportedBill(draft, currentUser.id);
      outcomes.push({
        billNumber: draft.billNumber,
        vendorName: draft.vendorName,
        status: "CREATED",
        billId: bill.id,
        reasons: draft.warnings.map((issue) => issue.message),
        sourceLines: draft.sourceLines,
      });
    } catch (error) {
      outcomes.push({
        billNumber: draft.billNumber,
        vendorName: draft.vendorName,
        status: "FAILED",
        reasons: [
          isUniqueViolation(error)
            ? `${draft.vendorName} already has a bill numbered ${draft.billNumber}.`
            : error instanceof Error
              ? error.message
              : String(error),
        ],
        sourceLines: draft.sourceLines,
      });
    }
  }

  const summary: ImportSummary = {
    created: outcomes.filter((outcome) => outcome.status === "CREATED").length,
    skipped: outcomes.filter((outcome) => outcome.status === "SKIPPED").length,
    failed: outcomes.filter((outcome) => outcome.status === "FAILED").length,
    outcomes,
  };

  if (summary.created > 0) revalidatePath("/bills");

  return { status: "done", summary };
}

/** One bill and its lines, in one transaction, with its `CREATED` activity. */
async function createImportedBill(
  draft: ImportBillDraft,
  userId: string,
): Promise<{ id: string }> {
  const issueDate = fromDateInputValue(draft.issueDate as string);
  const paymentTerms = draft.paymentTerms as PaymentTerms;
  if (!issueDate) throw new Error(`Row ${draft.sourceLines[0]}: unusable issue date.`);

  return db.$transaction(async (tx) => {
    const bill = await tx.bill.create({
      data: {
        billNumber: draft.billNumber,
        vendorId: draft.vendorId as string,
        issueDate,
        // Derived, exactly as in every other channel.
        dueDate: dueDateFrom(issueDate, paymentTerms),
        paymentTerms,
        // ADR 0004: the file's stated total, untouched by its lines.
        totalCents: draft.totalCents as number,
        currency: draft.currency,
        memo: draft.memo,
        status: "DRAFT",
        source: "CSV",
        createdById: userId,
        lineItems: {
          create: draft.lines.map((line, index) => ({
            description: line.description,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            amountCents: line.amountCents,
            glAccountId: line.glAccountId,
            department: line.department,
            sortOrder: index,
          })),
        },
      },
      select: { id: true },
    });

    await tx.activity.create({
      data: {
        billId: bill.id,
        userId,
        type: "CREATED",
        message: "imported this bill from a CSV",
      },
    });

    return bill;
  });
}

async function loadImportReference() {
  const [vendors, glAccounts, existing] = await Promise.all([
    db.vendor.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.glAccount.findMany({
      where: { active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    db.bill.findMany({ select: { vendorId: true, billNumber: true } }),
  ]);

  return {
    vendors,
    glAccounts,
    existingBillKeys: existing.map((bill) => buildBillKey(bill.vendorId, bill.billNumber)),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** `null` when the payload is unreadable, so the caller can reject the save. */
function parseReviewedLines(value: FormDataEntryValue | null): ReviewedLine[] | null {
  if (typeof value !== "string") return [];
  if (value.trim() === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const lines: ReviewedLine[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) return null;
    const record = entry as Record<string, unknown>;

    const description = typeof record.description === "string" ? record.description.trim() : "";
    const quantityRaw = Number(record.quantity ?? 1);
    const quantity =
      Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.round(quantityRaw) : 1;
    const unitPriceCents = parseAmountToCents(
      typeof record.unitPrice === "string" || typeof record.unitPrice === "number"
        ? record.unitPrice
        : null,
    );

    // A blank row in the editor is a row the reviewer deleted, not an error.
    if (!description && unitPriceCents === null) continue;

    lines.push({
      description: description || "Unlabelled line",
      quantity,
      unitPriceCents: unitPriceCents ?? 0,
      glAccountId:
        typeof record.glAccountId === "string" && record.glAccountId !== ""
          ? record.glAccountId
          : null,
      department:
        typeof record.department === "string" && record.department.trim() !== ""
          ? record.department.trim()
          : null,
    });
  }

  return lines;
}

/**
 * Map an uploaded file name onto a document that already ships under
 * `/public/invoices`.
 *
 * The demo does not store uploaded bytes, so this is what lets a reviewer drag
 * in one of the seeded PDFs and still get a bill whose document preview works.
 * Anything else saves the file NAME and no URL, which is honest about what was
 * kept. Best effort by design: any failure means "no document".
 */
function resolveBundledInvoiceUrl(fileName: string | null | undefined): string | null {
  const safe = safeInvoiceBasename(fileName);
  if (!safe) return null;
  try {
    return existsSync(join(process.cwd(), "public", "invoices", safe))
      ? `/invoices/${safe}`
      : null;
  } catch {
    return null;
  }
}

function readBundledInvoice(invoiceFileUrl: string | null) {
  if (!invoiceFileUrl?.startsWith("/invoices/")) return null;
  const safe = safeInvoiceBasename(invoiceFileUrl.slice("/invoices/".length));
  if (!safe) return null;

  try {
    const path = join(process.cwd(), "public", "invoices", safe);
    if (!existsSync(path)) return null;
    return {
      fileName: safe,
      mimeType: guessMimeType(safe),
      bytes: new Uint8Array(readFileSync(path)),
    };
  } catch {
    return null;
  }
}

/** Basename only, conservative charset — never a path the caller controls. */
function safeInvoiceBasename(fileName: string | null | undefined): string | null {
  if (!fileName) return null;
  const name = basename(fileName);
  return /^[A-Za-z0-9._-]+$/.test(name) && name !== "." && name !== ".." ? name : null;
}

function guessMimeType(fileName: string): string {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  switch (extension) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    default:
      return "application/octet-stream";
  }
}

/** Drop `undefined` so the value is a legal Prisma `Json` input. */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}
