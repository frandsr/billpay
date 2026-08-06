import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { ActivityFeed } from "@/components/activity/activity-feed";
import { ApprovalPanel } from "@/components/approvals/approval-panel";
import { BillHeader } from "@/components/bills/bill-header";
import { InvoicePreview } from "@/components/bills/invoice-preview";
import { LineItemsEditor } from "@/components/bills/line-items-editor";
import { PaymentPanel } from "@/components/payments/payment-panel";
import { getCurrentUser } from "@/lib/current-user";
import { getBillDetail } from "@/server/bill-detail";
import { getActiveGlAccounts } from "@/server/reference-data";

interface BillDetailPageProps {
  params: Promise<{ id: string }>;
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
 * coding, approval, payment and audit panels scroll on the right.
 *
 * FROZEN — foundation-owned and shared by all three verticals. Do not edit it
 * to add a query or widen a prop: if you need a wider `billDetailInclude`,
 * STOP and coordinate. `billDetailInclude` lives in `src/server/bill-detail.ts`,
 * which is frozen too.
 */
export default async function BillDetailPage({ params }: BillDetailPageProps) {
  const { id } = await params;

  const [bill, currentUser, glAccounts] = await Promise.all([
    getBillDetail(id),
    getCurrentUser(),
    getActiveGlAccounts(),
  ]);

  if (!bill) notFound();

  return (
    <div className="space-y-5">
      <Link
        href="/bills"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors"
      >
        <ChevronLeft className="size-4" />
        Back to bills
      </Link>

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
