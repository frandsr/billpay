"use server";

/**
 * Mutations for the bill detail working surface — header, line items, splits
 * and comments. Owned by vertical B.
 *
 * Four rules are enforced HERE, not only in the UI, because hiding a button is
 * not a validation:
 *
 *  1. **Editability follows status.** Only a `DRAFT` or a `REJECTED` bill can
 *     be edited. A bill in the approval flow, paid or archived is read-only.
 *  2. **`Bill.totalCents` is authoritative** (ADR 0004). Nothing in this file
 *     ever rewrites the header total from Σ(line items); the difference is
 *     surfaced instead, and it is what keeps the draft in `Missing info`.
 *  3. **Σ(splits) equals the line amount, exactly.** Every write goes through
 *     `validateSplits` from the pure core, so an out-of-balance split set is
 *     rejected with the same message the editor already showed.
 *  4. **Money is integer minor units.** Text arrives from the form and is
 *     parsed once, at this boundary, by `parseAmountToCents`.
 *
 * Every meaningful edit appends an `Activity` of type `UPDATED` so the audit
 * trail tells the story of the coding, not just of the lifecycle.
 *
 * NOTE: this file carries `"use server"`, so every export must be an async
 * function. Types are erased and therefore fine to export.
 */

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

import { getCurrentUser } from "@/lib/current-user";
import { formatDate, fromDateInputValue } from "@/lib/dates";
import { db } from "@/lib/db";
import { PAYMENT_TERMS, type PaymentTerms } from "@/lib/domain";
import { normaliseLineType, type LineType } from "@/lib/line-type";
import { formatCents, lineAmountCents, parseAmountToCents } from "@/lib/money";
import {
  applyAllocationTemplate,
  distributeByBasisPoints,
  validateSplits,
  type SplitLike,
} from "@/lib/splits";

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

/** Every action returns this instead of throwing, so the editor can surface the
 *  reason inline rather than blowing up the React tree. */
export type ActionResult = { ok: true } | { ok: false; error: string };

export interface BillHeaderInput {
  billId: string;
  billNumber: string;
  /** "yyyy-MM-dd", the shape `<input type="date">` produces. */
  issueDate: string;
  dueDate: string;
  paymentTerms: string;
  /** Raw text from the amount field; parsed to integer cents server-side. */
  totalAmount: string;
  currency: string;
  memo: string;
}

export interface LineItemInput {
  description: string;
  quantity: number;
  /** Raw text; `amountCents` is derived as quantity × unit price. */
  unitPriceAmount: string;
  glAccountId: string | null;
  department: string | null;
  lineType: LineType;
}

export interface SplitInput {
  glAccountId: string;
  department: string | null;
  amountCents: number;
  /** Basis points (1% = 100), or null when the row was entered as an amount. */
  percentBasisPoints: number | null;
}

export interface AllocationTemplateRow {
  glAccountId: string;
  glAccountCode: string;
  glAccountName: string;
  department: string | null;
  percentBasisPoints: number;
}

export interface AllocationTemplateOption {
  id: string;
  name: string;
  description: string | null;
  rows: AllocationTemplateRow[];
}

/** The statuses in which the coding surface is writable. */
const EDITABLE_STATUSES = ["DRAFT", "REJECTED"] as const;

const MAX_COMMENT_LENGTH = 2_000;
const MAX_TEXT_LENGTH = 500;

/** A rejection the reviewer should read. Anything else is a bug and is logged. */
class EditError extends Error {}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Active allocation templates, flattened for the splits editor.
 *
 * Lives here rather than in `src/server/reference-data.ts` because that file is
 * frozen foundation code — this is the one reference read only vertical B needs.
 */
export async function getAllocationTemplates(): Promise<
  AllocationTemplateOption[]
