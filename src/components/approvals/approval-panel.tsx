// STUB: implemented in the VERTICAL C phase (approvals & payments).
// Owner: Vertical C — it owns all of src/components/approvals/.
//
// Expected behaviour: submitting for approval resolves the first applicable
// policy by priority ASC where minAmountCents <= totalCents
// (resolveApprovalPolicy) and SNAPSHOTS its ordered approvers onto the bill as
// ApprovalStep rows; a matching policy with zero steps auto-approves. The panel
// shows the full chain with each approver's state, the "X of N approved"
// indicator (approvalProgress) and whose turn it is. Approve / Reject is
// offered only to the current step's approver and is re-checked server-side
// against getCurrentUser(). Sequential only: step n+1 unlocks when step n is
// APPROVED; a rejection at any step sets the bill to REJECTED. Approving the
// last step moves the bill to APPROVED via assertTransition().

import type { User } from "@prisma/client";

import { StubPanel } from "@/components/common/stub-panel";
import type { BillDetail } from "@/server/bill-detail";

export interface ApprovalPanelProps {
  bill: BillDetail;
  currentUser: User;
}

export function ApprovalPanel({ bill }: ApprovalPanelProps) {
  return (
    <StubPanel
      title="Approvals"
      owner="Vertical C — approvals & payments"
      summary={`Approval chain (${bill.approvalSteps.length} step(s)) with approve and reject actions for the acting user.`}
    />
  );
}
