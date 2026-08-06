import "server-only";

import type { Prisma } from "@prisma/client";

import type { RecurringBillInput } from "@/components/recurring/types";
import { toDateInputValue } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";

/**
 * Reads for the recurring-bill feature.
 *
 * `RecurringList` and `RecurringDetail` are server components that fetch their
 * own data, and these are the queries they call. They sit in `src/server/` with
 * the other reads rather than beside the components, because `db` is only ever
 * touched from the server layer — never from a component directory.
 */

const TEMPLATE_LIST_INCLUDE = {
  vendor: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  lineItems: {
    orderBy: { sortOrder: "asc" },
    select: { id: true, glAccountId: true, department: true },
  },
  _count: { select: { generatedBills: true } },
} satisfies Prisma.RecurringBillInclude;

export type RecurringTemplateListItem = Prisma.RecurringBillGetPayload<{
  include: typeof TEMPLATE_LIST_INCLUDE;
}>;

/**
 * Every template, soonest run first.
 *
 * Ordering by `nextRunDate` ascending puts the overdue ones at the top for
 * free, which is the thing the user came to the page to act on. Paused
 * templates sort last regardless of their date — they owe nothing, so they must
 * not compete for attention with the ones that do.
 */
export async function listRecurringTemplates(): Promise<
  RecurringTemplateListItem[]
> {
  return db.recurringBill.findMany({
    include: TEMPLATE_LIST_INCLUDE,
    orderBy: [{ active: "desc" }, { nextRunDate: "asc" }, { name: "asc" }],
  });
}

const TEMPLATE_DETAIL_INCLUDE = {
  vendor: true,
  createdBy: { select: { id: true, name: true, initials: true } },
  lineItems: {
    orderBy: { sortOrder: "asc" },
    include: { glAccount: { select: { id: true, code: true, name: true } } },
  },
  generatedBills: {
    orderBy: { issueDate: "desc" },
    select: {
      id: true,
      billNumber: true,
      issueDate: true,
      dueDate: true,
      totalCents: true,
      currency: true,
      status: true,
      createdAt: true,
    },
  },
} satisfies Prisma.RecurringBillInclude;

export type RecurringTemplateDetail = Prisma.RecurringBillGetPayload<{
  include: typeof TEMPLATE_DETAIL_INCLUDE;
}>;

export async function getRecurringTemplate(
  templateId: string,
): Promise<RecurringTemplateDetail | null> {
  return db.recurringBill.findUnique({
    where: { id: templateId },
    include: TEMPLATE_DETAIL_INCLUDE,
  });
}

/** The template's fields in the shape the create/edit form expects. */
export type RecurringTemplateForForm = Prisma.RecurringBillGetPayload<{
  include: { lineItems: true };
}>;

export async function getRecurringTemplateForForm(
  templateId: string,
): Promise<RecurringTemplateForForm | null> {
  return db.recurringBill.findUnique({
    where: { id: templateId },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  });
}

/**
 * Turn a stored template into the string-shaped input the form edits.
 *
 * Cents become text through `formatCents`, never through arithmetic, so an
 * amount that round-trips through the form comes back as exactly the same
 * integer — `parseAmountToCents` is the inverse of what is written here.
 */
export function toFormInput(
  template: RecurringTemplateForForm,
): RecurringBillInput {
  return {
    vendorId: template.vendorId,
    name: template.name,
    amount: formatCents(template.amountCents, {
      currency: template.currency,
      showSymbol: false,
    }),
    currency: template.currency,
    paymentTerms: template.paymentTerms,
    memo: template.memo ?? "",
    frequency: template.frequency,
    nextRunDate: toDateInputValue(template.nextRunDate),
    dayOfMonth: template.dayOfMonth === null ? "" : String(template.dayOfMonth),
    active: template.active,
    lineItems: template.lineItems
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((line) => ({
        description: line.description,
        quantity: String(line.quantity),
        unitPrice: formatCents(line.unitPriceCents, {
          currency: template.currency,
          showSymbol: false,
        }),
        glAccountId: line.glAccountId,
        department: line.department,
        lineType: line.lineType,
      })),
  };
}
