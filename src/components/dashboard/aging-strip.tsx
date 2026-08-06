import { Layers } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBasisPoints } from "@/lib/splits";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { AgingSlice } from "@/components/dashboard/rollups";
import type { AgingBucket } from "@/lib/dates";

export interface AgingStripProps {
  slices: AgingSlice[];
  totalCents: number;
  currency?: string;
}

/**
 * How old the outstanding balance is, as a single segmented bar.
 *
 * This is what survives of the AP aging report that was cut from scope (ADR
 * 0008): the buckets come from `agingBucket()` in the shared core, so this
 * strip and any future report are reading the same classification. It is drawn
 * with two divs and a width percentage rather than a charting dependency —
 * five segments do not justify shipping a plotting library, and the segments
 * stay legible in dark mode and in print.
 *
 * The colour ramp runs cool → hot with the age of the debt, matching the tints
 * `BILL_STATUS_META` already uses elsewhere (emerald = fine, amber = watch,
 * red = late), so the page reads as one product.
 */
const BUCKET_STYLES: Record<
  AgingBucket,
  { bar: string; dot: string; text: string }
> = {
  CURRENT: {
    bar: "bg-emerald-500 dark:bg-emerald-600",
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-400",
  },
  D1_30: {
    bar: "bg-amber-400 dark:bg-amber-500",
    dot: "bg-amber-400",
    text: "text-amber-700 dark:text-amber-400",
  },
  D31_60: {
    bar: "bg-orange-500 dark:bg-orange-600",
    dot: "bg-orange-500",
    text: "text-orange-700 dark:text-orange-400",
  },
  D61_90: {
    bar: "bg-red-500 dark:bg-red-600",
    dot: "bg-red-500",
    text: "text-red-700 dark:text-red-400",
  },
  D90_PLUS: {
    bar: "bg-red-800 dark:bg-red-900",
    dot: "bg-red-800",
    text: "text-red-800 dark:text-red-400",
  },
};

export function AgingStrip({ slices, totalCents, currency = "USD" }: AgingStripProps) {
  const populated = slices.filter((slice) => slice.amountCents > 0);
  const pastDueCents = slices
    .filter((slice) => slice.bucket !== "CURRENT")
    .reduce((total, slice) => total + slice.amountCents, 0);

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <Layers className="text-muted-foreground size-4" />
          Aging of outstanding payables
        </CardTitle>
        <CardAction>
          <span className="text-muted-foreground text-xs">
            {formatCents(totalCents, { currency })} across {slices.reduce((n, s) => n + s.count, 0)}{" "}
            bills
          </span>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        {totalCents === 0 ? (
          <EmptyState
            icon={Layers}
            title="Nothing outstanding"
            description="Every submitted bill has been paid, archived or is still a draft."
            className="py-8"
          />
        ) : (
          <>
            <div
              className="bg-muted flex h-3 w-full overflow-hidden rounded-full"
              role="img"
              aria-label={populated
                .map(
                  (slice) =>
                    `${slice.label}: ${formatCents(slice.amountCents, { currency, compact: true })}`,
                )
                .join(", ")}
            >
              {populated.map((slice) => (
                <span
                  key={slice.bucket}
                  className={cn("h-full", BUCKET_STYLES[slice.bucket].bar)}
                  style={{ width: `${slice.shareBasisPoints / 100}%` }}
                />
              ))}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
              {slices.map((slice) => (
                <div key={slice.bucket} className="space-y-0.5">
                  <dt className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium">
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        slice.amountCents > 0
                          ? BUCKET_STYLES[slice.bucket].dot
                          : "bg-muted-foreground/30",
                      )}
                    />
                    {slice.label}
                  </dt>
                  <dd
                    className={cn(
                      "text-sm font-semibold tabular-nums",
                      slice.amountCents > 0
                        ? BUCKET_STYLES[slice.bucket].text
                        : "text-muted-foreground",
                    )}
                  >
                    {formatCents(slice.amountCents, { currency, compact: true })}
                  </dd>
                  <dd className="text-muted-foreground text-[11px] tabular-nums">
                    {slice.count} {slice.count === 1 ? "bill" : "bills"} ·{" "}
                    {formatBasisPoints(slice.shareBasisPoints)}
                  </dd>
                </div>
              ))}
            </dl>

            <p className="text-muted-foreground border-t pt-3 text-xs">
              {pastDueCents > 0 ? (
                <>
                  <span className="text-foreground font-medium">
                    {formatCents(pastDueCents, { currency })}
                  </span>{" "}
                  of the outstanding balance is already past due. Buckets are
                  calendar days past the due date, counted by{" "}
                  <code className="font-mono text-[11px]">agingBucket()</code>.
                </>
              ) : (
                <>
                  Nothing is past due — the whole outstanding balance is still
                  within terms.
                </>
              )}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
