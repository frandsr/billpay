// STUB: implemented in PHASE 2 (integration), not in a parallel vertical.
// Owner: Phase 2. It is a read-only aggregation over data the verticals
// produce, so it is built after they merge rather than beside them.
//
// Expected behaviour: vendor table with name, default payment terms, default GL
// account, 1099 flag, masked payment details, open balance and bill count, plus
// a detail sheet. Renders its own data server-side.

import { StubPanel } from "@/components/common/stub-panel";

export function VendorList() {
  return (
    <StubPanel
      title="Vendors"
      owner="Phase 2 — integration"
      summary="Every supplier with default terms, GL coding, masked payment details and open balance."
    />
  );
}
