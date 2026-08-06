import { PageHeader } from "@/components/common/page-header";
import { PanelSkeleton, StatCardsSkeleton } from "@/components/common/loading";

/**
 * Route-level skeleton for the dashboard.
 *
 * Shaped like the page that arrives — four tiles, the approval queue beside the
 * drafts panel, the aging strip, then the two feeds — so nothing jumps when the
 * roll-ups land.
 */
export default function DashboardLoading() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Loading what accounts payable needs from you today…"
      />

      <div className="space-y-4">
        <StatCardsSkeleton />

        <div className="grid gap-4 lg:grid-cols-3">
          <PanelSkeleton lines={6} className="lg:col-span-2" />
          <PanelSkeleton lines={6} />
        </div>

        <PanelSkeleton lines={3} />

        <div className="grid gap-4 lg:grid-cols-2">
          <PanelSkeleton lines={5} />
          <PanelSkeleton lines={5} />
        </div>
      </div>
    </>
  );
}
