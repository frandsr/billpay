import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, CircleCheck } from "lucide-react";

import { ActivityFeed } from "@/components/activity/activity-feed";
import { ApprovalPanel } from "@/components/approvals/approval-panel";
import { BillHeader } from "@/components/bills/bill-header";
import { InvoicePreview } from "@/components/bills/invoice-preview";
import { LineItemsEditor } from "@/components/bills/line-items-editor";
import { OcrReviewPanel } from "@/components/ingest/ocr-review-panel";
import { PaymentPanel } from "@/components/payments/payment-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getCurrentUser } from "@/lib/current-user";
import { getBillDetail } from "@/server/bill-detail";
import { getActiveGlAccounts } from "@/server/reference-data";

interface BillDetailPageProps {
  params: Promise<{ id: string }>;
  /** Route search params. Only `created=1` is read — see the notice below. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({
  params,
}: BillDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const bill = await getBillDetail(id);
  if (!bill) return { title: "Bill not found" };
  return { title: `${bill.vendor.name} · ${bill.billNumber}` };
}

/**
 * Bill detail. Loads the bill and its relations ONCE and hands the same object
 * to every panel; the panels themselves are owned by the verticals.
 *
 * Layout: the invoice document sits on the left and stays in view while the
 * OCR review, coding, approval, payment and audit panels scroll on the right.
 *
 * `billDetailInclude` already carries line-item splits, the OCR extractions and
 * the recurring template, so every panel below has what it needs from the one
 * object it is handed.
 *
 * FROZEN — foundation-owned and shared by all five verticals. Do not edit it to
 * add a query or widen a prop: if you need a wider `billDetailInclude`, STOP
 * and coordinate. `billDetailInclude` lives in `src/server/bill-detail.ts`,
 * which is frozen too.
 *
 * The `created=1` notice below is the one exception: it reads a search param,
 * not the database, so the shared data contract is untouched.
 */
export default async function BillDetailPage({
  params,
  searchParams,
}: BillDetailPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  const [bill, currentUser, glAccounts] = await Promise.all([
    getBillDetail(id),
    getCurrentUser(),
    getActiveGlAccounts(),
  ]);

  if (!bill) notFound();

  // Manual creation redirects here rather than to the inbox, so the save has to
  // be acknowledged on arrival — otherwise it reads as if nothing happened.
  const justCreated = query.created === "1";

  return (
    <div className="space-y-5">
      <Link
        href="/bills"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors"
      >
        <ChevronLeft className="size-4" />
        Back to bills
      </Link>

      {justCreated ? (
        <Alert>
          <CircleCheck className="text-emerald-600 dark:text-emerald-400" />
          <AlertTitle>Bill {bill.billNumber} created</AlertTitle>
          <AlertDescription>
            It is saved as a draft. Code the line items below and submit it for
            approval when it is ready.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Slot: vertical B */}
      <BillHeader bill={bill} currentUser={currentUser} />

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Document column — sticky so it stays next to the coding work. */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          {/* Slot: vertical B */}
          <InvoicePreview bill={bill} />
        </div>

        {/* Work column */}
        <div className="min-w-0 space-y-5">
          {/* Slot: vertical D — renders nothing unless the bill has an
              extraction, so review comes before coding when it applies. */}
          <OcrReviewPanel bill={bill} />
          {/* Slot: vertical B */}
          <LineItemsEditor bill={bill} glAccounts={glAccounts} />
          {/* Slot: vertical C */}
          <ApprovalPanel bill={bill} currentUser={currentUser} />
          {/* Slot: vertical C */}
          <PaymentPanel bill={bill} currentUser={currentUser} />
          {/* Slot: vertical B */}
          <ActivityFeed bill={bill} />
        </div>
      </div>
    </div>
  );
}
