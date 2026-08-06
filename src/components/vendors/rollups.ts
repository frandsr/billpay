import {
  missingVendorPaymentDetails,
  type MissingVendorDetails,
  type VendorPaymentDetailsLike,
} from "@/lib/payment-lifecycle";
import { OUTSTANDING_BILL_STATUSES } from "@/components/dashboard/rollups";
import { daysUntilDue, todayUtc } from "@/lib/dates";
import { PAYMENT_METHODS, type BillStatus, type PaymentMethod, type PaymentTerms } from "@/lib/domain";

/**
 * Vendor payment readiness and spend roll-ups, as pure functions.
 *
 * PURE MODULE: no Prisma, no React, no `next/*`. Inputs are structural, so the
 * rows `@/server/queries/vendors.ts` selects satisfy them without this file
 * importing the generated client — and so the arithmetic is reachable from a
 * test with no database.
 *
 * The interesting question a vendor page answers is not "what is this
 * supplier's address" but **can we actually pay them, and what do we owe them**.
 * Readiness therefore delegates to `missingVendorPaymentDetails`, the same rule
 * the payment panel enforces before it lets anyone schedule a payment.
 * Reimplementing it here would let the vendor list call a supplier payable
 * while the schedule form refuses to pay them.
 */

// ---------------------------------------------------------------------------
// Payment readiness — "can a payment be scheduled for this vendor at all?"
// ---------------------------------------------------------------------------

export interface VendorPaymentReadiness {
  /** Rails this vendor can be paid by today. */
  available: PaymentMethod[];
  /** Rails that are blocked, each naming exactly what is missing. */
  blocked: MissingVendorDetails[];
  /**
   * No rail works — a payment cannot be scheduled for this vendor at all.
   * This is the flag worth acting on: an approved bill for such a vendor is
   * stuck until somebody fills the details in.
   */
  unpayable: boolean;
  /** Bank details complete enough for ACH and wire. */
  hasBankDetails: boolean;
  /** Remittance address complete enough to mail a check. */
  hasRemittanceAddress: boolean;
  /** Distinct missing field labels across every blocked rail. */
  missing: string[];
}

/**
 * Which payment rails this vendor is ready for.
 *
 * Three outcomes rather than two, because "payment details on file" is not one
 * condition: ACH needs an account and a routing number, a check needs a mailing
 * address, a virtual card needs an email. A vendor with bank details but no
 * address is payable — a vendor with neither is not, and only the second one
 * blocks work downstream.
 */
export function vendorPaymentReadiness(
  vendor: VendorPaymentDetailsLike,
): VendorPaymentReadiness {
  const available: PaymentMethod[] = [];
  const blocked: MissingVendorDetails[] = [];

  for (const method of PAYMENT_METHODS) {
    const missing = missingVendorPaymentDetails(vendor, method);
    if (missing) blocked.push(missing);
    else available.push(method);
  }

  return {
    available,
    blocked,
    unpayable: available.length === 0,
    hasBankDetails: available.includes("ACH"),
    hasRemittanceAddress: available.includes("CHECK"),
    missing: [...new Set(blocked.flatMap((entry) => entry.missing))],
  };
}

/**
 * Mask a stored account number for display.
 *
 * The schema only ever holds the last four digits — demo values, not
 * credentials — and this is the single place they are rendered, so a full
 * account number cannot reach the UI even if the column one day carried one.
 */
