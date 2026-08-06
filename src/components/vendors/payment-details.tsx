import { CircleAlert, CircleCheck, Landmark, TriangleAlert } from "lucide-react";

import { PAYMENT_METHOD_LABELS } from "@/lib/payment-lifecycle";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  maskAccountNumber,
  type VendorPaymentReadiness,
} from "@/components/vendors/rollups";

export interface PaymentDetailsBadgeProps {
  readiness: VendorPaymentReadiness;
  /** Last four of the bank account, already the only digits we store. */
  accountLast4?: string | null;
  bankName?: string | null;
  className?: string;
}

/**
 * Whether this vendor can actually be paid — the one thing on the vendor list
 * that blocks work downstream.
 *
 * Three states, not two, because "payment details" is not one condition: a
 * vendor with bank details but no mailing address can be paid by ACH and not by
 * check, which is a warning rather than a blocker. Only a vendor no rail can
 * reach gets the red badge, because only that vendor makes an approved bill
 * impossible to settle.
 *
 * The account number is always masked. The schema stores the last four digits
 * only, and `maskAccountNumber` is the single place they are rendered.
 */
export function PaymentDetailsBadge({
  readiness,
  accountLast4,
  bankName,
  className,
}: PaymentDetailsBadgeProps) {
  if (readiness.unpayable) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "border-red-300 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950/60 dark:text-red-300",
          className,
        )}
        title={`Missing ${readiness.missing.join(", ")}`}
      >
        <CircleAlert data-icon="inline-start" />
        No payment details
      </Badge>
    );
  }

  if (readiness.blocked.length > 0) {
    return (
      <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
        <Badge
          variant="outline"
          className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/60 dark:text-amber-300"
          title={readiness.blocked.map((entry) => entry.message).join("\n")}
        >
          <TriangleAlert data-icon="inline-start" />
          {readiness.available.length} of{" "}
          {readiness.available.length + readiness.blocked.length} rails
        </Badge>
        <span className="text-muted-foreground text-xs tabular-nums">
          {maskAccountNumber(accountLast4)}
        </span>
      </span>
    );
  }

  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <Badge
        variant="outline"
        className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/60 dark:text-emerald-300"
      >
        <CircleCheck data-icon="inline-start" />
        On file
      </Badge>
      <span className="text-muted-foreground text-xs tabular-nums">
        {bankName ? `${bankName} · ` : ""}
        {maskAccountNumber(accountLast4)}
      </span>
    </span>
  );
}

export interface PaymentRailsListProps {
  readiness: VendorPaymentReadiness;
}

/** Rail-by-rail readiness, with the exact missing fields for the blocked ones. */
export function PaymentRailsList({ readiness }: PaymentRailsListProps) {
  return (
    <ul className="space-y-1.5">
      {readiness.available.map((method) => (
        <li key={method} className="flex items-center gap-2 text-xs">
          <CircleCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          <span className="font-medium">{PAYMENT_METHOD_LABELS[method]}</span>
          <span className="text-muted-foreground">ready</span>
        </li>
      ))}
      {readiness.blocked.map((entry) => (
        <li key={entry.method} className="flex items-start gap-2 text-xs">
          <CircleAlert className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            <span className="font-medium">
              {PAYMENT_METHOD_LABELS[entry.method]}
            </span>{" "}
            <span className="text-muted-foreground">
              blocked — missing {entry.missing.join(", ")}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface MaskedBankDetailsProps {
  bankName?: string | null;
  accountLast4?: string | null;
  routingLast4?: string | null;
}

/**
 * The bank block on the vendor detail page.
 *
 * Only the last four digits exist in the database — these are demo values, not
 * credentials — and they are rendered masked so a screenshot of this page never
 * shows a full account or routing number.
 */
export function MaskedBankDetails({
  bankName,
  accountLast4,
  routingLast4,
}: MaskedBankDetailsProps) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
      <div className="space-y-0.5">
        <dt className="text-muted-foreground text-[11px] font-medium">Bank</dt>
        <dd className="flex items-center gap-1.5">
          <Landmark className="text-muted-foreground size-3.5" />
          {bankName ?? <span className="text-muted-foreground">Not on file</span>}
        </dd>
      </div>
      <div className="space-y-0.5">
        <dt className="text-muted-foreground text-[11px] font-medium">
          Account
        </dt>
        <dd className="tabular-nums">{maskAccountNumber(accountLast4)}</dd>
      </div>
      <div className="space-y-0.5">
        <dt className="text-muted-foreground text-[11px] font-medium">
          Routing
        </dt>
        <dd className="tabular-nums">{maskAccountNumber(routingLast4)}</dd>
      </div>
    </dl>
  );
}
