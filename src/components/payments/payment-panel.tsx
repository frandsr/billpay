import type { User } from "@prisma/client";
import { Banknote, CircleAlert, Info, Landmark } from "lucide-react";

import {
  PaymentExecutionActions,
  SchedulePaymentForm,
  type PaymentMethodOption,
} from "@/components/payments/payment-actions";
import {
  PAYMENT_METHOD_HINTS,
  PAYMENT_METHOD_LABELS,
  isPaymentSettled,
  missingVendorPaymentDetails,
} from "@/components/payments/payment-lifecycle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BILL_STATUS_META, PAYMENT_STATUS_META } from "@/lib/bill-status";
import { formatDate, toDateInputValue, todayUtc } from "@/lib/dates";
import { PAYMENT_METHODS } from "@/lib/domain";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { BillDetail, BillDetailPayment } from "@/server/bill-detail";

/**
 * Payment execution — a lifecycle of its own, shown as one.
 *
 * The Bill and the Payment are separate entities (ADR 0002), so this panel
 * never borrows the bill's status: it shows the PAYMENT's status, method,
 * dates and reference on their own terms, with a strip that names both states
 * side by side. There is no `Scheduled` bill status anywhere in this file —
 * a scheduled payment is an APPROVED bill that owns a SCHEDULED payment.
 *
 * One full payment per bill. The relation is 1:N so partial payments stay an
 * additive change; the application is what constrains it, here and in
 * `src/server/actions/payments.ts`. A FAILED payment is the exception — it
 * settles nothing, so it does not block a replacement.
 */
export interface PaymentPanelProps {
  bill: BillDetail;
  currentUser: User;
}

