import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock, Stamp } from "lucide-react";

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
import { formatDueDistance, formatDate, isOverdue } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import type {
  ApprovalQueue,
  ApprovalQueueRow,
} from "@/components/dashboard/rollups";

export interface ApprovalQueueCardProps {
  queue: ApprovalQueue;
  userName: string;
}

/**
 * The reason an approver opens this app: what is waiting on them, right now.
 *
 * "Waiting on me" is not "a pending step with my name on it" — approval is
 * sequential (ADR 0003), so a bill only reaches this list once every earlier
 * step has cleared. `splitApprovalQueue` makes that call with the same
 * `currentPendingStep` the approval panel and the server action use, which is
 * why every row here links to a bill whose Approve button is actually enabled.
 *
 * When the list is empty the card does not go blank: it shows what the user is
 * queued for next, and failing that where the rest of the queue is sitting, so
 * switching demo users always leaves something legible on screen.
 */
export function ApprovalQueueCard({ queue, userName }: ApprovalQueueCardProps) {
  const { waitingOnMe, queuedForMe, elsewhere } = queue;
  const waitingCents = waitingOnMe.reduce(
    (total, row) => total + row.totalCents,
    0,
  );
  const firstName = userName.split(" ")[0];

  return (
    <Card
      className={cn(
        waitingOnMe.length > 0 && "ring-amber-300 dark:ring-amber-800/70",
      )}
    >
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <Stamp className="text-muted-foreground size-4" />
          Waiting on your approval
        </CardTitle>
        {waitingOnMe.length > 0 ? (
          <CardAction>
            <Badge
              variant="outline"
              className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/60 dark:text-amber-300"
            >
              {waitingOnMe.length} · {formatCents(waitingCents, { compact: true })}
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-3">
        {waitingOnMe.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title={`Nothing needs ${firstName} right now`}
            description={
              queuedForMe.length > 0
                ? `${queuedForMe.length} ${queuedForMe.length === 1 ? "bill" : "bills"} will reach you once an earlier approver signs off.`
                : "No approval step in the chain is assigned to you today."
            }
            className="py-8"
          />
        ) : (
          <ul className="divide-y">
            {waitingOnMe.map((row) => (
              <QueueRow key={row.id} row={row} actionable />
            ))}
          </ul>
        )}

        {queuedForMe.length > 0 ? (
          <div className="space-y-2 border-t pt-3">
            <p className="text-muted-foreground text-xs font-medium">
              Coming to you next — {queuedForMe.length}{" "}
              {queuedForMe.length === 1 ? "bill" : "bills"} still with an earlier
              approver
            </p>
            <ul className="divide-y">
              {queuedForMe.slice(0, 3).map((row) => (
                <QueueRow key={row.id} row={row} />
              ))}
            </ul>
          </div>
        ) : null}

        {waitingOnMe.length === 0 &&
        queuedForMe.length === 0 &&
        elsewhere.length > 0 ? (
          <div className="space-y-2 border-t pt-3">
            <p className="text-muted-foreground text-xs font-medium">
              Elsewhere in the approval queue — {elsewhere.length}{" "}
              {elsewhere.length === 1 ? "bill" : "bills"}
            </p>
            <ul className="divide-y">
              {elsewhere.slice(0, 3).map((row) => (
                <QueueRow key={row.id} row={row} />
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function QueueRow({
  row,
  actionable = false,
}: {
  row: ApprovalQueueRow;
  actionable?: boolean;
}) {
  const late = isOverdue(row.dueDate);

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
      <div className="min-w-0 space-y-0.5">
        <Link
          href={`/bills/${row.id}`}
          className="text-sm font-medium hover:underline"
        >
          {row.vendorName}
          <span className="text-muted-foreground font-normal"> · {row.billNumber}</span>
        </Link>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
          <Clock className="size-3" />
          <span
            className={cn(
              "tabular-nums",
              late && "font-medium text-red-700 dark:text-red-400",
            )}
          >
            {formatDueDistance(row.dueDate)}
          </span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{formatDate(row.dueDate)}</span>
          <span aria-hidden>·</span>
          <span>
            {row.stepCount > 1
              ? `Step ${row.stepOrder} of ${row.stepCount}`
              : row.progressLabel}
          </span>
          {row.currentApproverName ? (
            <>
              <span aria-hidden>·</span>
              <span>with {row.currentApproverName}</span>
            </>
          ) : null}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tabular-nums">
          {formatCents(row.totalCents, { currency: row.currency })}
        </span>
        {actionable ? (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/bills/${row.id}`}>
              Review
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        ) : null}
      </div>
    </li>
  );
}
