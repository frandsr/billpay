import Link from "next/link";
import { FileWarning, Sparkles } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DRAFT_READINESS_META } from "@/lib/bill-status";
import { formatCents } from "@/lib/money";
import type { DraftAttentionRow } from "@/components/dashboard/rollups";

export interface DraftsPanelProps {
  drafts: DraftAttentionRow[];
  /** Every draft, including the ones that are ready to submit. */
  draftCount: number;
}

/**
 * Drafts that cannot be submitted yet, and why.
 *
 * `Missing info` is a DERIVED flag, never a stored column (GLOSSARY), so this
 * list is `draftReadinessDetail()` applied to the same rows the bill detail
 * page reads. Each row names the actual defect — an uncoded line, a total that
 * does not reconcile — because "incomplete" on its own is not actionable, and
 * an OCR import is exactly where a reviewer needs to know which number
 * disagrees.
 */
export function DraftsPanel({ drafts, draftCount }: DraftsPanelProps) {
  const missingMeta = DRAFT_READINESS_META.MISSING_INFO;
  const readyCount = draftCount - drafts.length;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <FileWarning className="text-muted-foreground size-4" />
          Drafts needing attention
        </CardTitle>
        <CardAction>
          <span className="text-muted-foreground text-xs">
            {readyCount} of {draftCount} ready to submit
          </span>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3">
        {drafts.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="Every draft is ready"
            description={
              draftCount === 0
                ? "There are no drafts waiting — new bills arrive from the import wizard, an invoice upload or a recurring template."
                : "No draft is missing required information, so they can all go out for approval."
            }
            className="py-8"
          />
        ) : (
          <ul className="divide-y">
            {drafts.slice(0, 4).map((draft) => (
              <li key={draft.id} className="space-y-1 py-2 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <Link
                    href={`/bills/${draft.id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {draft.vendorName}
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      · {draft.billNumber}
                    </span>
                  </Link>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={missingMeta.badgeVariant}
                      className={missingMeta.badgeClassName}
                    >
                      {missingMeta.label}
                    </Badge>
                    <span className="text-sm font-semibold tabular-nums">
                      {formatCents(draft.totalCents, { currency: draft.currency })}
                    </span>
                  </div>
                </div>
                <ul className="text-muted-foreground space-y-0.5 text-xs">
                  {draft.issues.slice(0, 2).map((issue) => (
                    <li key={issue} className="flex gap-1.5">
                      <span aria-hidden>—</span>
                      <span>{issue}</span>
                    </li>
                  ))}
                  {draft.issues.length > 2 ? (
                    <li className="pl-4">
                      + {draft.issues.length - 2} more to fix
                    </li>
                  ) : null}
                </ul>
              </li>
            ))}
          </ul>
        )}

        {drafts.length > 4 ? (
          <Button size="sm" variant="ghost" asChild className="w-full">
            <Link href="/bills">
              See all {drafts.length} incomplete drafts
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
