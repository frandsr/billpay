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
 *
 * It was widened ONCE, in the scope-pivot pass (ADR 0008), to cover everything
 * the five verticals need: line-item **splits** with their GL accounts
 * (vertical B), the **OCR extractions** behind the bill (vertical D) and the
 * **recurring template** that generated it (vertical E). That is deliberate —
 * the alternative is five agents each editing this file, which is precisely the
 * conflict the ownership map exists to prevent. It is frozen again now.
 */
export const billDetailInclude = {
  vendor: true,
  createdBy: true,
  lineItems: {
    include: {
      glAccount: true,
      // A line with no splits is coded by its own `glAccountId`; a line with
      // splits is coded by them, and Σ(splits) == the line amount.
      splits: {
        include: { glAccount: true },
        orderBy: { sortOrder: "asc" },
      },
    },
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
  // Newest first: an extraction is an auditable run, and re-running appends
  // rather than replaces (ADR 0010), so [0] is the one to review.
  ocrExtractions: {
    orderBy: { extractedAt: "desc" },
  },
  // NULL on every manually created or ingested bill.
  recurringBill: true,
} satisfies Prisma.BillInclude;

export type BillDetail = Prisma.BillGetPayload<{
  include: typeof billDetailInclude;
}>;

export type BillDetailLineItem = BillDetail["lineItems"][number];
export type BillDetailSplit = BillDetailLineItem["splits"][number];
export type BillDetailApprovalStep = BillDetail["approvalSteps"][number];
export type BillDetailPayment = BillDetail["payments"][number];
export type BillDetailActivity = BillDetail["activities"][number];
export type BillDetailOcrExtraction = BillDetail["ocrExtractions"][number];

export async function getBillDetail(id: string): Promise<BillDetail | null> {
  return db.bill.findUnique({
    where: { id },
    include: billDetailInclude,
  });
}
