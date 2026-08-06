import { getActiveGlAccounts, getActiveVendors } from "@/server/reference-data";
import { GEMINI_MODEL_CASCADE, isGeminiConfigured } from "@/server/ocr/gemini";
import { MOCK_MODEL } from "@/server/ocr/mock";

import { InvoiceUploadForm } from "./invoice-upload-form";

/**
 * Invoice upload and OCR — data boundary.
 *
 * Reads its own reference data so the page that renders it stays a plain shell
 * and takes no props (the ownership contract for this slot). Everything
 * interactive lives in `<InvoiceUploadForm/>`, which is a client component.
 */
export async function InvoiceUpload() {
  const [vendors, glAccounts] = await Promise.all([
    getActiveVendors(),
    getActiveGlAccounts(),
  ]);

  return (
    <InvoiceUploadForm
      vendors={vendors.map((vendor) => ({ id: vendor.id, name: vendor.name }))}
      glAccounts={glAccounts.map((account) => ({
        id: account.id,
        code: account.code,
        name: account.name,
      }))}
      // The UI says out loud which extractor is about to run. A reviewer with
      // no key should know the draft came from the deterministic mock, not
      // wonder why the vendor looks invented.
      providerLabel={
        isGeminiConfigured()
          ? `${GEMINI_MODEL_CASCADE[0]}, falling back to ${GEMINI_MODEL_CASCADE[1]} then the built-in extractor`
          : `${MOCK_MODEL} (no GEMINI_API_KEY is set)`
      }
      geminiConfigured={isGeminiConfigured()}
    />
  );
}
