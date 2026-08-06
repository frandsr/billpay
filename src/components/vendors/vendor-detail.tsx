import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  Building2,
  CircleAlert,
  CreditCard,
  Mail,
  MapPin,
  Receipt,
  Repeat,
  Wallet,
} from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { StatCard } from "@/components/common/stat-card";
import {
  MaskedBankDetails,
  PaymentRailsList,
} from "@/components/vendors/payment-details";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BILL_STATUS_META, PAYMENT_STATUS_META } from "@/lib/bill-status";
import {
  PAYMENT_TERMS_LABELS,
  formatDate,
  formatDueDistance,
  isOverdue,
  todayUtc,
} from "@/lib/dates";
import { RECURRING_FREQUENCY_LABELS } from "@/lib/recurring";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  rollUpVendorSpend,
  vendorPaymentReadiness,
} from "@/components/vendors/rollups";
import { getVendorDetail, type VendorDetailBill } from "@/server/queries/vendors";

export interface VendorDetailViewProps {
  vendorId: string;
}

/**
 * One vendor: who they are, how they get paid, and everything we have billed
 * with them.
 *
 * Read-only on purpose. Editing a vendor is a form and a server action that
 * nothing else in the demo depends on; the payable story — can we pay them,
 * what do we owe them, what has happened — is the part a reviewer needs, and it
 * is worth doing properly rather than half-doing both.
 *
 * The roll-up is the SAME pure function the list uses, so a vendor's row and
 * its page can never quote different balances.
 */
