import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  FileScan,
  FileSpreadsheet,
  Inbox,
  Mail,
  Plus,
  SearchX,
  TriangleAlert,
} from "lucide-react";

import { BillStatusBadge, DraftReadinessBadge } from "@/components/bills/bill-status-badge";
import { BillsInboxFilters } from "@/components/bills/bills-inbox-filters";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BILL_SORT_META,
  CLEARED_FILTERS,
  INBOX_TABS,
  INBOX_TAB_META,
  activeFilterChips,
  buildBillsHref,
  hasActiveFilters,
  nextSort,
  parseBillFilters,
  type BillFilters,
  type BillSortKey,
} from "@/lib/bill-filters";
import { daysOverdue, formatDate, formatDueDistance, todayUtc } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  OUTSTANDING_STATUSES,
  getBillsInbox,
  getInboxVendorOptions,
  inboxApprovalProgress,
  inboxBillReadiness,
  type InboxBill,
} from "@/server/queries/bills";

/**
 * The accounts payable inbox.
 *
 * A Server Component from top to bottom except for the filter bar: the tabs,
 * the sort headers and the pager are all plain links that rewrite the URL, and
 * `parseBillFilters` turns that URL back into the query. The upshot is that any
 * view a person is looking at can be pasted to a colleague, and none of the 45
 * rows are shipped to the browser as client state.
 *
 * Bulk selection is deliberately absent (ADR 0008 cut it).
 */

export interface BillsInboxProps {
  /** Route search params, forwarded so the phase can drive filters from the URL. */
  searchParams?: Record<string, string | string[] | undefined>;
}

/** Source badge — only shown when the bill did NOT arrive by hand. */
const SOURCE_META = {
  OCR: { label: "Scanned", icon: FileScan },
  CSV: { label: "CSV", icon: FileSpreadsheet },
  EMAIL: { label: "Emailed", icon: Mail },
} as const;

