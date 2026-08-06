import "server-only";

import type { Prisma } from "@prisma/client";

import {
  sortVendorsByAttention,
  toVendorSummary,
  type VendorSummary,
} from "@/components/vendors/rollups";
import { db } from "@/lib/db";
import { todayUtc } from "@/lib/dates";

/**
 * The vendor list's and vendor page's reads.
 *
 * This file fetches; `@/components/vendors/rollups.ts` decides — same split as
 * the dashboard, and for the same reason: this module carries `server-only`, so
 * keeping the arithmetic out of it is what makes the spend roll-up and the
 * payment-readiness verdict testable without a database.
 */

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

const VENDOR_LIST_SELECT = {
  id: true,
  name: true,
  email: true,
  status: true,
  bankName: true,
  accountLast4: true,
  routingLast4: true,
  addressLine1: true,
  city: true,
  state: true,
  postalCode: true,
  defaultPaymentTerms: true,
  defaultGlAccount: { select: { id: true, code: true, name: true } },
  taxId: true,
  is1099: true,
  bills: {
    select: {
      status: true,
      totalCents: true,
      dueDate: true,
      issueDate: true,
    },
  },
} satisfies Prisma.VendorSelect;

export type VendorListRow = Prisma.VendorGetPayload<{
  select: typeof VENDOR_LIST_SELECT;
}>;

const VENDOR_DETAIL_SELECT = {
  id: true,
  name: true,
  email: true,
  status: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  bankName: true,
  accountLast4: true,
  routingLast4: true,
  defaultPaymentTerms: true,
  defaultGlAccount: { select: { id: true, code: true, name: true } },
  taxId: true,
  is1099: true,
  notes: true,
  createdAt: true,
  bills: {
    orderBy: { issueDate: "desc" },
    select: {
      id: true,
      billNumber: true,
      issueDate: true,
      dueDate: true,
      totalCents: true,
      currency: true,
      status: true,
      source: true,
      payments: {
        orderBy: { scheduledDate: "asc" },
        select: {
          id: true,
          status: true,
          method: true,
          amountCents: true,
          scheduledDate: true,
          completedAt: true,
        },
      },
    },
  },
  recurringBills: {
    orderBy: { nextRunDate: "asc" },
    select: {
      id: true,
      name: true,
      amountCents: true,
      currency: true,
      frequency: true,
      nextRunDate: true,
      active: true,
    },
  },
} satisfies Prisma.VendorSelect;

export type VendorDetail = Prisma.VendorGetPayload<{
  select: typeof VENDOR_DETAIL_SELECT;
}>;

export type VendorDetailBill = VendorDetail["bills"][number];

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Every vendor with its bills, rolled up.
 *
 * One query with the bills included rather than a `groupBy` per metric: the
 * whole dataset is a few dozen rows, and pulling them means the aggregation
 * lives in `rollUpVendorSpend`, where a test can reach it. Vendors no payment
 * rail can reach sort first — that is what makes this page actionable rather
 * than a directory.
 */
export async function listVendors(): Promise<VendorSummary[]> {
  const today = todayUtc();
  const vendors = await db.vendor.findMany({
    select: VENDOR_LIST_SELECT,
    orderBy: { name: "asc" },
  });

  return vendors
    .map((vendor) => toVendorSummary(vendor, today))
    .sort(sortVendorsByAttention);
}

export async function getVendorDetail(
  vendorId: string,
): Promise<VendorDetail | null> {
  return db.vendor.findUnique({
    where: { id: vendorId },
    select: VENDOR_DETAIL_SELECT,
  });
}
