import type { BillStatus } from "@/lib/domain";

/**
 * What "outstanding" means, defined once.
 *
 * PURE MODULE: no Prisma, no React, no `next/*`.
 *
 * Three call sites had grown their own list of "still owes money" statuses and
 * two of them disagreed about DRAFT. Both readings were defensible, which is
 * exactly the problem: two figures on two screens, both labelled *outstanding*,
 * that do not add up to each other is the kind of thing a finance reviewer
 * notices and cannot un-notice. The sets live here now, each with a name that
 * says which question it answers, so a call site has to pick on purpose.
 */

/**
 * The canonical one. An outstanding bill is a **submitted, unpaid obligation**:
 * it is in the approval flow or through it, and no payment has settled it.
 *
 * DRAFT is excluded deliberately. A draft has not been submitted to anyone, so
 * counting it as an obligation overstates what the company owes — it is work in
 * progress, and it gets counted as such.
 *
 * PAID is settled. REJECTED and ARCHIVED never will be.
 */
export const OUTSTANDING_STATUSES: readonly BillStatus[] = [
  "AWAITING_APPROVAL",
  "APPROVED",
];

/**
 * Everything unpaid on the ledger, drafts included.
 *
 * The bills inbox uses this: its overdue counter is about any unpaid row a
 * clerk can still act on, and a draft past its due date is precisely the thing
 * they need to be shown. Named for what it includes so it can never be mistaken
 * for the figure above.
 */
export const UNPAID_INCLUDING_DRAFTS_STATUSES: readonly BillStatus[] = [
  "DRAFT",
  ...OUTSTANDING_STATUSES,
];

/**
 * Statuses whose due date still means something to the person reading the bill.
 *
 * Wider than either set above: a REJECTED bill owes nothing until it is fixed
 * and re-submitted, but its due date has not moved, so an overdue marker on the
 * bill detail is information rather than a claim about the balance sheet. This
 * set answers "should I show an overdue badge", never "how much do we owe".
 */
export const DUE_DATE_RELEVANT_STATUSES: readonly BillStatus[] = [
  ...UNPAID_INCLUDING_DRAFTS_STATUSES,
  "REJECTED",
];

/** A submitted, unpaid obligation — the canonical reading of "outstanding". */
export function isOutstanding(status: BillStatus): boolean {
  return OUTSTANDING_STATUSES.includes(status);
}

/** Unpaid and still actionable, drafts included. */
export function isUnpaidIncludingDrafts(status: BillStatus): boolean {
  return UNPAID_INCLUDING_DRAFTS_STATUSES.includes(status);
}
