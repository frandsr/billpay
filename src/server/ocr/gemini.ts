import "server-only";

import {
  INVOICE_EXTRACTION_JSON_SCHEMA,
  type InvoiceExtractionPayload,
} from "@/lib/ocr-schema";

import { ProviderError, type InvoiceDocument } from "./types";

/**
 * Google Gemini invoice extractor.
 *
 * Called over the REST API with `fetch` rather than the vendor SDK: one HTTP
 * call against a documented endpoint adds no dependency to a lockfile four
 * other verticals share, and the request body IS the interesting part — the
 * JSON schema we constrain the model to.
 *
 * ADR 0010: structured output only. `responseMimeType: application/json` plus
 * `responseSchema` makes the model fill in `InvoiceExtractionPayload`; we never
 * ask for prose and regex it back apart.
 */

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Model cascade, in order.
 *
 * `gemini-3.1-flash-lite` leads on DAILY QUOTA, not on raw quality: 500 requests
 * a day against 20 for the heavier models. A demo that exhausts its rate limit
 * is worse than one that occasionally misreads a line — and every line is
 * reviewed by a human anyway.
 */
export const GEMINI_MODEL_CASCADE = ["gemini-3.1-flash-lite", "gemini-2.5-flash"] as const;

export const GEMINI_PROVIDER = "gemini";

/** Extraction is seconds of work; past this the UI is better off with the mock. */
const REQUEST_TIMEOUT_MS = 45_000;

const SYSTEM_INSTRUCTION = [
  "You read supplier invoices for an accounts-payable system and return structured data.",
  "Report only what is printed on the document. Never infer, average or complete a figure that is not there — use null instead.",
  "The vendor is the party issuing the invoice and being paid, not the customer being billed.",
  "Copy every amount exactly as printed, digits and separators only. Do not round, do not convert currency, do not add a currency symbol.",
  "`lineItems` is ONLY the itemised goods or services being charged — one entry per row of the invoice's line-item table, in the order printed.",
  "The invoice's SUMMARY BLOCK is not line items. Never return subtotal, tax, sales tax, VAT, GST, discount, shipping, freight, surcharge, handling, service charge, balance due, amount due or total as a `lineItems` entry, whether it is printed under the table or in a totals panel beside it.",
  "Tax and fees belong to the grand total, which you report separately in `totalAmount`. Returning a subtotal or tax row as a line item double-counts the invoice.",
  "The grand total and the sum of the lines routinely disagree, because tax and fees sit outside the itemised lines or because a line is unreadable. That is expected: report both as printed, never adjust one to match the other, and never add a line to close the gap.",
  "Put anything a human should double-check into `notes`.",
].join(" ");

export function geminiApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key ? key : null;
}

export function isGeminiConfigured(): boolean {
  return geminiApiKey() !== null;
}

/**
 * Run ONE model against the document. Throws `ProviderError` on any failure so
 * the cascade in `extract.ts` decides what to do next.
 */
export async function extractWithGemini(
  document: InvoiceDocument,
  model: string,
): Promise<{ payload: InvoiceExtractionPayload; raw: unknown }> {
  const apiKey = geminiApiKey();
  if (!apiKey) throw new ProviderError("GEMINI_API_KEY is not set.", { retriable: false });

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Extract the invoice in the attached file "${document.fileName}" into the required JSON schema.`,
          },
          {
            inlineData: {
              mimeType: document.mimeType,
              data: toBase64(document.bytes),
            },
          },
        ],
      },
    ],
    generationConfig: {
      // Deterministic: the same document should read the same way twice, so a
      // reviewer comparing two runs sees real differences, not sampling noise.
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: INVOICE_EXTRACTION_JSON_SCHEMA,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    throw new ProviderError(
      error instanceof Error && error.name === "AbortError"
        ? `${model} did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`
        : `${model} could not be reached: ${errorMessage(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await safeText(response);
    // 401/403 mean the key itself is wrong: trying the next model wastes a
    // round trip, so stop the cascade rather than repeating the failure.
    throw new ProviderError(
      `${model} returned ${response.status}${detail ? ` — ${detail}` : ""}`,
      { retriable: response.status !== 401 && response.status !== 403 },
    );
  }

  const raw: unknown = await response.json();
  const text = firstCandidateText(raw);
  if (!text) {
    throw new ProviderError(`${model} returned no content to read.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Schema-constrained output should always be valid JSON; if it is not, the
    // right move is the next model, not a regex rescue (ADR 0010).
    throw new ProviderError(`${model} returned output that was not valid JSON.`);
  }

  return { payload: coercePayload(parsed), raw };
}

/**
 * Shape whatever came back into `InvoiceExtractionPayload`.
 *
 * The schema constrains the model, but a response is still untrusted input, so
 * every field is checked rather than cast.
 */
function coercePayload(value: unknown): InvoiceExtractionPayload {
  const record = isRecord(value) ? value : {};
  const lineItems = Array.isArray(record.lineItems) ? record.lineItems : [];

  return {
    vendorName: asString(record.vendorName),
    invoiceNumber: asString(record.invoiceNumber),
    issueDate: asString(record.issueDate),
    dueDate: asString(record.dueDate),
    currency: asString(record.currency),
    totalAmount: asMoneyString(record.totalAmount),
    lineItems: lineItems.filter(isRecord).map((line) => ({
      description: asString(line.description),
      quantity: asNumber(line.quantity),
      unitPrice: asMoneyString(line.unitPrice),
      amount: asMoneyString(line.amount),
    })),
    notes: Array.isArray(record.notes)
      ? record.notes.filter((note): note is string => typeof note === "string")
      : [],
  };
}

function firstCandidateText(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const candidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const content = isRecord(candidate.content) ? candidate.content : null;
    const parts = content && Array.isArray(content.parts) ? content.parts : [];
    const text = parts
      .filter(isRecord)
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (text) return text;
  }
  return null;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function safeText(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  } catch {
    return "";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Money may come back as a number despite the schema; keep it lossless. */
function asMoneyString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value.toString();
  return asString(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/[\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
