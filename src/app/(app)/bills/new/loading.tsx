import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Without this, `/bills/loading.tsx` would flash the inbox table skeleton on
 * the way to a form. Segment-level skeletons are cheap; a misleading one is not.
 */
export default function NewBillLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl">
      <Skeleton className="mb-4 h-4 w-28" />
      <PageHeader
        title="New bill"
        description="Enter a bill by hand. It is saved as a draft — nothing is submitted for approval until you say so."
      />

      <div className="space-y-5">
        <Card>
          <CardHeader className="border-b">
            <Skeleton className="h-4 w-28" />
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