> {
  const templates = await db.allocationTemplate.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    include: {
      splits: {
        orderBy: { sortOrder: "asc" },
        include: { glAccount: true },
      },
    },
  });

  return templates.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    rows: template.splits.map((split) => ({
      glAccountId: split.glAccountId,
      glAccountCode: split.glAccount.code,
      glAccountName: split.glAccount.name,
      department: split.department,
      percentBasisPoints: split.percentBasisPoints,
    })),
  }));
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export async function updateBillHeader(
  input: BillHeaderInput,
): Promise<ActionResult> {
  return withResult(async () => {
    const bill = await requireEditableBill(input.billId);

    const billNumber = requireText(input.billNumber, "Bill number");
    const issueDate = requireDate(input.issueDate, "Issue date");
    const dueDate = requireDate(input.dueDate, "Due date");
    const paymentTerms = requirePaymentTerms(input.paymentTerms);
    const currency = requireCurrency(input.currency);
    const totalCents = requireAmount(input.totalAmount, "Bill total", currency);
    const memo = optionalText(input.memo);

    if (totalCents <= 0) {
      throw new EditError("The bill total must be greater than zero.");
    }
    if (dueDate.getTime() < issueDate.getTime()) {
      throw new EditError("The due date cannot fall before the issue date.");
    }

    // Human-readable diff, built before the write so old values are still around.
    const changes: string[] = [];
    if (billNumber !== bill.billNumber) {
      changes.push(`bill number ${bill.billNumber} → ${billNumber}`);
    }
    if (totalCents !== bill.totalCents || currency !== bill.currency) {
      changes.push(
        `total ${formatCents(bill.totalCents, { currency: bill.currency })} → ${formatCents(totalCents, { currency })}`,
      );
    }
    if (!sameDay(issueDate, bill.issueDate)) {
      changes.push(
        `issue date ${formatDate(bill.issueDate)} → ${formatDate(issueDate)}`,
      );
    }
    if (!sameDay(dueDate, bill.dueDate)) {
      changes.push(
        `due date ${formatDate(bill.dueDate)} → ${formatDate(dueDate)}`,
      );
    }
    if (paymentTerms !== bill.paymentTerms) {
      changes.push(`payment terms ${bill.paymentTerms} → ${paymentTerms}`);
    }
    if ((memo ?? "") !== (bill.memo ?? "")) {
      changes.push("memo");
    }

    if (changes.length === 0) return;

    await db.bill.update({
      where: { id: bill.id },
      data: {
        billNumber,
        issueDate,
        dueDate,
        paymentTerms,
        totalCents,
        currency,
        memo,
      },
    });

    await recordActivity(bill.id, `Updated the bill: ${changes.join(", ")}.`);
    revalidateBill(bill.id);
  });
}

// ---------------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------------

