import { PageHeader } from "@/components/common/page-header";
import { StatCardsSkeleton } from "@/components/common/loading";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level skeleton for the register.
 *
 * Shaped like what actually arrives — four tiles, the section strip, the filter
 * bar, the summary line, then the grouped table — so the layout does not jump
 * when the payments land. Every section and filter change is a navigation, so
 * this is what a reviewer sees between them.
 */
export default function PaymentsLoading() {
  return (
    <>
      <PageHeader
        title="Payments"
        description="What is leaving the bank, and when. Every payment carries its own lifecycle — scheduled, initiated, paid or failed — independent of the bill it settles."
      />

      <div className="space-y-4">
        <StatCardsSkeleton />

        <Skeleton className="h-8 w-full max-w-md rounded-lg" />

        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
        </div>

        <Skeleton className="h-3 w-56" />

        <div className="ring-foreground/10 overflow-hidden rounded-xl ring-1">
          <div className="bg-muted/40 flex h-10 items-center gap-4 border-b px-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="ml-auto h-3 w-16" />
          </div>
          {Array.from({ length: 3 }).map((_, group) => (
            <div key={group}>
              <div className="bg-muted/20 flex items-center justify-between border-b px-3 py-2">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
              {Array.from({ length: 2 }).map((_, row) => (
                <div
                  key={row}
                  className="flex items-center gap-4 border-b px-3 py-3 last:border-0"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-2.5 w-24" />
                  </div>
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="hidden h-3 w-20 lg:block" />
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3.5 w-20" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
