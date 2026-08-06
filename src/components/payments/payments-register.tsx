import type { ReactNode } from "react";
import Link from "next/link";
import {
  Banknote,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Send,
  TriangleAlert,
} from "lucide-react";

import {
  REGISTER_SECTIONS,
  REGISTER_SECTION_META,
  buildPaymentsHref,
  parsePaymentFilters,
  sectionGroupsByDate,
  type PaymentFilters,
  type RegisterSection,
} from "@/components/payments/payments-filters";
import {
  formatDayDistance,
  groupPaymentsByScheduledDate,
  type PaymentDateGroup,
} from "@/components/payments/rollups";
import { EmptyState } from "@/components/common/empty-state";
import { StatCard } from "@/components/common/stat-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PAYMENT_STATUS_META } from "@/lib/bill-status";
import { formatDate, formatShortDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { PAYMENT_METHOD_LABELS } from "@/lib/payment-lifecycle";
import { cn } from "@/lib/utils";
import {
  getPaymentsRegister,
  type PaymentsRegisterResult,
  type RegisterPayment,
} from "@/server/queries/payments";

/**
 * The payments register — what is leaving the bank, and when.
 *
 * This view exists because ADR 0002 makes the Payment a separate entity with
 * its own lifecycle. The bill detail page can answer "was this bill paid?"; it
 * cannot answer "what leaves the account on Thursday", because that question is
 * about payments, not bills. So the register is rooted in the PAYMENT
 * vocabulary throughout — Scheduled, Initiated, Paid, Failed — and never shows
 * a bill status anywhere. The bill appears only as the number you click through
 * to.
 *
 * A Server Component from top to bottom: the sections are plain links that
 * rewrite the URL and `parsePaymentFilters` turns that URL back into the query,
 * so any view can be pasted to a colleague and nothing about the register is
 * held as client state.
 */

export interface PaymentsRegisterProps {
  /** Route search params, so sections and filters live in the URL. */
  searchParams?: Record<string, string | string[] | undefined>;
}

export async function PaymentsRegister({
  searchParams = {},
}: PaymentsRegisterProps) {
  const filters = parsePaymentFilters(searchParams);
  const result = await getPaymentsRegister(filters);

  return (
    <div className="space-y-4">
      <FailedCallout filters={filters} result={result} />

      <RegisterTotals result={result} />

      <SectionTabs filters={filters} counts={result.sectionCounts} />

      <SectionSummary filters={filters} result={result} />

      {result.payments.length === 0 ? (
        <SectionEmptyState section={filters.section} />
      ) : (
        <PaymentsTable filters={filters} result={result} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Failed payments — surfaced above everything, in every section
// ---------------------------------------------------------------------------

/**
 * A failed payment is the only outcome in the register where somebody has to
 * act: the money never reached the vendor and the bill is sitting approved and
 * unpaid. So it is announced above the tiles regardless of which section is
 * open, and the callout disappears the moment there is nothing to announce.
 */
function FailedCallout({
  filters,
  result,
}: {
  filters: PaymentFilters;
  result: PaymentsRegisterResult;
}) {
  const { failedCount, failedCents } = result.totals;
  if (failedCount === 0) return null;

  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>
        {failedCount === 1
          ? "A payment failed and the vendor was not paid"
          : `${failedCount} payments failed and those vendors were not paid`}
      </AlertTitle>
      <AlertDescription>
        <span>
          {formatCents(failedCents)} did not reach its vendor. The bills stay
          approved and payable, so a replacement payment can be scheduled from
          each one.
        </span>
        {filters.section === "failed" ? null : (
          <Button asChild variant="outline" size="sm" className="mt-1">
            <Link href={buildPaymentsHref(filters, { section: "failed" })}>
              Review failed payments
              <ChevronRight data-icon="inline-end" />
            </Link>
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

// ---------------------------------------------------------------------------
// Headline figures
// ---------------------------------------------------------------------------

const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  timeZone: "UTC",
});

/**
 * Four figures, deliberately not one balance.
 *
 * Scheduled money can still be stopped; in-flight money cannot; completed money
 * is history; failed money is work. Summing them would answer no question
 * anybody asks, so they are never summed.
 */
function RegisterTotals({ result }: { result: PaymentsRegisterResult }) {
  const { totals, today } = result;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Scheduled"
        value={formatCents(totals.scheduledCents)}
        icon={CalendarClock}
        tone={totals.overdueScheduledCount > 0 ? "warning" : "default"}
        hint={
          totals.scheduledCount === 0
            ? "Nothing committed to a date yet"
            : totals.overdueScheduledCount > 0
              ? `${countLabel(totals.scheduledCount, "payment")} · ${totals.overdueScheduledCount} past its send date`
              : `${countLabel(totals.scheduledCount, "payment")} · next ${
                  totals.nextScheduledDate
                    ? formatDayDistance(totals.nextScheduledDate, today)
                    : "—"
                }`
        }
      />
      <StatCard
        label="In flight"
        value={formatCents(totals.inFlightCents)}
        icon={Send}
        hint={
          totals.inFlightCount === 0
            ? "Nothing in transit"
            : `${countLabel(totals.inFlightCount, "payment")} sent, not yet landed`
        }
      />
      <StatCard
        label={`Paid in ${MONTH_FORMAT.format(today)}`}
        value={formatCents(totals.paidThisMonthCents)}
        icon={CheckCircle2}
        tone={totals.paidThisMonthCents > 0 ? "success" : "default"}
        hint={
          totals.paidThisMonthCount === 0
            ? "Nothing has settled this month"
            : `${countLabel(totals.paidThisMonthCount, "payment")} settled`
        }
      />
      <StatCard
        label="Failed"
        value={formatCents(totals.failedCents)}
        icon={CircleAlert}
        tone={totals.failedCount > 0 ? "danger" : "default"}
        hint={
          totals.failedCount === 0
            ? "Every payment has gone through"
            : `${countLabel(totals.failedCount, "vendor")} left unpaid — needs action`
        }
      />
    </div>
  );
}

function countLabel(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

// ---------------------------------------------------------------------------
// Sections — links, so the partition is part of the URL
// ---------------------------------------------------------------------------

function SectionTabs({
  filters,
  counts,
}: {
  filters: PaymentFilters;
  counts: Record<RegisterSection, number>;
}) {
  return (
    <nav
      aria-label="Payment status"
      className="bg-muted inline-flex w-full items-center gap-0.5 overflow-x-auto rounded-lg p-[3px] sm:w-fit"
    >
      {REGISTER_SECTIONS.map((section) => {
        const isActive = filters.section === section;
        const count = counts[section] ?? 0;
        const isFailed = section === "failed";

        return (
          <Link
            key={section}
            href={buildPaymentsHref(filters, { section })}
            scroll={false}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap transition-colors",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {REGISTER_SECTION_META[section].label}
            <span
              className={cn(
                "rounded-full px-1.5 py-px text-[11px] tabular-nums",
                isFailed && count > 0
                  ? "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300"
                  : isActive
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground",
              )}
            >
              {count}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Summary strip
// ---------------------------------------------------------------------------

function SectionSummary({
  filters,
  result,
}: {
  filters: PaymentFilters;
  result: PaymentsRegisterResult;
}) {
  const count = result.payments.length;
  const amounts = result.sectionTotals
    .map((entry) => formatCents(entry.totalCents, { currency: entry.currency }))
    .join(" + ");

  const pastDue =
    filters.section === "scheduled" ? result.totals.overdueScheduledCount : 0;

  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="tabular-nums">
        <span className="text-foreground font-medium">{count}</span>{" "}
        {count === 1 ? "payment" : "payments"}
      </span>
      {result.sectionTotals.length > 0 ? (
        <>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            <span className="text-foreground font-medium">{amounts}</span> total
          </span>
        </>
      ) : null}
      {pastDue > 0 ? (
        <>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1 text-amber-700 tabular-nums dark:text-amber-400">
            <TriangleAlert className="size-3" />
            {pastDue} past its send date
          </span>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

const COLUMN_COUNT = 6;

function PaymentsTable({
  filters,
  result,
}: {
  filters: PaymentFilters;
  result: PaymentsRegisterResult;
}) {
  const grouped = sectionGroupsByDate(filters.section);
  const groups = grouped
    ? groupPaymentsByScheduledDate(result.payments, result.today)
    : [];

  return (
    <div className="ring-foreground/10 overflow-hidden rounded-xl ring-1">
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-muted-foreground text-xs font-medium">
              Vendor
            </TableHead>
            <TableHead className="text-muted-foreground text-xs font-medium">
              Status
            </TableHead>
            <TableHead className="text-muted-foreground hidden text-xs font-medium lg:table-cell">
              Method
            </TableHead>
            <TableHead className="text-muted-foreground text-xs font-medium">
              Send date
            </TableHead>
            <TableHead className="text-muted-foreground text-right text-xs font-medium">
              Amount
            </TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {grouped
            ? groups.map((group, index) => (
                <DateGroup
                  key={group.key}
                  group={group}
                  showBand={index === 0 || groups[index - 1].band !== group.band}
                  today={result.today}
                />
              ))
            : result.payments.map((payment) => (
                <PaymentRow
                  key={payment.id}
                  payment={payment}
                  today={result.today}
                />
              ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * One calendar day of upcoming payments.
 *
 * Grouping by send date is what makes "this week" legible: the question a
 * treasurer asks is not "which payments exist" but "how much leaves on
 * Thursday", and that is a per-day subtotal, not a row.
 */
function DateGroup({
  group,
  showBand,
  today,
}: {
  group: PaymentDateGroup<RegisterPayment>;
  showBand: boolean;
  today: Date;
}) {
  return (
    <>
      {showBand ? (
        <TableRow className="hover:bg-transparent">
          <TableCell
            colSpan={COLUMN_COUNT}
            className={cn(
              "bg-muted/30 py-1.5 pl-3 text-[11px] font-semibold tracking-wide uppercase",
              group.band === "PAST_DUE"
                ? "text-amber-700 dark:text-amber-400"
                : "text-muted-foreground",
            )}
          >
            {group.bandLabel}
          </TableCell>
        </TableRow>
      ) : null}

      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={COLUMN_COUNT} className="py-1.5 pr-3 pl-3">
          <div className="text-muted-foreground flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
            <span>
              <span className="text-foreground font-medium tabular-nums">
                {formatDate(group.date)}
              </span>{" "}
              · {group.distanceLabel}
            </span>
            <span className="tabular-nums">
              {countLabel(group.count, "payment")} ·{" "}
              <span className="text-foreground font-medium">
                {formatCents(group.totalCents)}
              </span>
            </span>
          </div>
        </TableCell>
      </TableRow>

      {group.payments.map((payment) => (
        <PaymentRow key={payment.id} payment={payment} today={today} />
      ))}
    </>
  );
}

function PaymentRow({
  payment,
  today,
}: {
  payment: RegisterPayment;
  today: Date;
}) {
  const meta = PAYMENT_STATUS_META[payment.status];

  return (
    <TableRow className="group relative">
      <TableCell className="max-w-[22rem] py-2.5 pl-3">
        <Link
          href={`/bills/${payment.bill.id}`}
          className="font-medium after:absolute after:inset-0 after:content-['']"
        >
          <span className="block truncate">{payment.bill.vendor.name}</span>
        </Link>
        <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 font-mono text-[11px]">
          <span className="truncate">{payment.bill.billNumber}</span>
          {payment.reference ? (
            <span className="truncate opacity-70">{payment.reference}</span>
          ) : null}
        </span>
      </TableCell>

      <TableCell className="py-2.5">
        <Badge variant={meta.badgeVariant} className={meta.badgeClassName}>
          {meta.label}
        </Badge>
      </TableCell>

      <TableCell className="text-muted-foreground hidden py-2.5 text-xs whitespace-nowrap lg:table-cell">
        {PAYMENT_METHOD_LABELS[payment.method]}
      </TableCell>

      <TableCell className="py-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm whitespace-nowrap tabular-nums">
            {formatDate(payment.scheduledDate)}
          </span>
          <PaymentTiming payment={payment} today={today} />
        </div>
      </TableCell>

      <TableCell className="py-2.5 text-right font-medium tabular-nums">
        {formatCents(payment.amountCents, { currency: payment.bill.currency })}
      </TableCell>

      <TableCell className="pr-3">
        <ChevronRight className="text-muted-foreground/50 group-hover:text-muted-foreground size-4 transition-colors" />
      </TableCell>
    </TableRow>
  );
}

/**
 * The second line under the send date: days-until while a payment is still
 * coming, days-since once it has moved.
 *
 * A SCHEDULED payment whose send date has passed is tinted — that is a payment
 * nobody executed, which no status can express on its own. An INITIATED payment
 * keeps its original send date and is NOT late: it is in transit.
 */
function PaymentTiming({
  payment,
  today,
}: {
  payment: RegisterPayment;
  today: Date;
}): ReactNode {
  const muted = "text-muted-foreground text-[11px]";

  switch (payment.status) {
    case "SCHEDULED": {
      const late = payment.scheduledDate.getTime() < today.getTime();
      return (
        <span
          className={cn(
            late
              ? "inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 tabular-nums dark:text-amber-400"
              : muted,
          )}
        >
          {late ? <TriangleAlert className="size-3" /> : null}
          {formatDayDistance(payment.scheduledDate, today)}
        </span>
      );
    }
    case "INITIATED": {
      const sentOn = payment.initiatedAt ?? payment.scheduledDate;
      return (
        <span className={muted}>
          Sent {formatDayDistance(sentOn, today)}
        </span>
      );
    }
    case "PAID": {
      if (!payment.completedAt) {
        return <span className={muted}>Settled on an unrecorded date</span>;
      }
      return (
        <span className={muted}>
          Paid {formatShortDate(payment.completedAt)} ·{" "}
          {formatDayDistance(payment.completedAt, today)}
        </span>
      );
    }
    case "FAILED": {
      return (
        <span className="text-[11px] font-medium text-red-700 dark:text-red-400">
          Failed · {formatDayDistance(payment.scheduledDate, today)}
        </span>
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

function SectionEmptyState({ section }: { section: RegisterSection }) {
  const meta = REGISTER_SECTION_META[section];

  return (
    <EmptyState
      icon={section === "failed" ? CheckCircle2 : Banknote}
      title={meta.emptyTitle}
      description={meta.emptyDescription}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/bills?tab=approved">Approved bills</Link>
        </Button>
      }
    />
  );
}