export function PaymentPanel({ bill, currentUser }: PaymentPanelProps) {
  const payments = bill.payments;
  // The payment that currently represents this bill's settlement. FAILED
  // attempts are history, not the live payment.
  const livePayment =
    [...payments]
      .reverse()
      .find((payment) => payment.status !== "FAILED") ?? null;
  const failedPayments = payments.filter(
    (payment) => payment.status === "FAILED",
  );

  const canSchedule = bill.status === "APPROVED" && livePayment === null;

  const methodOptions: PaymentMethodOption[] = PAYMENT_METHODS.map((method) => ({
    method,
    label: PAYMENT_METHOD_LABELS[method],
    hint: PAYMENT_METHOD_HINTS[method],
    blockedReason:
      missingVendorPaymentDetails(bill.vendor, method)?.message ?? null,
  }));
  const everyMethodBlocked = methodOptions.every(
    (option) => option.blockedReason !== null,
  );

  const today = todayUtc();
  const defaultDate = toDateInputValue(
    bill.dueDate > today ? bill.dueDate : today,
  );

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <Banknote className="text-muted-foreground size-4" />
          Payment
        </CardTitle>
        {livePayment ? (
          <CardAction>
            <Badge
              variant={PAYMENT_STATUS_META[livePayment.status].badgeVariant}
              className={PAYMENT_STATUS_META[livePayment.status].badgeClassName}
            >
              {PAYMENT_STATUS_META[livePayment.status].label}
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Two lifecycles, named separately so they never read as one. */}
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span>
            Bill:{" "}
            <span className="text-foreground font-medium">
              {BILL_STATUS_META[bill.status].label}
            </span>
          </span>
          <span aria-hidden>·</span>
          <span>
            Payment:{" "}
            <span className="text-foreground font-medium">
              {livePayment
                ? PAYMENT_STATUS_META[livePayment.status].label
                : "None yet"}
            </span>
          </span>
        </div>

        {livePayment ? (
          <PaymentRecord payment={livePayment} currency={bill.currency} />
        ) : null}

        {livePayment && !isPaymentSettled(livePayment.status) ? (
          <div className="space-y-2">
            <PaymentExecutionActions
              paymentId={livePayment.id}
              status={livePayment.status}
            />
            <p className="text-muted-foreground text-xs">
              Completing the payment is what moves the bill to Paid — no other
              action does. Marking it failed leaves the bill approved and
              payable.
            </p>
          </div>
        ) : null}

        {livePayment?.status === "PAID" ? (
          <p className="text-muted-foreground text-sm">
            Settled in full on{" "}
            {livePayment.completedAt
              ? formatDate(livePayment.completedAt)
              : "an unrecorded date"}
            . The bill moved to Paid with it.
          </p>
        ) : null}

        {canSchedule ? (
          everyMethodBlocked ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>
                {bill.vendor.name} has no payment details on file
              </AlertTitle>
              <AlertDescription>
                No payment method can be used for this vendor yet. Add bank
                details for ACH or a wire, a remittance address for a check, or
                an email address for a virtual card, then schedule the payment.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              <VendorPaymentDetails vendor={bill.vendor} />
              <SchedulePaymentForm
                billId={bill.id}
                options={methodOptions}
                defaultDate={defaultDate}
                minDate={toDateInputValue(today)}
              />
              <p className="text-muted-foreground text-xs">
                {formatCents(bill.totalCents, { currency: bill.currency })} in
                full, recorded against {currentUser.name}. The send date
                defaults to the bill&apos;s due date.
              </p>
            </div>
          )
        ) : null}

        {!livePayment && bill.status !== "APPROVED" ? (
          <Alert>
            <Info />
            <AlertTitle>
              {bill.status === "REJECTED" || bill.status === "ARCHIVED"
                ? "This bill will not be paid"
                : "Not payable yet"}
            </AlertTitle>
            <AlertDescription>
              {bill.status === "REJECTED"
                ? "A rejected bill has to go back to draft and clear approval before a payment can be scheduled."
                : bill.status === "ARCHIVED"
                  ? "An archived bill left the flow without being paid."
                  : `A payment can only be scheduled once the bill is approved — it is ${BILL_STATUS_META[bill.status].label.toLowerCase()}.`}
            </AlertDescription>
          </Alert>
        ) : null}

        {failedPayments.length > 0 ? (
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Failed attempts
            </p>
            <ul className="space-y-1">
              {failedPayments.map((payment) => (
                <li
                  key={payment.id}
                  className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs"
                >
                  <Badge
                    variant={PAYMENT_STATUS_META.FAILED.badgeVariant}
                    className={PAYMENT_STATUS_META.FAILED.badgeClassName}
                  >
                    Failed
                  </Badge>
                  <span>
                    {PAYMENT_METHOD_LABELS[payment.method]} ·{" "}
                    {formatCents(payment.amountCents, {
                      currency: bill.currency,
                    })}{" "}
                    · scheduled {formatDate(payment.scheduledDate)}
                    {payment.reference ? ` · ${payment.reference}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-xs">
              The reason is in the activity feed.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The payment record itself
// ---------------------------------------------------------------------------

function PaymentRecord({
  payment,
  currency,
}: {
  payment: BillDetailPayment;
  currency: string;
}) {
  const rows: Array<{ label: string; value: string }> = [
    {
      label: "Amount",
      value: formatCents(payment.amountCents, { currency }),
    },
    { label: "Method", value: PAYMENT_METHOD_LABELS[payment.method] },
    { label: "Send date", value: formatDate(payment.scheduledDate) },
    {
      label: "Initiated",
      value: payment.initiatedAt ? formatDate(payment.initiatedAt) : "—",
    },
    {
      label: "Completed",
      value: payment.completedAt ? formatDate(payment.completedAt) : "—",
    },
    { label: "Reference", value: payment.reference ?? "—" },
  ];

  return (
    <dl className="bg-muted/30 grid gap-x-4 gap-y-2 rounded-lg border p-3 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground text-xs">{row.label}</dt>
          <dd
            className={cn(
              "text-sm font-medium",
              row.label === "Reference" && "font-mono text-xs",
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function VendorPaymentDetails({ vendor }: { vendor: BillDetail["vendor"] }) {
  const bank = [vendor.bankName, vendor.accountLast4 ? `••${vendor.accountLast4}` : null]
    .filter(Boolean)
    .join(" ");

  if (!bank) return null;

  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <Landmark className="size-3.5" />
      Paying {vendor.name} · {bank}
    </p>
  );
}
