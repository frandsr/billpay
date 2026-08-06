// STUB: implemented in the VERTICAL C phase (approvals & payments).
// Owner: Vertical C — it owns all of src/components/payments/.
//
// Expected behaviour: schedule a Payment on an APPROVED bill (method ACH /
// CHECK / CARD / WIRE + scheduled date), creating it as SCHEDULED; show the
// payment's own lifecycle (SCHEDULED / INITIATED / PAID / FAILED) via
// PAYMENT_STATUS_META; a separate action completes it → payment PAID, bill PAID
// through assertTransition(). A payment cannot be scheduled when the vendor has
// no payment details — say why in the UI. The Bill has no SCHEDULED status:
// scheduling lives entirely on the Payment (ADR 0002).

import type { User } from "@prisma/client";

import { StubPanel } from "@/components/common/stub-panel";
import type { BillDetail } from "@/server/bill-detail";

export interface PaymentPanelProps {
  bill: BillDetail;
  currentUser: User;
}

export function PaymentPanel({ bill }: PaymentPanelProps) {
  return (
    <StubPanel
      title="Payment"
      owner="Vertical C — approvals & payments"
      summary={
        bill.payments.length > 0
          ? `Payment lifecycle for this bill (${bill.payments.length} payment record).`
          : "Schedule a payment once the bill is approved — method, date and reference."
      }
    />
  );
}