export async function createLineItem(
  billId: string,
  input: LineItemInput,
): Promise<ActionResult> {
  return withResult(async () => {
    const bill = await requireEditableBill(billId);
    const parsed = await parseLineItem(input, bill.currency);

    const last = await db.lineItem.findFirst({
      where: { billId: bill.id },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    await db.lineItem.create({
      data: {
        billId: bill.id,
        description: parsed.description,
        quantity: parsed.quantity,
        unitPriceCents: parsed.unitPriceCents,
        amountCents: parsed.amountCents,
        glAccountId: parsed.glAccountId,
        department: parsed.department,
        lineType: parsed.lineType,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });

    await recordActivity(
      bill.id,
      `Added line item "${parsed.description}" for ${formatCents(parsed.amountCents, { currency: bill.currency })}.`,
    );
    revalidateBill(bill.id);
  });
}

export async function updateLineItem(
  lineItemId: string,
  input: LineItemInput,
): Promise<ActionResult> {
  return withResult(async () => {
    const line = await db.lineItem.findUnique({
      where: { id: lineItemId },
      include: { splits: { orderBy: { sortOrder: "asc" } } },
    });
    if (!line) throw new EditError("That line item no longer exists.");

    const bill = await requireEditableBill(line.billId);
    const parsed = await parseLineItem(input, bill.currency);

    // A split line is coded by its splits, so the split set has to follow the
    // amount. Percentage splits can: re-run the same largest-remainder
    // distribution the editor uses. A fixed-amount split cannot be guessed at —
    // say so rather than leaving the line silently out of balance.
    const amountChanged = parsed.amountCents !== line.amountCents;
    const isSplit = line.splits.length > 0;
    const redistributed =
      amountChanged && isSplit
        ? redistributeSplits(line.splits, parsed.amountCents)
        : null;

    await db.$transaction(async (tx) => {
      await tx.lineItem.update({
        where: { id: line.id },
        data: {
          description: parsed.description,
          quantity: parsed.quantity,
          unitPriceCents: parsed.unitPriceCents,
          amountCents: parsed.amountCents,
          // A split line is coded BY its splits (GLOSSARY), so it must not also
          // carry a direct account. We CLEAR rather than ignore: leaving a
          // stale `glAccountId` on a split line would let anything that reads
          // the column without also reading `splits` — a report, an export, a
          // future query — attribute the whole line to an account that codes
          // none of it. Null here means exactly one thing: "the splits say".
          glAccountId: isSplit ? null : parsed.glAccountId,
          department: parsed.department,
          lineType: parsed.lineType,
        },
      });

      if (redistributed) {
        for (const split of redistributed) {
          await tx.lineItemSplit.update({
            where: { id: split.id },
            data: { amountCents: split.amountCents },
          });
        }
      }
    });

    const suffix = redistributed
      ? ` Its ${redistributed.length} splits were redistributed by percentage.`
      : "";
    await recordActivity(
      bill.id,
      `Updated line item "${parsed.description}".${suffix}`,
    );
    revalidateBill(bill.id);
  });
}

export async function deleteLineItem(lineItemId: string): Promise<ActionResult> {
  return withResult(async () => {
    const line = await db.lineItem.findUnique({ where: { id: lineItemId } });
    if (!line) throw new EditError("That line item no longer exists.");

    const bill = await requireEditableBill(line.billId);

    // Splits cascade with the line — the coding cannot outlive what it codes.
    await db.lineItem.delete({ where: { id: line.id } });

    await recordActivity(
      bill.id,
      `Removed line item "${line.description}" (${formatCents(line.amountCents, { currency: bill.currency })}).`,
    );
    revalidateBill(bill.id);
  });
}

// ---------------------------------------------------------------------------
// Splits
// ---------------------------------------------------------------------------

/**
 * Replace a line's whole split set in one write.
 *
 * Replacing rather than diffing is deliberate: Σ(splits) == line amount is an
 * invariant over the SET, so the set is the unit of change. An empty array
 * means "code this line directly by its own GL account".
 */
export async function saveLineItemSplits(
  lineItemId: string,
  splits: SplitInput[],
): Promise<ActionResult> {
  return withResult(async () => {
    const { bill, line } = await requireEditableLine(lineItemId);
    const normalised = await normaliseSplits(splits, line.amountCents);

    await replaceSplits(line, normalised);

    const message =
      normalised.length === 0
        ? `Removed the split on "${line.description}"; it is coded directly again.`
        : `Split "${line.description}" across ${normalised.length} GL accounts.`;

    await recordActivity(bill.id, message);
    revalidateBill(bill.id);
  });
}

/** Drop every split on a line, returning it to direct coding. */
export async function clearLineItemSplits(
  lineItemId: string,
): Promise<ActionResult> {
  return saveLineItemSplits(lineItemId, []);
}

/**
 * Apply a saved allocation template to a line.
 *
 * The template carries percentages only; `applyAllocationTemplate` turns them
 * into cents with the largest-remainder distribution, so the result reconciles
 * to the line amount by construction rather than by luck.
 */
export async function applyTemplateToLine(
  lineItemId: string,
  templateId: string,
): Promise<ActionResult> {
  return withResult(async () => {
    const { bill, line } = await requireEditableLine(lineItemId);

    const template = await db.allocationTemplate.findUnique({
      where: { id: templateId },
      include: { splits: { orderBy: { sortOrder: "asc" } } },
    });
    if (!template || !template.active) {
      throw new EditError("That allocation template is no longer available.");
    }
    if (template.splits.length === 0) {
      throw new EditError(`"${template.name}" has no rows to apply.`);
    }

    const drafted = applyAllocationTemplate(line.amountCents, template.splits);
    const normalised = await normaliseSplits(
      drafted.map((split) => ({
        glAccountId: split.glAccountId,
        department: split.department,
        amountCents: split.amountCents,
        percentBasisPoints: split.percentBasisPoints,
      })),
      line.amountCents,
    );

    await replaceSplits(line, normalised);

    await recordActivity(
      bill.id,
      `Applied allocation template "${template.name}" to "${line.description}".`,
    );
    revalidateBill(bill.id);
  });
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/**
 * Append a `COMMENTED` activity attributed to the acting user. Deliberately not
 * gated on status: a paid or archived bill is still worth talking about.
 */
export async function postComment(
  billId: string,
  message: string,
): Promise<ActionResult> {
  return withResult(async () => {
    const bill = await db.bill.findUnique({
      where: { id: billId },
      select: { id: true },
    });
    if (!bill) throw new EditError("That bill no longer exists.");

    const text = message.trim();
    if (!text) throw new EditError("Write something before posting.");
    if (text.length > MAX_COMMENT_LENGTH) {
      throw new EditError(
        `Comments are limited to ${MAX_COMMENT_LENGTH} characters.`,
      );
    }

    const user = await getCurrentUser();
    await db.activity.create({
      data: {
        billId: bill.id,
        userId: user.id,
        type: "COMMENTED",
        message: text,
      },
    });

    revalidateBill(bill.id);
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function withResult(work: () => Promise<void>): Promise<ActionResult> {
  try {
    await work();
    return { ok: true };
  } catch (error) {
    if (error instanceof EditError) {
      return { ok: false, error: error.message };
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        ok: false,
        error: "That bill number is already used for this vendor.",
      };
    }
    console.error("[bill-edit]", error);
    return { ok: false, error: "Something went wrong saving that change." };
  }
}

type EditableBill = {
  id: string;
  billNumber: string;
  status: string;
  currency: string;
  totalCents: number;
  issueDate: Date;
  dueDate: Date;
  paymentTerms: PaymentTerms;
  memo: string | null;
};

async function requireEditableBill(billId: string): Promise<EditableBill> {
  const bill = await db.bill.findUnique({
    where: { id: billId },
    select: {
      id: true,
      billNumber: true,
      status: true,
      currency: true,
      totalCents: true,
      issueDate: true,
      dueDate: true,
      paymentTerms: true,
      memo: true,
    },
  });

  if (!bill) throw new EditError("That bill no longer exists.");

  if (!(EDITABLE_STATUSES as readonly string[]).includes(bill.status)) {
    throw new EditError(
      "This bill is no longer a draft, so its coding is locked. Only draft and rejected bills can be edited.",
    );
  }

  return bill;
}

async function requireEditableLine(lineItemId: string) {
  const line = await db.lineItem.findUnique({ where: { id: lineItemId } });
  if (!line) throw new EditError("That line item no longer exists.");
  const bill = await requireEditableBill(line.billId);
  return { bill, line };
}

/** Parse and validate one line item's form values into integer cents. */
async function parseLineItem(input: LineItemInput, currency: string) {
  const description = requireText(input.description, "Description");

  const quantity = Number(input.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new EditError("Quantity must be a whole number greater than zero.");
  }

  const unitPriceCents = requireAmount(
    input.unitPriceAmount,
    "Unit price",
    currency,
  );

  // `amountCents` is derived, never typed: the schema denormalises
  // quantity × unit price, and letting the two disagree would create a second
  // authoritative amount inside a line.
  const amountCents = lineAmountCents(quantity, unitPriceCents);

  const lineType = normaliseLineType(input.lineType);
  const glAccountId = await optionalGlAccountId(input.glAccountId);
  const department = optionalText(input.department);

  return {
    description,
    quantity,
    unitPriceCents,
    amountCents,
    glAccountId,
    department,
    lineType,
  } as const;
}

/**
 * Validate a split set against the line amount using the pure core, then hand
 * back rows ready to write. The editor runs the same `validateSplits`, so the
 * server never rejects something the UI called fine — it just refuses to trust
 * that the UI ran.
 */
async function normaliseSplits(splits: SplitInput[], lineTotalCents: number) {
  if (splits.length === 0) return [];

  const rows: SplitLike[] = splits.map((split) => {
    if (!Number.isInteger(split.amountCents)) {
      throw new EditError("Split amounts must be whole cents.");
    }
    if (
      split.percentBasisPoints !== null &&
      !Number.isInteger(split.percentBasisPoints)
    ) {
      throw new EditError("Split percentages must be whole basis points.");
    }
    return {
      glAccountId: split.glAccountId || null,
      department: optionalText(split.department),
      amountCents: split.amountCents,
      percentBasisPoints: split.percentBasisPoints,
    };
  });

  const issues = validateSplits(lineTotalCents, rows);
  if (issues.length > 0) {
    throw new EditError(issues.map((issue) => issue.message).join(" "));
  }

  const glAccountIds = Array.from(
    new Set(rows.map((row) => row.glAccountId as string)),
  );
  const known = await db.glAccount.findMany({
    where: { id: { in: glAccountIds }, active: true },
    select: { id: true },
  });
  if (known.length !== glAccountIds.length) {
    throw new EditError("A split points at a GL account that is not active.");
  }

  return rows.map((row, index) => ({
    glAccountId: row.glAccountId as string,
    department: row.department ?? null,
    amountCents: row.amountCents,
    percentBasisPoints: row.percentBasisPoints ?? null,
    sortOrder: index,
  }));
}

/**
 * Swap a line's split set in one transaction.
 *
 * A split line is coded BY its splits (GLOSSARY), so gaining splits clears the
 * line's own `glAccountId`. That keeps one invariant true everywhere: a line's
 * direct account is non-null only when it has no splits, and the two can never
 * disagree about what codes the line.
 *
 * Nothing is written back the other way — a direct account derived from the
 * largest split would make the line claim a coding it does not have. Dropping
 * every split therefore leaves the line uncoded, which `draftReadinessDetail`
 * surfaces as `Missing info` rather than silently restoring a stale account.
 */
async function replaceSplits(
  line: { id: string },
  rows: Awaited<ReturnType<typeof normaliseSplits>>,
) {
  await db.$transaction(async (tx) => {
    await tx.lineItemSplit.deleteMany({ where: { lineItemId: line.id } });
    if (rows.length > 0) {
      await tx.lineItemSplit.createMany({
        data: rows.map((row) => ({ ...row, lineItemId: line.id })),
      });
      await tx.lineItem.update({
        where: { id: line.id },
        data: { glAccountId: null },
      });
    }
  });
}

/**
 * Re-spread an existing split set over a new line amount. Only possible when
 * every row carries a percentage — a fixed-amount split has no rule to follow.
 */
function redistributeSplits(
  splits: { id: string; amountCents: number; percentBasisPoints: number | null }[],
  newAmountCents: number,
) {
  const allPercentage = splits.every(
    (split) => typeof split.percentBasisPoints === "number",
  );

  if (!allPercentage) {
    throw new EditError(
      "This line is split by fixed amounts, so changing its amount would leave the split out of balance. Rebalance or remove the splits first.",
    );
  }

  const amounts = distributeByBasisPoints(
    newAmountCents,
    splits.map((split) => split.percentBasisPoints as number),
  );

  return splits.map((split, index) => ({
    id: split.id,
    amountCents: amounts[index] ?? 0,
  }));
}

async function recordActivity(billId: string, message: string) {
  const user = await getCurrentUser();
  await db.activity.create({
    data: { billId, userId: user.id, type: "UPDATED", message },
  });
}

function revalidateBill(billId: string) {
  revalidatePath(`/bills/${billId}`);
  revalidatePath("/bills");
}

// --- small parsers -------------------------------------------------------

function requireText(value: string, label: string): string {
  const text = (value ?? "").trim();
  if (!text) throw new EditError(`${label} is required.`);
  if (text.length > MAX_TEXT_LENGTH) {
    throw new EditError(`${label} is too long.`);
  }
  return text;
}

function optionalText(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  if (text.length > MAX_COMMENT_LENGTH) {
    throw new EditError("That text is too long.");
  }
  return text;
}

function requireDate(value: string, label: string): Date {
  const parsed = fromDateInputValue(value);
  if (!parsed) throw new EditError(`${label} is not a valid date.`);
  return parsed;
}

function requireAmount(value: string, label: string, currency: string): number {
  const cents = parseAmountToCents(value, currency);
  if (cents === null) throw new EditError(`${label} is not a valid amount.`);
  if (!Number.isInteger(cents)) {
    throw new EditError(`${label} must be a whole number of cents.`);
  }
  if (cents < 0) throw new EditError(`${label} cannot be negative.`);
  return cents;
}

function requirePaymentTerms(value: string): PaymentTerms {
  const terms = PAYMENT_TERMS.find((term) => term === value);
  if (!terms) throw new EditError("Pick a valid payment term.");
  return terms;
}

function requireCurrency(value: string): string {
  const currency = (value ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new EditError("Currency must be a three-letter ISO code.");
  }
  return currency;
}

async function optionalGlAccountId(value: string | null): Promise<string | null> {
  if (!value) return null;
  const account = await db.glAccount.findFirst({
    where: { id: value, active: true },
    select: { id: true },
  });
  if (!account) throw new EditError("Pick an active GL account.");
  return account.id;
}

function sameDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}