export async function VendorDetailView({ vendorId }: VendorDetailViewProps) {
  const vendor = await getVendorDetail(vendorId);
  if (!vendor) notFound();

  const today = todayUtc();
  const readiness = vendorPaymentReadiness(vendor);
  const spend = rollUpVendorSpend(vendor.bills, today);
  const missingTaxId = vendor.is1099 && !vendor.taxId?.trim();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="ghost" asChild>
          <Link href="/vendors">
            <ArrowLeft data-icon="inline-start" />
            All vendors
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-1.5">
          {vendor.is1099 ? (
            <Badge
              variant="outline"
              className={cn(
                missingTaxId &&
                  "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/60 dark:text-amber-300",
              )}
            >
              1099 {vendor.taxId ? `· ${vendor.taxId}` : "· no tax ID"}
            </Badge>
          ) : null}
          {vendor.status === "ARCHIVED" ? (
            <Badge
              variant="outline"
              className="border-neutral-300 bg-neutral-100 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400"
            >
              Archived
            </Badge>
          ) : null}
        </div>
      </div>

      {readiness.unpayable ? (
        <Alert className="border-red-300 bg-red-50 dark:border-red-800/70 dark:bg-red-950/40">
          <CircleAlert className="text-red-700 dark:text-red-400" />
          <AlertTitle className="text-red-900 dark:text-red-200">
            {vendor.name} cannot be paid yet
          </AlertTitle>
          <AlertDescription className="text-red-800/90 dark:text-red-300/90">
            No payment rail is usable — missing {readiness.missing.join(", ")}.
            Any approved bill for this vendor will sit unpaid until the details
            are on file.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Bills"
          value={spend.billCount}
          icon={Receipt}
          hint={`${spend.paidCount} paid · ${spend.draftCount} draft`}
        />
        <StatCard
          label="Total spend"
          value={formatCents(spend.totalSpentCents, { compact: true })}
          hint="Bills that have been paid"
        />
        <StatCard
          label="Outstanding"
          value={formatCents(spend.outstandingCents, { compact: true })}
          icon={Wallet}
          hint={`${spend.outstandingCount} unpaid ${spend.outstandingCount === 1 ? "bill" : "bills"}`}
        />
        <StatCard
          label="Overdue"
          value={formatCents(spend.overdueCents, { compact: true })}
          tone={spend.overdueCents > 0 ? "danger" : "success"}
          hint={
            spend.overdueCount > 0
              ? `${spend.overdueCount} past the due date`
              : "Nothing past due"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Building2 className="text-muted-foreground size-4" />
              {vendor.name}
            </CardTitle>
            <CardAction>
              <span className="text-muted-foreground text-xs">
                Vendor since {formatDate(vendor.createdAt)}
              </span>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              <Fact label="Payment terms">
                {PAYMENT_TERMS_LABELS[vendor.defaultPaymentTerms]}
              </Fact>
              <Fact label="Default GL account">
                {vendor.defaultGlAccount ? (
                  <span className="tabular-nums">
                    {vendor.defaultGlAccount.code} · {vendor.defaultGlAccount.name}
                  </span>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </Fact>
              <Fact label="Email">
                {vendor.email ? (
                  <span className="flex items-center gap-1.5">
                    <Mail className="text-muted-foreground size-3.5" />
                    {vendor.email}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not on file</span>
                )}
              </Fact>
              <Fact label="Tax ID">
                {vendor.taxId ?? (
                  <span className="text-muted-foreground">Not on file</span>
                )}
              </Fact>
            </dl>

            <div className="space-y-1 border-t pt-3">
              <p className="text-muted-foreground text-[11px] font-medium">
                Remittance address
              </p>
              {vendor.addressLine1 ? (
                <address className="flex items-start gap-1.5 text-xs not-italic">
                  <MapPin className="text-muted-foreground mt-px size-3.5 shrink-0" />
                  <span>
                    {vendor.addressLine1}
                    {vendor.addressLine2 ? `, ${vendor.addressLine2}` : ""}
                    <br />
                    {[vendor.city, vendor.state, vendor.postalCode]
                      .filter(Boolean)
                      .join(", ")}
                    {vendor.country ? ` · ${vendor.country}` : ""}
                  </span>
                </address>
              ) : (
                <p className="text-muted-foreground text-xs">
                  No address on file — a paper check cannot be mailed.
                </p>
              )}
            </div>

            {vendor.notes ? (
              <p className="text-muted-foreground border-t pt-3 text-xs">
                {vendor.notes}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="text-muted-foreground size-4" />
              Payment details
            </CardTitle>
            <CardAction>
              <span className="text-muted-foreground text-xs">
                {readiness.available.length} of{" "}
                {readiness.available.length + readiness.blocked.length} rails
                ready
              </span>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            <MaskedBankDetails
              bankName={vendor.bankName}
              accountLast4={vendor.accountLast4}
              routingLast4={vendor.routingLast4}
            />

            <div className="space-y-2 border-t pt-3">
              <p className="text-muted-foreground text-[11px] font-medium">
                Payment rails
              </p>
              <PaymentRailsList readiness={readiness} />
            </div>

            <p className="text-muted-foreground border-t pt-3 text-[11px]">
              Only the last four digits are stored, and they are always rendered
              masked. These are demo values — no real bank credentials live in
              this database.
            </p>
          </CardContent>
        </Card>
      </div>

      {vendor.recurringBills.length > 0 ? (
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Repeat className="text-muted-foreground size-4" />
              Recurring templates
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {vendor.recurringBills.map((template) => (
                <li
                  key={template.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/recurring/${template.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {template.name}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {RECURRING_FREQUENCY_LABELS[template.frequency]} · next run{" "}
                      {formatDate(template.nextRunDate)}
                      {template.active ? "" : " · paused"}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatCents(template.amountCents, {
                      currency: template.currency,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Receipt className="text-muted-foreground size-4" />
            Bill history
          </CardTitle>
          <CardAction>
            <span className="text-muted-foreground text-xs">
              {vendor.bills.length} {vendor.bills.length === 1 ? "bill" : "bills"}
            </span>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          {vendor.bills.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No bills yet"
              description="Nothing has been billed by this vendor."
              className="mx-4 py-8"
            />
          ) : (
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-muted-foreground pl-4 text-xs font-medium">
                    Bill
                  </TableHead>
                  <TableHead className="text-muted-foreground text-xs font-medium">
                    Status
                  </TableHead>
                  <TableHead className="text-muted-foreground hidden text-xs font-medium lg:table-cell">
                    Issued
                  </TableHead>
                  <TableHead className="text-muted-foreground text-xs font-medium">
                    Due
                  </TableHead>
                  <TableHead className="text-muted-foreground pr-4 text-right text-xs font-medium">
                    Amount
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendor.bills.map((bill) => (
                  <BillRow key={bill.id} bill={bill} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BillRow({ bill }: { bill: VendorDetailBill }) {
  const meta = BILL_STATUS_META[bill.status];
  // FAILED attempts are history, not the live payment — the same rule the
  // payment panel applies when it decides what a bill's settlement looks like.
  const livePayment =
    [...bill.payments].reverse().find((payment) => payment.status !== "FAILED") ??
    null;
  const unpaid = bill.status === "AWAITING_APPROVAL" || bill.status === "APPROVED";
  const late = unpaid && isOverdue(bill.dueDate);

  return (
    <TableRow>
      <TableCell className="py-2.5 pl-4">
        <Link
          href={`/bills/${bill.id}`}
          className="text-sm font-medium hover:underline"
        >
          {bill.billNumber}
        </Link>
        {livePayment ? (
          <p className="text-muted-foreground text-xs">
            Payment {PAYMENT_STATUS_META[livePayment.status].label.toLowerCase()}{" "}
            · {formatDate(livePayment.scheduledDate)}
          </p>
        ) : null}
      </TableCell>

      <TableCell>
        <Badge variant={meta.badgeVariant} className={meta.badgeClassName}>
          {meta.label}
        </Badge>
      </TableCell>

      <TableCell className="hidden text-xs tabular-nums lg:table-cell">
        {formatDate(bill.issueDate)}
      </TableCell>

      <TableCell>
        <span className="text-xs tabular-nums">{formatDate(bill.dueDate)}</span>
        {late ? (
          <p className="text-xs font-medium text-red-700 dark:text-red-400">
            {formatDueDistance(bill.dueDate)}
          </p>
        ) : null}
      </TableCell>

      <TableCell className="pr-4 text-right text-sm font-medium tabular-nums">
        {formatCents(bill.totalCents, { currency: bill.currency })}
      </TableCell>
    </TableRow>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground text-[11px] font-medium">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