export function maskAccountNumber(last4: string | null | undefined): string {
  const digits = last4?.trim();
  if (!digits) return "Not on file";
  return `•••• ${digits.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Spend roll-up
// ---------------------------------------------------------------------------

export interface VendorBillLike {
  status: BillStatus;
  totalCents: number;
  dueDate: Date;
  issueDate: Date;
}

export interface VendorSpendRollup {
  billCount: number;
  /** Σ(PAID bills) — what has actually left the building. */
  totalSpentCents: number;
  paidCount: number;
  /** Σ(submitted but unpaid) — awaiting approval + approved. */
  outstandingCents: number;
  outstandingCount: number;
  overdueCents: number;
  overdueCount: number;
  draftCount: number;
  /** Issue date of the most recent bill; `null` when there are none. */
  lastBillDate: Date | null;
}

/**
 * Roll a vendor's bills up into the figures the list shows.
 *
 * "Total spend" counts PAID bills only. Counting approved-but-unpaid bills as
 * spend would inflate it with money that has not moved, and the outstanding
 * column already carries those.
 */
export function rollUpVendorSpend(
  bills: readonly VendorBillLike[],
  today: Date = todayUtc(),
): VendorSpendRollup {
  const rollup: VendorSpendRollup = {
    billCount: bills.length,
    totalSpentCents: 0,
    paidCount: 0,
    outstandingCents: 0,
    outstandingCount: 0,
    overdueCents: 0,
    overdueCount: 0,
    draftCount: 0,
    lastBillDate: null,
  };

  for (const bill of bills) {
    if (bill.status === "PAID") {
      rollup.totalSpentCents += bill.totalCents;
      rollup.paidCount += 1;
    }

    if (bill.status === "DRAFT") rollup.draftCount += 1;

    if (OUTSTANDING_BILL_STATUSES.includes(bill.status)) {
      rollup.outstandingCents += bill.totalCents;
      rollup.outstandingCount += 1;
      if (daysUntilDue(bill.dueDate, today) < 0) {
        rollup.overdueCents += bill.totalCents;
        rollup.overdueCount += 1;
      }
    }

    if (
      rollup.lastBillDate === null ||
      bill.issueDate.getTime() > rollup.lastBillDate.getTime()
    ) {
      rollup.lastBillDate = bill.issueDate;
    }
  }

  return rollup;
}

// ---------------------------------------------------------------------------
// One row of the vendor list
// ---------------------------------------------------------------------------

export interface GlAccountRef {
  id: string;
  code: string;
  name: string;
}

/** The vendor fields the list needs, plus its bills. Structural on purpose. */
export interface VendorRowLike extends VendorPaymentDetailsLike {
  id: string;
  status: "ACTIVE" | "ARCHIVED";
  defaultPaymentTerms: PaymentTerms;
  defaultGlAccount: GlAccountRef | null;
  taxId: string | null;
  is1099: boolean;
  bills: readonly VendorBillLike[];
}

export interface VendorSummary {
  id: string;
  name: string;
  email: string | null;
  status: "ACTIVE" | "ARCHIVED";
  defaultPaymentTerms: PaymentTerms;
  defaultGlAccount: GlAccountRef | null;
  taxId: string | null;
  is1099: boolean;
  bankName: string | null;
  accountLast4: string | null;
  readiness: VendorPaymentReadiness;
  spend: VendorSpendRollup;
  /** A 1099 vendor with no tax ID: a January problem, flagged in August. */
  missingTaxId: boolean;
}

export function toVendorSummary(
  vendor: VendorRowLike,
  today: Date = todayUtc(),
): VendorSummary {
  return {
    id: vendor.id,
    name: vendor.name,
    email: vendor.email ?? null,
    status: vendor.status,
    defaultPaymentTerms: vendor.defaultPaymentTerms,
    defaultGlAccount: vendor.defaultGlAccount,
    taxId: vendor.taxId,
    is1099: vendor.is1099,
    bankName: vendor.bankName ?? null,
    accountLast4: vendor.accountLast4 ?? null,
    readiness: vendorPaymentReadiness(vendor),
    spend: rollUpVendorSpend(vendor.bills, today),
    missingTaxId: vendor.is1099 && !vendor.taxId?.trim(),
  };
}

/** Blocked vendors first, then the largest overdue, then the largest balance. */
export function sortVendorsByAttention(
  a: VendorSummary,
  b: VendorSummary,
): number {
  if (a.readiness.unpayable !== b.readiness.unpayable) {
    return a.readiness.unpayable ? -1 : 1;
  }
  if (a.spend.overdueCents !== b.spend.overdueCents) {
    return b.spend.overdueCents - a.spend.overdueCents;
  }
  if (a.spend.outstandingCents !== b.spend.outstandingCents) {
    return b.spend.outstandingCents - a.spend.outstandingCents;
  }
  return a.name.localeCompare(b.name);
}

export interface VendorListTotals {
  vendorCount: number;
  activeCount: number;
  /** Vendors no payment rail can reach — the actionable flag. */
  unpayableCount: number;
  /** Vendors missing at least one rail but payable by another. */
  partialDetailsCount: number;
  is1099Count: number;
  missingTaxIdCount: number;
  outstandingCents: number;
  overdueCents: number;
  totalSpentCents: number;
}

export function summariseVendors(
  vendors: readonly VendorSummary[],
): VendorListTotals {
  return vendors.reduce<VendorListTotals>(
    (totals, vendor) => ({
      vendorCount: totals.vendorCount + 1,
      activeCount: totals.activeCount + (vendor.status === "ACTIVE" ? 1 : 0),
      unpayableCount:
        totals.unpayableCount + (vendor.readiness.unpayable ? 1 : 0),
      partialDetailsCount:
        totals.partialDetailsCount +
        (!vendor.readiness.unpayable && vendor.readiness.blocked.length > 0
          ? 1
          : 0),
      is1099Count: totals.is1099Count + (vendor.is1099 ? 1 : 0),
      missingTaxIdCount:
        totals.missingTaxIdCount + (vendor.missingTaxId ? 1 : 0),
      outstandingCents: totals.outstandingCents + vendor.spend.outstandingCents,
      overdueCents: totals.overdueCents + vendor.spend.overdueCents,
      totalSpentCents: totals.totalSpentCents + vendor.spend.totalSpentCents,
    }),
    {
      vendorCount: 0,
      activeCount: 0,
      unpayableCount: 0,
      partialDetailsCount: 0,
      is1099Count: 0,
      missingTaxIdCount: 0,
      outstandingCents: 0,
      overdueCents: 0,
      totalSpentCents: 0,
    },
  );
}
