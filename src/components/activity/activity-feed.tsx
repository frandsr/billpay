// STUB: implemented in the VERTICAL B phase (bill detail).
// Owner: Vertical B — it owns all of src/components/activity/.
//
// Expected behaviour: reverse-chronological audit trail for the bill — actor,
// ActivityType, message and relative timestamp, using the Activity rows already
// loaded on BillDetail, plus a comment box that appends a COMMENTED activity
// attributed to getCurrentUser().

import { StubPanel } from "@/components/common/stub-panel";
import type { BillDetail } from "@/server/bill-detail";

export interface ActivityFeedProps {
  bill: BillDetail;
}

export function ActivityFeed({ bill }: ActivityFeedProps) {
  return (
    <StubPanel
      title="Activity"
      owner="Vertical B — bill detail"
      summary={`Audit trail for this bill (${bill.activities.length} entries) and the comment box.`}
    />
  );
}
