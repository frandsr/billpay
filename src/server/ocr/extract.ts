import "server-only";

import { buildExtractionResult, type ExtractionAttempt } from "@/lib/ocr-schema";

import {
  GEMINI_MODEL_CASCADE,
  GEMINI_PROVIDER,
  extractWithGemini,
  isGeminiConfigured,
} from "./gemini";
import { MOCK_CONFIDENCE, MOCK_MODEL, MOCK_PROVIDER, extractWithMock } from "./mock";
import { ProviderError, type ExtractionRun, type InvoiceDocument } from "./types";

/**
 * The extraction cascade.
 *
 * `gemini-3.1-flash-lite` -> `gemini-2.5-flash` -> deterministic mock.
 *
 * The order is a quota decision, not a quality one (ADR 0010): the lite model
 * carries 500 requests a day against 20 for the heavier ones, and a demo that
 * runs out of quota is worse than one that occasionally misreads a line. Every
 * result is reviewed by a human before it becomes a bill, so the downside of
 * the weaker model is a slower review, not a wrong payment.
 *
 * The mock is not an error path — it is the guaranteed floor. With no API key
 * the whole feature still works end to end, which is what a reviewer cloning
 * the repo gets.
 */

export interface ExtractInvoiceOptions {
  /** Existing vendor names, passed to the mock so it reads as a real vendor. */
  vendorNames?: readonly string[];
}

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export function isSupportedInvoiceType(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.has(mimeType.toLowerCase());
}

export const SUPPORTED_INVOICE_TYPES_LABEL = "PDF, PNG, JPEG, WebP or HEIC";

export async function extractInvoice(
  document: InvoiceDocument,
  options: ExtractInvoiceOptions = {},
): Promise<ExtractionRun> {
  const attempts: ExtractionAttempt[] = [];

  if (isGeminiConfigured()) {
    for (const model of GEMINI_MODEL_CASCADE) {
      const startedAt = Date.now();
      try {
        const { payload, raw } = await extractWithGemini(document, model);
        attempts.push({
          provider: GEMINI_PROVIDER,
          model,
          ok: true,
          durationMs: Date.now() - startedAt,
        });

        return {
          result: buildExtractionResult(payload, {
            documentFileName: document.fileName,
            model,
            raw,
            // Gemini reports no per-field confidence. Leaving it null is the
            // honest answer; inventing one would make the review panel lie.
          }),
          provider: GEMINI_PROVIDER,
          model,
          confidenceBasisPoints: null,
          attempts,
          usedFallback: false,
        };
      } catch (error) {
        const failure = error instanceof ProviderError ? error : null;
        attempts.push({
          provider: GEMINI_PROVIDER,
          model,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startedAt,
        });
        // A bad key fails identically on every model; stop rather than repeat.
        if (failure && !failure.retriable) break;
      }
    }
  } else {
    attempts.push({
      provider: GEMINI_PROVIDER,
      model: GEMINI_MODEL_CASCADE[0],
      ok: false,
      error: "GEMINI_API_KEY is not set — skipped straight to the built-in extractor.",
      durationMs: 0,
    });
  }

  return runMock(document, options, attempts);
}

function runMock(
  document: InvoiceDocument,
  options: ExtractInvoiceOptions,
  attempts: ExtractionAttempt[],
): ExtractionRun {
  const startedAt = Date.now();
  const failures = attempts.filter((attempt) => !attempt.ok);
  const reason = isGeminiConfigured()
    ? `Read by the built-in mock extractor: ${failures.map((attempt) => attempt.model).join(" and ")} did not return a result.`
    : "Read by the built-in mock extractor, not by a model — no GEMINI_API_KEY is configured.";

  const { payload, raw } = extractWithMock(document, {
    vendorNames: options.vendorNames,
    reason,
  });

  attempts.push({
    provider: MOCK_PROVIDER,
    model: MOCK_MODEL,
    ok: true,
    durationMs: Date.now() - startedAt,
  });

  return {
    result: buildExtractionResult(payload, {
      documentFileName: document.fileName,
      model: MOCK_MODEL,
      raw,
      confidence: {
        vendorName: MOCK_CONFIDENCE.vendorName,
        billNumber: MOCK_CONFIDENCE.billNumber,
        issueDate: MOCK_CONFIDENCE.issueDate,
        dueDate: MOCK_CONFIDENCE.dueDate,
        paymentTerms: MOCK_CONFIDENCE.paymentTerms,
        totalCents: MOCK_CONFIDENCE.totalCents,
        lineItems: MOCK_CONFIDENCE.lineItems,
      },
    }),
    provider: MOCK_PROVIDER,
    model: MOCK_MODEL,
    confidenceBasisPoints: MOCK_CONFIDENCE.overall,
    attempts,
    usedFallback: true,
  };
}
