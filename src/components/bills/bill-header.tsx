// STUB: implemented in the VERTICAL B phase (bill detail).
// Owner: Vertical B. src/components/bills/ is shared with vertical A — B owns
// bill-header.tsx, line-items-editor.tsx and invoice-preview.tsx only.
//
// Expected behaviour: vendor name, bill number, status badge (BILL_STATUS_META),
// derived `Missing info` / `Ready` flag on drafts, total, due date with overdue
// emphasis, and the stage-appropriate primary action. Every status change must
// go through assertTransition() in a server action, never the UI alone.

import type { User } from "@prisma/client";

import { StubPanel } from "@/components/common/stub-panel";
import type { BillDetail } from "@/server/bill-detail";

export interface BillHeaderProps {
  bill: BillDetail;
  currentUser: User;
}

export function BillHeader({ bill }: BillHeaderProps) {
  return (
    <StubPanel
      title={`Bill header — ${bill.vendor.name} · ${bill.billNumber}`}
      owner="Vertical B — bill detail"
      summary="Vendor, amount, due date, status badge and the lifecycle actions (submit, approve, archive)."
    />
  );
}
