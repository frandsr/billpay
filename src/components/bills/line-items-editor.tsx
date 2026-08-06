// STUB: implemented in the VERTICAL B phase (bill detail).
// Owner: Vertical B.
//
// Expected behaviour: add, edit, reorder and delete line items (description,
// quantity, unit price, amount, GL account, department) with a running Σ(lines)
// vs. `totalCents` reconciliation strip showing the signed difference when they
// disagree. `totalCents` stays authoritative — the editor never silently
// rewrites it (ADR 0004). Use draftReadinessDetail() for the issue list, and
// lineAmountCents()/sumCents() for the arithmetic. Only DRAFT and REJECTED
// bills are editable, enforced in the action rather than only in the UI.

import type { GlAccount } from "@prisma/client";

import { StubPanel } from "@/components/common/stub-panel";
import type { BillDetail } from "@/server/bill-detail";

export interface LineItemsEditorProps {
  bill: BillDetail;
  glAccounts: GlAccount[];
}

export function LineItemsEditor({ bill }: LineItemsEditorProps) {
  return (
    <StubPanel
      title="Line items"
      owner="Vertical B — bill detail"
      summary={`${bill.lineItems.length} line item(s) with GL coding, and the running total vs. the bill amount.`}
    />
  );
}
