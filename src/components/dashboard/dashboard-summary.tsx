// STUB: implemented in PHASE 2 (integration), not in a parallel vertical.
// Owner: Phase 2. It is a read-only aggregation over data the verticals
// produce, so it is built after they merge rather than beside them.
//
// Expected behaviour: KPI tiles (total outstanding, awaiting approval, overdue,
// scheduled this week), an "needs your approval" queue for the current user and
// a short list of bills due soon. Read-only server component.

import type { User } from "@prisma/client";

import { StubPanel } from "@/components/common/stub-panel";

export interface DashboardSummaryProps {
  currentUser: User;
}

export function DashboardSummary({ currentUser }: DashboardSummaryProps) {
  return (
    <StubPanel
      title="Dashboard summary"
      owner="Phase 2 — integration"
      summary={`Outstanding balance, approvals waiting on ${currentUser.name}, bills due soon and payments scheduled this week.`}
    />
  );
}
