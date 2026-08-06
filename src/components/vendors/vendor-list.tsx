import Link from "next/link";
import { Building2, CircleAlert, Receipt, TriangleAlert, Wallet } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { StatCard } from "@/components/common/stat-card";
import { PaymentDetailsBadge } from "@/components/vendors/payment-details";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PAYMENT_TERMS_LABELS } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { summariseVendors } from "@/components/vendors/rollups";
import { listVendors } from "@/server/queries/vendors";

/**
 * Every supplier, with the two things that make the page worth opening: what we
 * owe them, and whether we can actually pay them.
 *
 * Reads its own data server-side and takes no props — the route is a shell.
 * Vendors that no payment rail can reach sort to the top, because an approved
 * bill for such a vendor cannot be settled at all: that is a blocker, not a
 * cosmetic gap in a directory.
 */
export async function VendorList() {
  const vendors = await listVendors();
  const totals = summariseVendors(vendors);

  if (vendors.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="No vendors yet"
        description="Vendors arrive with the seed data, or with the first bill created for a new supplier."
      />
    );
  }

  return (
    <div className="space-y-4">
      {totals.unpayableCount > 0 ? (
        <Alert className="border-red-300 bg-red-50 dark:border-red-800/70 dark:bg-red-950/40">
          <CircleAlert className="text-red-700 dark:text-red-400" />
          <AlertTitle className="text-red-900 dark:text-red-200">
            {totals.unpayableCount}{" "}
            {totals.unpayableCount === 1 ? "vendor has" : "vendors have"} no
            usable payment details
          </AlertTitle>
          <AlertDescription className="text-red-800/90 dark:text-red-300/90">
            No payment rail can reach them, so an approved bill for these
            vendors cannot be scheduled until bank details, a remittance address
            or an email are on file.
          </AlertDescription>
        </Alert>
      ) : null}

      {totals.missingTaxIdCount > 0 ? (
        <Alert className="border-amber-300 bg-amber-50 dark:border-amber-800/70 dark:bg-amber-950/40">
          <TriangleAlert className="text-amber-700 dark:text-amber-400" />
          <AlertTitle className="text-amber-900 dark:text-amber-200">
            {totals.missingTaxIdCount} 1099{" "}
            {totals.missingTaxIdCount === 1 ? "vendor is" : "vendors are"}{" "}
            missing a tax ID
          </AlertTitle>
          <AlertDescription className="text-amber-800/90 dark:text-amber-300/90">
            A 1099 vendor without a tax ID becomes a January problem. It is
            cheaper to chase it now.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Vendors"
          value={totals.vendorCount}
          icon={Building2}
          hint={`${totals.activeCount} active · ${totals.is1099Count} flagged 1099`}
        />
        <StatCard
          label="Payment details"
          value={
            totals.unpayableCount === 0
              ? "All on file"
              : `${totals.unpayableCount} missing`
          }
          tone={totals.unpayableCount > 0 ? "danger" : "success"}
          hint={
            totals.partialDetailsCount > 0
              ? `${totals.partialDetailsCount} payable by some rails only`
              : "Every vendor can be paid by every rail"
          }
        />
        <StatCard
          label="Outstanding with vendors"
          value={formatCents(totals.outstandingCents, { compact: true })}
          icon={Wallet}
          hint={
            totals.overdueCents > 0
              ? `${formatCents(totals.overdueCents, { compact: true })} of it overdue`
              : "Nothing overdue"
          }
        />
        <StatCard
          label="Paid to date"
          value={formatCents(totals.totalSpentCents, { compact: true })}
          icon={Receipt}
          hint="Total of every bill that has been paid"
        />
      </div>

      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-muted-foreground text-xs font-medium">
                Vendor
              </TableHead>
              <TableHead className="text-muted-foreground hidden text-xs font-medium lg:table-cell">
                Terms
              </TableHead>
              <TableHead className="text-muted-foreground text-xs font-medium">
                Payment details
              </TableHead>
              <TableHead className="text-muted-foreground hidden text-right text-xs font-medium sm:table-cell">
                Bills
              </TableHead>
              <TableHead className="text-muted-foreground hidden text-right text-xs font-medium md:table-cell">
                Total spend
              </TableHead>
              <TableHead className="text-muted-foreground text-right text-xs font-medium">
                Outstanding
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vendors.map((vendor) => (
              <TableRow key={vendor.id}>
                <TableCell className="py-2.5">
                  <div className="space-y-0.5">
                    <Link
                      href={`/vendors/${vendor.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {vendor.name}
                    </Link>
                    <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
                      {vendor.email ?? "No email on file"}
                      {vendor.is1099 ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            "h-4 px-1.5 text-[10px]",
                            vendor.missingTaxId &&
                              "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/60 dark:text-amber-300",
                          )}
                          title={
                            vendor.missingTaxId
                              ? "1099 vendor with no tax ID on file"
                              : `Tax ID ${vendor.taxId}`
                          }
                        >
                          1099
                        </Badge>
                      ) : null}
                    </p>
                  </div>
                </TableCell>

                <TableCell className="hidden lg:table-cell">
                  <span className="text-xs">
                    {PAYMENT_TERMS_LABELS[vendor.defaultPaymentTerms]}
                  </span>
                </TableCell>

                <TableCell>
                  <PaymentDetailsBadge
                    readiness={vendor.readiness}
                    accountLast4={vendor.accountLast4}
                    bankName={vendor.bankName}
                  />
                </TableCell>

                <TableCell className="hidden text-right tabular-nums sm:table-cell">
                  <span className="text-sm">{vendor.spend.billCount}</span>
                  {vendor.spend.draftCount > 0 ? (
                    <span className="text-muted-foreground text-xs">
                      {" "}
                      · {vendor.spend.draftCount} draft
                    </span>
                  ) : null}
                </TableCell>

                <TableCell className="hidden text-right text-sm tabular-nums md:table-cell">
                  {formatCents(vendor.spend.totalSpentCents, { compact: true })}
                </TableCell>

                <TableCell className="text-right">
                  <span className="text-sm font-medium tabular-nums">
                    {formatCents(vendor.spend.outstandingCents, {
                      compact: true,
                    })}
                  </span>
                  {vendor.spend.overdueCents > 0 ? (
                    <p className="text-xs font-medium tabular-nums text-red-700 dark:text-red-400">
                      {formatCents(vendor.spend.overdueCents, { compact: true })}{" "}
                      overdue
                    </p>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-muted-foreground text-xs">
        Spend, outstanding balance and overdue amounts are rolled up from each
        vendor&rsquo;s bills at request time. Payment readiness is decided by the
        same rule the payment panel enforces, so a vendor this page calls
        payable is one the schedule form will accept.
      </p>
    </div>
  );
}
