// STUB: implemented in the VERTICAL B phase (bill detail).
// Owner: Vertical B.
//
// Expected behaviour: render the attached invoice DOCUMENT (bill.invoiceFileUrl,
// a PDF under /public/invoices) in an embedded viewer, with the filename, an
// "open in a new tab" affordance and an empty state when nothing is attached.
// Remember: the invoice is the document, never a synonym for the bill.

import { StubPanel } from "@/components/common/stub-panel";
import type { BillDetail } from "@/server/bill-detail";

export interface InvoicePreviewProps {
  bill: BillDetail;
}

export function InvoicePreview({ bill }: InvoicePreviewProps) {
  return (
    <StubPanel
      title="Invoice document"
      owner="Vertical B — bill detail"
      summary={
        bill.invoiceFileUrl
          ? `Embedded viewer for ${bill.invoiceFileName}.`
          : "No invoice document is attached to this bill yet."
      }
      className="h-full"
    />
  );
}
