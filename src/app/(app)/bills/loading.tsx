import { PageHeader } from "@/components/common/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level skeleton for the inbox.
 *
 * Shaped like what actually arrives — tab strip, filter bar, summary line, then
 * the table — so the layout does not jump when the data lands. Every filter and
 * sort change is a navigation, so this is what the reviewer sees between them.
 */
export default function BillsLoading() {
  return (
    <>
      <PageHeader
        title="Bills"
        description="Every payable, from draft through approval to payment."
        actions={<Skeleton className="h-8 w-24" />}
      />

      <div className="space-y-4">
        <Skeleton className="h-8 w-full max-w-md rounded-lg" />

        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-full sm:w-64" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-24" />
        </div>

        <Skeleton className="h-3 w-56" />

        <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
          <div className="bg-muted/40 flex h-10 items-center gap-4 border-b px-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="ml-auto h-3 w-16" />
          </div>
          {Array.from({ length: 10 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-4 border-b px-3 py-3 last:border-0"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-2.5 w-24" />
              </div>
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="hidden h-3 w-20 lg:block" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3.5 w-20" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
