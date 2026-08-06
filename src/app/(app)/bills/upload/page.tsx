import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { InvoiceUpload } from "@/components/ingest/invoice-upload";

export const metadata: Metadata = { title: "Upload an invoice" };

/**
 * Invoice upload and OCR. Shell only — `<InvoiceUpload/>` is owned by vertical
 * D and reads its own data, so this page never needs to change as the feature
 * lands.
 */
export default function UploadInvoicePage() {
  return (
    <>
      <PageHeader
        title="Upload an invoice"
        description="Scan an invoice document into a draft bill. Extraction is a starting point for review, never a finished bill."
      />
      <InvoiceUpload />
    </>
  );
}
