import Link from "next/link";
import { CalendarClock } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { PAYMENT_METHOD_LABELS } from "@/lib/payment-lifecycle";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PAYMENT_STATUS_META } from "@/lib/bill-status";
import { formatDate, daysUntilDue, todayUtc } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import type { UpcomingPayment } from "@/server/queries/dashboard";

export interface UpcomingPaymentsProps {
  payments: UpcomingPayment[];
  totalCents: number;
}

/**
 * Money already committed to a date, grouped by that date.
 *
 * The Payment is a separate entity with its own lifecycle (ADR 0002), so this
 * panel shows PAYMENT statuses — Scheduled, Initiated — and never borrows the
 * bill's. There is no `Scheduled` bill status to borrow.
 */
export function UpcomingPayments({ payments, totalCents }: UpcomingPaymentsProps) {
  const today = todayUtc();
  const groups = groupByScheduledDate(payments);

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="text-muted-foreground size-4" />
          Upcoming payments
        </CardTitle>
        <CardAction>
          <span className="text-muted-foreground text-xs tabular-nums">
            {formatCents(totalCents)} committed
          </span>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        {payments.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No payments scheduled"
            description="Approved bills can be scheduled from the bill's payment panel."
            className="py-8"
          />
        ) : (
          groups.map((group) => {
            const days = daysUntilDue(group.date, today);
            return (
              <div key={group.key} className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-medium tabular-nums">
                    {formatDate(group.date)}
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      ·{" "}
                      {days === 0
                        ? "today"
                        : days > 0
                          ? `in ${days} ${days === 1 ? "day" : "days"}`
                          : `${-days} ${days === -1 ? "day" : "days"} ago`}
                    </span>
                  </p>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {formatCents(group.amountCents, { compact: true })}
                  </p>
                </div>
                <ul className="divide-y">
                  {group.payments.map((payment) => {
                    const meta = PAYMENT_STATUS_META[payment.status];
                    return (
                      <li
                        key={payment.id}
                        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/bills/${payment.bill.id}`}
                            className="text-sm font-medium hover:underline"
                          >
                            {payment.bill.vendor.name}
                            <span className="text-muted-foreground font-normal">
                              {" "}
                              · {payment.bill.billNumber}
                            </span>
                          </Link>
                          <p className="text-muted-foreground text-xs">
                            {PAYMENT_METHOD_LABELS[payment.method]}
                            {payment.reference ? ` · ${payment.reference}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={meta.badgeVariant}
                            className={meta.badgeClassName}
                          >
                            {meta.label}
                          </Badge>
                          <span className="text-sm font-semibold tabular-nums">
                            {formatCents(payment.amountCents, {
                              currency: payment.bill.currency,
                            })}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}

        {payments.length > 0 ? (
          <p className="text-muted-foreground border-t pt-3 text-xs">
            An <span className="text-foreground font-medium">Initiated</span>{" "}
            payment is already in transit, so it stays here — with its original
            send date — until it settles or fails.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface PaymentDateGroup {
  key: string;
  date: Date;
  amountCents: number;
  payments: UpcomingPayment[];
}

/**
 * Group payments by their scheduled day, preserving the query's date order.
 *
 * Grouping is what turns a list into a plan: "Aug 13 — $9,145" is a cash-flow
 * statement, six separate rows are not.
 */
function groupByScheduledDate(
  payments: readonly UpcomingPayment[],
): PaymentDateGroup[] {
  const groups = new Map<string, PaymentDateGroup>();

  for (const payment of payments) {
    const key = payment.scheduledDate.toISOString().slice(0, 10);
    const group = groups.get(key) ?? {
      key,
      date: payment.scheduledDate,
      amountCents: 0,
      payments: [],
    };
    group.amountCents += payment.amountCents;
    group.payments.push(payment);
    groups.set(key, group);
  }

  return [...groups.values()];
}
