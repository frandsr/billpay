/**
 * Upload limits and byte formatting, shared by the ingestion server actions and
 * the forms that feed them so the cap enforced on the server and the number a
 * person reads on screen can never disagree.
 *
 * Server Actions carry their own request body limit, configured in
 * `next.config.ts` as `experimental.serverActions.bodySizeLimit`. The caps below
 * sit under it with headroom for multipart overhead, so an oversized file gets
 * an explanatory message instead of an opaque 413.
 */

/** Mirrors `experimental.serverActions.bodySizeLimit` in `next.config.ts`. */
export const SERVER_ACTION_BODY_LIMIT_BYTES = 10 * 1024 * 1024;

/** A scanned multi-page invoice comfortably fits; the request body still does. */
export const MAX_INVOICE_UPLOAD_BYTES = 8 * 1024 * 1024;

/** A CSV of bills is text; anything larger is a pasted spreadsheet by mistake. */
export const MAX_CSV_UPLOAD_BYTES = 2 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
