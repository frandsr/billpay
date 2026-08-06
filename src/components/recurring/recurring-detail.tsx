import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  Building2,
  Pencil,
  ReceiptText,
  TriangleAlert,
} from "lucide-react";

import {
  GenerateNowButton,
  PauseToggleButton,
} from "@/components/recurring/recurring-actions";
import { getRecurringTemplate } from "@/server/queries/recurring";
import { UpcomingRuns } from "@/components/recurring/upcoming-runs";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BILL_STATUS_META } from "@/lib/bill-status";
import {
  PAYMENT_TERMS_LABELS,
  daysBetween,
  dueDateFrom,
  formatDate,
  todayUtc,
} from "@/lib/dates";
import { formatCents, sumCents } from "@/lib/money";
import {
  RECURRING_FREQUENCY_LABELS,
  dueOccurrences,
  isDue,
} from "@/lib/recurring";
import { cn } from "@/lib/utils";

export interface RecurringDetailProps {
  templateId: string;
}

/**
 * One template: what it will produce, and what it has produced.
 *
 * The generated bills are listed here because `Bill.recurringBillId` is the
 * only link between a payable and the template that made it — from a draft's
 * point of view it is an ordinary bill, so provenance has to be legible from
 * this side.
 */
export async function RecurringDetail({ templateId }: RecurringDetailProps) {
  const template = await getRecurringTemplate(templateId);
  if (!template) notFound();

  const today = todayUtc();
  const due = isDue(template, today);
  const owedOccurrences = dueOccurrences(template, today);
  const daysLate = daysBetween(template.nextRunDate, today);
  const lineTotalCents = sumCents(
    template.lineItems.map((line) => line.amountCents),
  );
  const differenceCents = lineTotalCents - template.amountCents;
  const uncodedLines = template.lineItems.filter(
    (line) => !line.glAccountId,
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="ghost" asChild>
          <Link href="/recurring">
            <ArrowLeft data-icon="inline-start" />
            All templates
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-1.5">
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
          <PauseToggleButton templateId={template.id} active={template.active} />
        </div>
      </div>

      {due ? (
        <Card className="gap-1 border-amber-300 bg-amber-50 p-4 dark:border-amber-800/70 dark:bg-amber-950/40">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
            <TriangleAlert className="size-4" />
            This template owes {owedOccurrences.length} draft{" "}
            {owedOccurrences.length === 1 ? "bill" : "bills"}
          </p>
          <p className="text-xs text-amber-800/90 dark:text-amber-300/90">
            Scheduled for {formatDate(template.nextRunDate)}
            {daysLate > 0
              ? ` — ${daysLate} ${daysLate === 1 ? "day" : "days"} ago`
              : " — today"}
            . Periods owed:{" "}
            {owedOccurrences.map((occurrence) => formatDate(occurrence)).join(", ")}
            . Generating creates one draft per period, each dated to its own
            period, so no period is silently skipped.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="gap-4 p-4 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">{template.name}</h2>
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Building2 className="size-3.5" />
                {template.vendor.name}
                <span aria-hidden>·</span>
                Created by {template.createdBy.name}
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
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
            <Fact label="Amount per bill">
              <span className="text-sm font-semibold tabular-nums">
                {formatCents(template.amountCents, {
                  currency: template.currency,
                })}
              </span>
            </Fact>
            <Fact label="Payment terms">
              {PAYMENT_TERMS_LABELS[template.paymentTerms]}
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
            <Fact label="Next due date">
              <span className="tabular-nums">
                {formatDate(
                  dueDateFrom(template.nextRunDate, template.paymentTerms),
                )}
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
              {template.generatedBills.length}
            </Fact>
          </dl>

          {template.memo ? (
            <p className="text-muted-foreground border-t pt-3 text-xs">
              <span className="font-medium">Memo:</span> {template.memo}
            </p>
          ) : null}
        </Card>

        <Card className="gap-3 p-4">
          <h2 className="text-sm font-semibold">Cadence</h2>
          <UpcomingRuns schedule={template} count={5} long />
          <p className="text-muted-foreground text-xs">
            Dates are UTC. A day-of-month past the end of a short month is
            clamped and then restored, so a template anchored on the 31st fires
            on 28 February and returns to 31 March rather than drifting earlier
            forever.
          </p>
        </Card>
      </div>

      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Line items and GL coding</h2>
          <span className="text-muted-foreground text-xs">
            Copied onto every generated draft.
          </span>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead>GL account</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit price</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {template.lineItems.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="font-medium">{line.description}</TableCell>
                <TableCell>
                  {line.glAccount ? (
                    <span className="tabular-nums">
                      {line.glAccount.code} — {line.glAccount.name}
                    </span>
                  ) : (
                    <span className="text-orange-700 dark:text-orange-400">
                      Uncoded
                    </span>
                  )}
                </TableCell>
                <TableCell>{line.department ?? "—"}</TableCell>
                <TableCell className="capitalize">
                  {line.lineType.toLowerCase()}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {line.quantity}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCents(line.unitPriceCents, {
                    currency: template.currency,
                  })}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCents(line.amountCents, {
                    currency: template.currency,
                  })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-xs",
            differenceCents !== 0 &&
              "border-orange-300 bg-orange-50 dark:border-orange-800/60 dark:bg-orange-950/40",
          )}
        >
          Lines total{" "}
          <strong className="tabular-nums">
            {formatCents(lineTotalCents, { currency: template.currency })}
          </strong>{" "}
          vs bill amount{" "}
          <strong className="tabular-nums">
            {formatCents(template.amountCents, { currency: template.currency })}
          </strong>
          {differenceCents !== 0 ? (
            <>
              {" "}
              — off by{" "}
              <strong className="tabular-nums">
                {formatCents(differenceCents, { currency: template.currency })}
              </strong>
              . Generated drafts will be flagged <em>Missing info</em> until the
              coding reconciles.
            </>
          ) : null}
          {uncodedLines > 0 ? (
            <>
              {" "}
              {uncodedLines} {uncodedLines === 1 ? "line has" : "lines have"} no
              GL account.
            </>
          ) : null}
        </div>
      </Card>

      <Card className="gap-3 p-4">
        <h2 className="text-sm font-semibold">
          Bills produced by this template
        </h2>

        {template.generatedBills.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No bills generated yet"
            description="Generate now creates a coded DRAFT for every period this template owes."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bill number</TableHead>
                <TableHead>Period (issue date)</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {template.generatedBills.map((bill) => {
                const meta = BILL_STATUS_META[bill.status];
                return (
                  <TableRow key={bill.id}>
                    <TableCell className="font-medium tabular-nums">
                      {bill.billNumber}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatDate(bill.issueDate)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatDate(bill.dueDate)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={meta.badgeVariant}
                        className={meta.badgeClassName}
                      >
                        {meta.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCents(bill.totalCents, {
                        currency: bill.currency,
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="xs" variant="ghost" asChild>
                        <Link href={`/bills/${bill.id}`}>Open bill</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
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
