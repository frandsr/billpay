import { PageHeader } from "@/components/common/page-header";
import { StatCardsSkeleton, TableSkeleton } from "@/components/common/loading";

export default function RecurringLoading() {
  return (
    <>
      <PageHeader
        title="Recurring bills"
        description="Loading the templates that generate bills on a schedule…"
      />
      <div className="space-y-4">
        <StatCardsSkeleton />
        <TableSkeleton rows={4} />
      </div>
    </>
  );
}
