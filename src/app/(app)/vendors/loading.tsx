import { PageHeader } from "@/components/common/page-header";
import { StatCardsSkeleton, TableSkeleton } from "@/components/common/loading";

export default function VendorsLoading() {
  return (
    <>
      <PageHeader
        title="Vendors"
        description="Loading suppliers, their payment details and what we owe them…"
      />
      <div className="space-y-4">
        <StatCardsSkeleton />
        <TableSkeleton rows={8} />
      </div>
    </>
  );
}
