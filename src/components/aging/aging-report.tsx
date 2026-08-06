// STUB: implemented in PHASE 2 (integration), not in a parallel vertical.
// Owner: Phase 2. It is a read-only aggregation over data the verticals
// produce, so it is built after they merge rather than beside them.
//
// Expected behaviour: AP aging — outstanding bills (DRAFT, AWAITING_APPROVAL,
// APPROVED, REJECTED; never PAID or ARCHIVED) bucketed with agingBucket() into
// Current / 1–30 / 31–60 / 61–90 / 90+, totalled per vendor with a grand total
// row, and drill-down into the underlying bills.

import { StubPanel } from "@/components/common/stub-panel";

export function AgingReport() {
  return (
    <StubPanel
      title="AP Aging"
      owner="Phase 2 — integration"
      summary="Outstanding balance by vendor across the Current, 1–30, 31–60, 61–90 and 90+ buckets."
    />
  );
}
