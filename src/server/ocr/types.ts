import type { ExtractionEnvelope } from "@/lib/ocr-schema";

/**
 * Provider-facing types for the extraction cascade.
 *
 * No `server-only` marker: this module holds types plus one error class and is
 * imported by both halves of the vertical. The wire types the browser also sees
 * (`ExtractionEnvelope`, `ExtractionAttempt`) live in the pure `@/lib/ocr-schema`
 * so nothing under `src/server/` has to be reachable from a client bundle.
 */

/** The document handed to an extractor. Bytes, never a path. */
export interface InvoiceDocument {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

/** What a completed run returns. Identical to what the review form receives. */
export type ExtractionRun = ExtractionEnvelope;

/** Thrown by a provider when a single model attempt fails. */
export class ProviderError extends Error {
  /** False when retrying another model would fail the same way (e.g. bad key). */
  readonly retriable: boolean;

  constructor(message: string, options: { retriable?: boolean } = {}) {
    super(message);
    this.name = "ProviderError";
    this.retriable = options.retriable ?? true;
  }
}
