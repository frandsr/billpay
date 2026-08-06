import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * The canonical read for the bill detail page.
 *
 * Owned by the foundation phase and shared by every feature phase, so the
 * detail page issues ONE query and each panel receives the same object. If a
 * phase needs an extra relation, widen `billDetailInclude` here rather than
 * adding a second query in a component.
 */
export const billDetailInclude = {
  vendor: true,
  createdBy: true,
  lineItems: {
    include: { glAccount: true },
    orderBy: { sortOrder: "asc" },
  },
  payments: {
    orderBy: { scheduledDate: "asc" },
  },
  approvalSteps: {
    include: { approver: true },
    orderBy: { stepOrder: "asc" },
  },
  activities: {
    include: { user: true },
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.BillInclude;

export type BillDetail = Prisma.BillGetPayload<{
  include: typeof billDetailInclude;
}>;

export type BillDetailLineItem = BillDetail["lineItems"][number];
export type BillDetailApprovalStep = BillDetail["approvalSteps"][number];
export type BillDetailPayment = BillDetail["payments"][number];
export type BillDetailActivity = BillDetail["activities"][number];

export async function getBillDetail(id: string): Promise<BillDetail | null> {
  return db.bill.findUnique({
    where: { id },
    include: billDetailInclude,
  });
}
