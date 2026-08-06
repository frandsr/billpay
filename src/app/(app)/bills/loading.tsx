import { PageHeader } from "@/components/common/page-header";
import { TableSkeleton } from "@/components/common/loading";

export default function BillsLoading() {
  return (
    <>
      <PageHeader title="Bills" description="Loading the accounts payable inbox…" />
      <TableSkeleton rows={10} />
    </>
  );
}