export async function BillsInbox({ searchParams = {} }: BillsInboxProps) {
  const filters = parseBillFilters(searchParams);

  const [result, vendors] = await Promise.all([
    getBillsInbox(filters),
    getInboxVendorOptions(),
  ]);

  const vendorNameById = Object.fromEntries(
    vendors.map((vendor) => [vendor.id, vendor.name]),
  );
  const chips = activeFilterChips(filters, {
    vendorNameById,
    formatAmount: (cents) => formatCents(cents),
    formatDate: (value) => formatDate(`${value}T00:00:00.000Z`),
  });

  const createdBillNumber =
    typeof searchParams.created === "string" ? searchParams.created : null;

  const asOf = todayUtc();
  const firstRow = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const lastRow = Math.min(result.page * result.pageSize, result.total);

  return (
    <div className="space-y-4">
      {createdBillNumber ? (
        <Alert>
          <CircleCheck className="text-emerald-600 dark:text-emerald-400" />
          <AlertTitle>Bill {createdBillNumber} created</AlertTitle>
          <AlertDescription>
            It is saved as a draft. Code the line items and submit it for
            approval when it is ready.
          </AlertDescription>
        </Alert>
      ) : null}

      <InboxTabs filters={filters} counts={result.tabCounts} />

      <BillsInboxFilters filters={filters} vendors={vendors} />

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <Link
              key={chip.id}
              href={buildBillsHref(filters, chip.removePatch)}
              scroll={false}
              className="border-input bg-muted/40 text-foreground hover:bg-muted inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors"
              title={`Remove the ${chip.group.toLowerCase()} filter`}
            >
              <span className="text-muted-foreground">{chip.group}</span>
              <span className="font-medium">{chip.value}</span>
              <span aria-hidden className="text-muted-foreground">
                ×
              </span>
              <span className="sr-only">Remove filter</span>
            </Link>
          ))}
        </div>
      ) : null}

      <ResultSummary result={result} />

      {result.bills.length === 0 ? (
        <InboxEmptyState filters={filters} />
      ) : (
        <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <SortableHead filters={filters} sortKey="vendor">
                  Vendor
                </SortableHead>
                <SortableHead filters={filters} sortKey="status">
                  Status
                </SortableHead>
                <TableHead className="text-muted-foreground hidden text-xs font-medium lg:table-cell">
                  Issued
                </TableHead>
                <SortableHead filters={filters} sortKey="dueDate">
                  Due
                </SortableHead>
                <SortableHead filters={filters} sortKey="amount" align="right">
                  Amount
                </SortableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.bills.map((bill) => (
                <BillRow
                  key={bill.id}
                  bill={bill}
                  asOf={asOf}
                  highlighted={bill.billNumber === createdBillNumber}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {result.pageCount > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs tabular-nums">
            Showing {firstRow}–{lastRow} of {result.total}
          </p>
          <div className="flex items-center gap-1.5">
            <PagerLink
              filters={filters}
              page={result.page - 1}
              disabled={result.page <= 1}
              label="Previous"
            />
            <span className="text-muted-foreground px-1 text-xs tabular-nums">
              Page {result.page} of {result.pageCount}
            </span>
            <PagerLink
              filters={filters}
              page={result.page + 1}
              disabled={result.page >= result.pageCount}
              label="Next"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs — links, so the partition is part of the URL
// ---------------------------------------------------------------------------

function InboxTabs({
  filters,
  counts,
}: {
  filters: BillFilters;
  counts: Record<string, number>;
}) {
  return (
    <nav
      aria-label="Bill status"
      className="bg-muted inline-flex w-full items-center gap-0.5 overflow-x-auto rounded-lg p-[3px] sm:w-fit"
    >
      {INBOX_TABS.map((tab) => {
        const isActive = filters.tab === tab;
        const count = counts[tab] ?? 0;

        return (
          <Link
            key={tab}
            href={buildBillsHref(filters, { tab })}
            scroll={false}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap transition-colors",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {INBOX_TAB_META[tab].label}
            <span
              className={cn(
                "rounded-full px-1.5 py-px text-[11px] tabular-nums",
                isActive
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

function ResultSummary({
  result,
}: {
  result: Awaited<ReturnType<typeof getBillsInbox>>;
}) {
  const amounts = result.totals
    .map((entry) => formatCents(entry.totalCents, { currency: entry.currency }))
    .join(" + ");

  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="tabular-nums">
        <span className="text-foreground font-medium">{result.total}</span>{" "}
        {result.total === 1 ? "bill" : "bills"}
      </span>
      {result.totals.length > 0 ? (
        <>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            <span className="text-foreground font-medium">{amounts}</span> total
          </span>
        </>
      ) : null}
      {result.overdueCount > 0 ? (
        <>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1 text-red-700 tabular-nums dark:text-red-400">
            <TriangleAlert className="size-3" />
            {result.overdueCount} overdue
          </span>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable column header
// ---------------------------------------------------------------------------

function SortableHead({
  filters,
  sortKey,
  align = "left",
  children,
}: {
  filters: BillFilters;
  sortKey: BillSortKey;
  align?: "left" | "right";
  children: ReactNode;
}) {
  const isActive = filters.sort === sortKey;
  const patch = nextSort(filters, sortKey);
  const Icon = !isActive
    ? ArrowUpDown
    : filters.direction === "asc"
      ? ArrowUp
      : ArrowDown;

  return (
    <TableHead
      className={cn("text-xs font-medium", align === "right" && "text-right")}
      aria-sort={
        isActive
          ? filters.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <Link
        href={buildBillsHref(filters, patch)}
        scroll={false}
        className={cn(
          "hover:text-foreground inline-flex items-center gap-1 transition-colors",
          isActive ? "text-foreground" : "text-muted-foreground",
          align === "right" && "flex-row-reverse",
        )}
        title={`Sort by ${BILL_SORT_META[sortKey].label.toLowerCase()}`}
      >
        {children}
        <Icon className="size-3" />
      </Link>
    </TableHead>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function BillRow({
  bill,
  asOf,
  highlighted,
}: {
  bill: InboxBill;
  asOf: Date;
  highlighted: boolean;
}) {
  const source = bill.source === "MANUAL" ? null : SOURCE_META[bill.source];
  const SourceIcon = source?.icon;

  return (
    <TableRow
      className={cn(
        "group relative",
        highlighted && "bg-emerald-50/70 dark:bg-emerald-950/30",
      )}
    >
      <TableCell className="max-w-[22rem] py-2.5 pl-3">
        <Link
          href={`/bills/${bill.id}`}
          className="font-medium after:absolute after:inset-0 after:content-['']"
        >
          <span className="block truncate">{bill.vendor.name}</span>
        </Link>
        <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 font-mono text-[11px]">
          <span className="truncate">{bill.billNumber}</span>
          {source && SourceIcon ? (
            <Badge
              variant="outline"
              className="text-muted-foreground h-4 gap-1 px-1 font-sans text-[10px]"
              title={`Ingested from ${source.label.toLowerCase()}`}
            >
              <SourceIcon className="size-2.5" />
              {source.label}
            </Badge>
          ) : null}
        </span>
      </TableCell>

      <TableCell className="py-2.5">
        <StatusCell bill={bill} />
      </TableCell>

      <TableCell className="text-muted-foreground hidden py-2.5 text-xs whitespace-nowrap lg:table-cell">
        {formatDate(bill.issueDate)}
      </TableCell>

      <TableCell className="py-2.5">
        <DueCell bill={bill} asOf={asOf} />
      </TableCell>

      <TableCell className="py-2.5 text-right font-medium tabular-nums">
        {formatCents(bill.totalCents, { currency: bill.currency })}
      </TableCell>

      <TableCell className="pr-3">
        <ChevronRight className="text-muted-foreground/50 group-hover:text-muted-foreground size-4 transition-colors" />
      </TableCell>
    </TableRow>
  );
}

function StatusCell({ bill }: { bill: InboxBill }) {
  if (bill.status === "DRAFT") {
    // `Missing info` / `Ready` are DERIVED — computed here, never stored.
    const readiness = inboxBillReadiness(bill);
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <BillStatusBadge status={bill.status} />
        <DraftReadinessBadge
          readiness={readiness.state}
          issues={readiness.issues}
        />
      </div>
    );
  }

  if (bill.status === "AWAITING_APPROVAL") {
    const progress = inboxApprovalProgress(bill);
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <BillStatusBadge status={bill.status} />
        {progress.total > 0 ? (
          <span className="text-muted-foreground text-[11px] tabular-nums">
            {progress.approved} of {progress.total} approved
          </span>
        ) : null}
      </div>
    );
  }

  return <BillStatusBadge status={bill.status} />;
}

function DueCell({ bill, asOf }: { bill: InboxBill; asOf: Date }) {
  const isOutstanding = OUTSTANDING_STATUSES.includes(bill.status);
  const overdueDays = daysOverdue(bill.dueDate, asOf);
  const payment = bill.payments[0];

  let footnote: ReactNode = null;

  if (isOutstanding && overdueDays > 0) {
    footnote = (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 tabular-nums dark:text-red-400">
        <TriangleAlert className="size-3" />
        {overdueDays} {overdueDays === 1 ? "day" : "days"} overdue
      </span>
    );
  } else if (isOutstanding) {
    footnote = (
      <span className="text-muted-foreground text-[11px]">
        {formatDueDistance(bill.dueDate, asOf)}
      </span>
    );
  } else if (bill.status === "PAID" && payment?.completedAt) {
    footnote = (
      <span className="text-muted-foreground text-[11px]">
        Paid {formatDate(payment.completedAt)}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm whitespace-nowrap tabular-nums">
        {formatDate(bill.dueDate)}
      </span>
      {footnote}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty states and pager
// ---------------------------------------------------------------------------

function InboxEmptyState({ filters }: { filters: BillFilters }) {
  if (hasActiveFilters(filters)) {
    return (
      <EmptyState
        icon={SearchX}
        title="No bills match these filters"
        description="Widen the date or amount range, or clear the filters to see the whole tab."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href={buildBillsHref(filters, CLEARED_FILTERS)} scroll={false}>
              Clear filters
            </Link>
          </Button>
        }
      />
    );
  }

  const meta = INBOX_TAB_META[filters.tab];

  return (
    <EmptyState
      icon={Inbox}
      title={meta.emptyTitle}
      description={meta.emptyDescription}
      action={
        filters.tab === "drafts" || filters.tab === "all" ? (
          <Button asChild size="sm">
            <Link href="/bills/new">
              <Plus data-icon="inline-start" />
              New bill
            </Link>
          </Button>
        ) : null
      }
    />
  );
}

function PagerLink({
  filters,
  page,
  disabled,
  label,
}: {
  filters: BillFilters;
  page: number;
  disabled: boolean;
  label: "Previous" | "Next";
}) {
  const Icon = label === "Previous" ? ChevronLeft : ChevronRight;

  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled>
        {label === "Previous" ? <Icon data-icon="inline-start" /> : null}
        {label}
        {label === "Next" ? <Icon data-icon="inline-end" /> : null}
      </Button>
    );
  }

  return (
    <Button asChild variant="outline" size="sm">
      <Link href={buildBillsHref(filters, { page })} scroll={false}>
        {label === "Previous" ? <Icon data-icon="inline-start" /> : null}
        {label}
        {label === "Next" ? <Icon data-icon="inline-end" /> : null}
      </Link>
    </Button>
  );
}
