import Link from "next/link";
import type { User } from "@prisma/client";
import {
  ArrowRight,
  CalendarClock,
  FileWarning,
  TriangleAlert,
  Wallet,
} from "lucide-react";

import { AgingStrip } from "@/components/dashboard/aging-strip";
import { ApprovalQueueCard } from "@/components/dashboard/approval-queue";
import { DraftsPanel } from "@/components/dashboard/drafts-panel";
import { RecentActivityFeed } from "@/components/dashboard/recent-activity";
import { UpcomingPayments } from "@/components/dashboard/upcoming-payments";
import { StatCard } from "@/components/common/stat-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { getDashboardData } from "@/server/queries/dashboard";

export interface DashboardSummaryProps {
  currentUser: User;
}

/**
 * The landing page: the state of payables at a glance, for THIS user.
 *
 * Everything on it is derived from the seeded rows at request time — there is
 * no summary table, no cached total and no hardcoded figure anywhere, so the
 * numbers move as soon as a bill is approved or a payment is scheduled.
 *
 * The order is the order of the work: what is waiting on you, what is
 * incomplete, how old the balance is, what is about to leave the bank, what
 * just happened.
 */
export async function DashboardSummary({ currentUser }: DashboardSummaryProps) {
  const data = await getDashboardData(currentUser.id);
  const { outstanding, approvals } = data;

  const waitingOnMeCents = approvals.waitingOnMe.reduce(
    (total, row) => total + row.totalCents,
    0,
  );

  return (
    <div className="space-y-4">
      {approvals.waitingOnMe.length > 0 ? (
        <Alert className="border-amber-300 bg-amber-50 dark:border-amber-800/70 dark:bg-amber-950/40">
          <TriangleAlert className="text-amber-700 dark:text-amber-400" />
          <AlertTitle className="text-amber-900 dark:text-amber-200">
            {approvals.waitingOnMe.length}{" "}
            {approvals.waitingOnMe.length === 1 ? "bill is" : "bills are"}{" "}
            waiting on you — {formatCents(waitingOnMeCents)}
          </AlertTitle>
          <AlertDescription className="text-amber-800/90 dark:text-amber-300/90">
            Approval is sequential, so these are the steps that are actually
            yours to decide today. Everything else in the chain is waiting on
            somebody else.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Outstanding payables"
          value={formatCents(outstanding.totalCents, { compact: true })}
          icon={Wallet}
          hint={`${outstanding.count} unpaid bills · ${formatCents(outstanding.awaitingApprovalCents, { compact: true })} awaiting approval, ${formatCents(outstanding.approvedCents, { compact: true })} approved`}
        />
        <StatCard
          label={`Due in the next ${outstanding.dueSoonWindowDays} days`}
          value={formatCents(outstanding.dueSoonCents, { compact: true })}
          icon={CalendarClock}
          tone={outstanding.dueSoonCents > 0 ? "warning" : "default"}
          hint={
            outstanding.dueSoonCount > 0
              ? `${outstanding.dueSoonCount} ${outstanding.dueSoonCount === 1 ? "bill" : "bills"} through ${formatDate(data.dueSoonThrough)}`
              : "Nothing falls due this week"
          }
        />
        <StatCard
          label="Overdue"
          value={formatCents(outstanding.overdueCents, { compact: true })}
          icon={TriangleAlert}
          tone={outstanding.overdueCents > 0 ? "danger" : "success"}
          hint={
            outstanding.overdueCount > 0
              ? `${outstanding.overdueCount} ${outstanding.overdueCount === 1 ? "bill" : "bills"} · oldest ${outstanding.oldestOverdueDays} days past due`
              : "Everything is within terms"
          }
        />
        <StatCard
          label="Drafts missing info"
          value={data.drafts.length}
          icon={FileWarning}
          tone={data.drafts.length > 0 ? "warning" : "default"}
          hint={`of ${data.draftCount} ${data.draftCount === 1 ? "draft" : "drafts"} — cannot be submitted until fixed`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ApprovalQueueCard queue={approvals} userName={currentUser.name} />
        </div>
        <DraftsPanel drafts={data.drafts} draftCount={data.draftCount} />
      </div>

      <AgingStrip slices={data.aging} totalCents={outstanding.totalCents} />

      <div className="grid gap-4 lg:grid-cols-2">
        <UpcomingPayments
          payments={data.upcomingPayments}
          totalCents={data.upcomingPaymentsCents}
        />
        <RecentActivityFeed activity={data.activity} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="text-muted-foreground text-xs">
          Every figure is computed from the bills, payments and approval steps in
          the database when the page renders — nothing here is stored as a
          summary or hardcoded.
        </p>
        <Button size="sm" variant="outline" asChild>
          <Link href="/bills">
            Open the bills inbox
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
