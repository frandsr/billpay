import Link from "next/link";
import type { ReactNode } from "react";
import { Building2, Pencil, ReceiptText, TriangleAlert } from "lucide-react";

import {
  GenerateNowButton,
  PauseToggleButton,
} from "@/components/recurring/recurring-actions";
import { UpcomingRuns } from "@/components/recurring/upcoming-runs";
import type { RecurringTemplateListItem } from "@/server/queries/recurring";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PAYMENT_TERMS_LABELS, daysBetween, formatDate, todayUtc } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import {
  RECURRING_FREQUENCY_LABELS,
  dueOccurrences,
  isDue,
} from "@/lib/recurring";
import { cn } from "@/lib/utils";

export interface TemplateCardProps {
  template: RecurringTemplateListItem;
  today?: Date;
}

/**
 * One recurring template in the list.
 *
 * An overdue template is the reason someone opened this page, so it is given a
 * tinted header strip stating how many drafts it owes and how late it is —
 * rather than a badge the eye has to hunt for in a row of other badges.
 */
export function TemplateCard({ template, today = todayUtc() }: TemplateCardProps) {
  const due = isDue(template, today);
  const owed = due ? dueOccurrences(template, today).length : 0;
  const daysLate = daysBetween(template.nextRunDate, today);
  const uncodedLines = template.lineItems.filter(
    (line) => !line.glAccountId,
  ).length;

  return (
    <Card
      className={cn(
        "gap-0 overflow-hidden p-0",
        due && "border-amber-300 dark:border-amber-800/70",
        !template.active && "opacity-75",
      )}
    >
      {due ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-200">
          <TriangleAlert className="size-3.5" />
          <span>
            Due — owes {owed} draft {owed === 1 ? "bill" : "bills"}
          </span>
          <span className="font-normal text-amber-800/80 dark:text-amber-300/80">
            · scheduled for {formatDate(template.nextRunDate)}
            {daysLate > 0
              ? ` (${daysLate} ${daysLate === 1 ? "day" : "days"} ago)`
              : " (today)"}
          </span>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <Link
              href={`/recurring/${template.id}`}
              className="text-sm font-semibold hover:underline"
            >
              {template.name}
            </Link>
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Building2 className="size-3.5" />
              {template.vendor.name}
              <span aria-hidden>·</span>
              {PAYMENT_TERMS_LABELS[template.paymentTerms]}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">
              {RECURRING_FREQUENCY_LABELS[template.frequency]}
              {template.dayOfMonth ? ` · day ${template.dayOfMonth}` : ""}
            </Badge>
            {template.active ? null : (
              <Badge
                variant="outline"
                className="border-neutral-300 bg-neutral-100 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400"
              >
                Paused
              </Badge>
            )}
            {uncodedLines > 0 ? (
              <Badge
                variant="outline"
                className="border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800/60 dark:bg-orange-950/60 dark:text-orange-300"
              >
                {uncodedLines} uncoded {uncodedLines === 1 ? "line" : "lines"}
              </Badge>
            ) : null}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
          <Fact label="Amount">
            <span className="text-sm font-semibold tabular-nums">
              {formatCents(template.amountCents, {
                currency: template.currency,
              })}
            </span>
          </Fact>
          <Fact label="Next run">
            <span
              className={cn(
                "tabular-nums",
                due && "font-medium text-amber-700 dark:text-amber-400",
              )}
            >
              {formatDate(template.nextRunDate)}
            </span>
          </Fact>
          <Fact label="Last generated">
            {template.lastGeneratedAt ? (
              <span className="tabular-nums">
                {formatDate(template.lastGeneratedAt)}
              </span>
            ) : (
              <span className="text-muted-foreground">Never</span>
            )}
          </Fact>
          <Fact label="Bills produced">
            {template._count.generatedBills > 0 ? (
              <Link
                href={`/recurring/${template.id}`}
                className="inline-flex items-center gap-1 hover:underline"
              >
                <ReceiptText className="size-3.5" />
                {template._count.generatedBills}
              </Link>
            ) : (
              <span className="text-muted-foreground">None yet</span>
            )}
          </Fact>
        </dl>

        <UpcomingRuns schedule={template} count={3} />

        <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
          <GenerateNowButton
            templateId={template.id}
            paused={!template.active}
            due={due}
          />
          <Button size="sm" variant="outline" asChild>
            <Link href={`/recurring/${template.id}/edit`}>
              <Pencil data-icon="inline-start" />
              Edit
            </Link>
          </Button>
          <PauseToggleButton
            templateId={template.id}
            active={template.active}
          />
          <Button size="sm" variant="ghost" asChild className="ml-auto">
            <Link href={`/recurring/${template.id}`}>Open</Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground text-[11px] font-medium">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
