"use server";

/**
 * Recurring bills — the write side.
 *
 * A recurring bill is a GENERATOR, not a bill (ADR 0005, GLOSSARY). It owns the
 * vendor, the amount, the cadence and — the part that earns the feature — the
 * GL coding, so each period produces a DRAFT that AP reviews rather than
 * retypes. The generated bill is an ordinary draft: same lifecycle, same
 * approval, same payment. Recurrence automates data entry, never control.
 *
 * The schedule arithmetic is NOT re-implemented here. `src/lib/recurring.ts`
 * owns "when is a bill owed" as a pure, database-free module; this file owns
 * "write the drafts that are owed" and calls into it.
 *
 * Money is always an integer number of minor units. Every amount that arrives
 * from the client is a raw string and is parsed HERE with `parseAmountToCents`,
 * so a hand-crafted request cannot inject a float.
 */

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/current-user";
import {
  dueDateFrom,
  formatDate,
  fromDateInputValue,
  todayUtc,
} from "@/lib/dates";
import { db } from "@/lib/db";
import {
  PAYMENT_TERMS,
  RECURRING_FREQUENCIES,
  type PaymentTerms,
  type RecurringFrequency,
} from "@/lib/domain";
import { lineAmountCents, parseAmountToCents } from "@/lib/money";
import {
  RECURRING_FREQUENCY_LABELS,
  dueOccurrences,
  nextRunDateAfter,
} from "@/lib/recurring";
import {
  EMPTY_GENERATION_SUMMARY,
  LINE_TYPES,
  SUPPORTED_CURRENCIES,
  type ActionResult,
  type FieldErrors,
  type GenerationSummary,
  type RecurringBillInput,
} from "@/components/recurring/types";

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

type TemplateWithLines = Prisma.RecurringBillGetPayload<{
  include: { lineItems: true };
}>;

interface TemplateOutcome {
  createdBillIds: string[];
  alreadyGenerated: number;
}

/**
 * Generate every DRAFT bill a single template currently owes.
 *
 * ### Multiple past periods
 * `dueOccurrences` returns EVERY occurrence the template owes, oldest first. A
 * template that was paused over a quarter, or a demo database seeded weeks ago,
 * owes more than one bill. We create all of them — one draft per period, each
 * dated to its own period — because generating only the newest silently drops
 * real payables, and an AP team discovers that at month end.
 *
 * ### Idempotency
 * A duplicated payable is a real-world incident, so the guard is deliberately
 * three-deep and each layer is independent:
 *
 *  1. **`nextRunDate` advances.** After a run the template points past every
 *     period it just generated (`nextRunDateAfter` walks the same occurrences),
 *     so a second click finds nothing due and returns without writing.
 *  2. **The period check below.** Before creating, we ask which of the due
 *     occurrences already have a bill for THIS template and skip those. This is
 *     what covers a `nextRunDate` that was edited backwards by hand, or a run
 *     that failed halfway.
 *  3. **The database.** `billNumber` is a pure function of (template id,
 *     occurrence date) and `Bill` is unique on `[vendorId, billNumber]`, so two
 *     concurrent clicks cannot both win — the loser gets a P2002 and its whole
 *     transaction rolls back.
 */
async function generateDraftsForTemplate(
  template: TemplateWithLines,
  actingUserId: string,
  today: Date,
): Promise<TemplateOutcome> {
  const occurrences = dueOccurrences(template, today);

  // Paused templates and templates whose next run is in the future owe nothing.
  if (occurrences.length === 0) {
    return { createdBillIds: [], alreadyGenerated: 0 };
  }

  return db.$transaction(async (tx) => {
    // IDEMPOTENCY GUARD (layer 2). Which of the owed periods already produced a
    // bill? `issueDate` IS the occurrence date for a generated bill, so this is
    // an exact period match rather than a heuristic.
    const existing = await tx.bill.findMany({
      where: {
        recurringBillId: template.id,
        issueDate: { in: occurrences },
      },
      select: { issueDate: true },
    });
    const generatedPeriods = new Set(
      existing.map((bill) => bill.issueDate.getTime()),
    );

    const createdBillIds: string[] = [];
    let alreadyGenerated = 0;

    for (const occurrence of occurrences) {
      if (generatedPeriods.has(occurrence.getTime())) {
        alreadyGenerated += 1;
        continue;
      }

      const bill = await tx.bill.create({
        data: {
          billNumber: generatedBillNumber(template.id, occurrence),
          vendorId: template.vendorId,
          issueDate: occurrence,
          // The due date is derived from the period's issue date and the agreed
          // terms, exactly as it would be for a bill typed in by hand.
          dueDate: dueDateFrom(occurrence, template.paymentTerms),
          paymentTerms: template.paymentTerms,
          totalCents: template.amountCents,
          currency: template.currency,
          memo: template.memo,
          // DRAFT by design: a generated bill enters the same lifecycle as any
          // other and still needs approval and payment.
          status: "DRAFT",
          // Provenance, alongside the `recurringBillId` link below: the source
          // says how the bill arrived, the id says which template made it.
          source: "RECURRING",
          createdById: actingUserId,
          recurringBillId: template.id,
          lineItems: {
            create: template.lineItems
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((line, index) => ({
                description: line.description,
                quantity: line.quantity,
                unitPriceCents: line.unitPriceCents,
                amountCents: line.amountCents,
                // The coding is the payload: the draft arrives with its GL
                // account and department already on every line.
                glAccountId: line.glAccountId,
                department: line.department,
                lineType: line.lineType,
                sortOrder: index,
              })),
          },
          activities: {
            create: {
              type: "CREATED",
              userId: actingUserId,
              message: `Generated from the recurring template “${template.name}” (${RECURRING_FREQUENCY_LABELS[template.frequency]}) for the ${formatDate(occurrence)} run.`,
            },
          },
        },
        select: { id: true },
      });

      createdBillIds.push(bill.id);
    }

    await tx.recurringBill.update({
      where: { id: template.id },
      data: {
        // Derived from the same walk as the occurrences above, so the template
        // can neither point back at a period it just generated nor jump over
        // one it never generated.
        nextRunDate: nextRunDateAfter(template, today),
        // Only stamped when something was actually written — "last generated"
        // must not move on a no-op run.
        lastGeneratedAt:
          createdBillIds.length > 0 ? new Date() : template.lastGeneratedAt,
      },
    });

    return { createdBillIds, alreadyGenerated };
  });
}

/** Run generation over a set of templates, aggregating the outcome. */
async function runGeneration(
  templates: TemplateWithLines[],
  actingUserId: string,
): Promise<GenerationSummary> {
  const today = todayUtc();
  const summary: GenerationSummary = { ...EMPTY_GENERATION_SUMMARY, createdBillIds: [] };

  for (const template of templates) {
    try {
      const outcome = await generateDraftsForTemplate(
        template,
        actingUserId,
        today,
      );

      if (outcome.createdBillIds.length > 0 || outcome.alreadyGenerated > 0) {
        summary.templatesProcessed += 1;
      }
      summary.createdBillIds.push(...outcome.createdBillIds);
      summary.billsCreated += outcome.createdBillIds.length;
      summary.alreadyGenerated += outcome.alreadyGenerated;
    } catch (error) {
      // IDEMPOTENCY GUARD (layer 3). A concurrent run got there first and the
      // unique index rejected the duplicate; the transaction rolled back, so
      // nothing partial was written. Count it and keep going — one template
      // losing a race must not abort the rest of the batch.
      if (!isUniqueViolation(error)) throw error;
      summary.templatesProcessed += 1;
      summary.alreadyGenerated += 1;
    }
  }

  return summary;
}

/**
 * The invoice number of a generated bill: a pure function of the template and
 * the period.
 *
 * Seeded from the template **id** rather than its name, because the id is
 * immutable — renaming a template must not change the number of a period that
 * was already generated, or the unique index stops protecting us.
 */
function generatedBillNumber(templateId: string, occurrence: Date): string {
  const stamp = occurrence.toISOString().slice(0, 10).replace(/-/g, "");
  return `REC-${templateKey(templateId)}-${stamp}`;
}

/** Short, stable, human-typeable key for a template id (FNV-1a, base36). */
function templateKey(templateId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < templateId.length; index += 1) {
    hash ^= templateId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(6, "0").slice(-6);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidatedLine {
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  glAccountId: string | null;
  department: string | null;
  lineType: (typeof LINE_TYPES)[number];
  sortOrder: number;
}

interface ValidatedTemplate {
  vendorId: string;
  name: string;
  amountCents: number;
  currency: string;
  paymentTerms: PaymentTerms;
  memo: string | null;
  frequency: RecurringFrequency;
  nextRunDate: Date;
  dayOfMonth: number | null;
  active: boolean;
  lineItems: ValidatedLine[];
}

type Validation =
  | { ok: true; value: ValidatedTemplate }
  | { ok: false; fieldErrors: FieldErrors };

/**
 * Server-side validation of a template.
 *
 * The client form does its own checking for feedback, but this is the check
 * that counts: a server action is a public endpoint, and the only thing between
 * it and a malformed payload is this function.
 */
async function validateTemplate(
  input: RecurringBillInput,
): Promise<Validation> {
  const fieldErrors: FieldErrors = {};

  const [vendor, glAccountIds] = await Promise.all([
    input.vendorId
      ? db.vendor.findUnique({
          where: { id: input.vendorId },
          select: { id: true, status: true },
        })
      : Promise.resolve(null),
    db.glAccount
      .findMany({ where: { active: true }, select: { id: true } })
      .then((rows) => new Set(rows.map((row) => row.id))),
  ]);

  if (!vendor) {
    fieldErrors.vendorId = "Select a vendor.";
  } else if (vendor.status !== "ACTIVE") {
    fieldErrors.vendorId = "That vendor is archived.";
  }

  const name = input.name?.trim() ?? "";
  if (!name) fieldErrors.name = "Give the template a name.";
  else if (name.length > 120) fieldErrors.name = "Keep the name under 120 characters.";

  const currency = (input.currency ?? "").toUpperCase();
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
    fieldErrors.currency = "Unsupported currency.";
  }

  const amountCents = parseAmountToCents(input.amount, currency || "USD");
  if (amountCents === null) {
    fieldErrors.amount = "Enter an amount.";
  } else if (amountCents <= 0) {
    fieldErrors.amount = "The amount must be greater than zero.";
  }

  if (!(PAYMENT_TERMS as readonly string[]).includes(input.paymentTerms)) {
    fieldErrors.paymentTerms = "Choose payment terms.";
  }

  if (!(RECURRING_FREQUENCIES as readonly string[]).includes(input.frequency)) {
    fieldErrors.frequency = "Choose a frequency.";
  }

  const nextRunDate = fromDateInputValue(input.nextRunDate ?? "");
  if (!nextRunDate) fieldErrors.nextRunDate = "Pick the next run date.";

  let dayOfMonth: number | null = null;
  const rawDayOfMonth = (input.dayOfMonth ?? "").trim();
  if (rawDayOfMonth !== "") {
    const parsed = Number.parseInt(rawDayOfMonth, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 31) {
      fieldErrors.dayOfMonth = "Day of month must be between 1 and 31.";
    } else {
      dayOfMonth = parsed;
    }
  }

  const lines = input.lineItems ?? [];
  if (lines.length === 0) {
    // A template with no lines generates a draft with nothing to code, which is
    // the one thing the feature exists to avoid.
    fieldErrors.lineItems = "Add at least one line item so the draft arrives coded.";
  }

  const lineItems: ValidatedLine[] = [];
  lines.forEach((line, index) => {
    const description = line.description?.trim() ?? "";
    if (!description) {
      fieldErrors[`lineItems.${index}.description`] = "Describe the line.";
    }

    const quantity = Number.parseInt((line.quantity ?? "").trim(), 10);
    if (!Number.isFinite(quantity) || quantity < 1) {
      fieldErrors[`lineItems.${index}.quantity`] = "At least 1.";
    }

    const unitPriceCents = parseAmountToCents(
      line.unitPrice,
      currency || "USD",
    );
    if (unitPriceCents === null || unitPriceCents < 0) {
      fieldErrors[`lineItems.${index}.unitPrice`] = "Enter a unit price.";
    }

    const glAccountId = line.glAccountId || null;
    if (glAccountId && !glAccountIds.has(glAccountId)) {
      fieldErrors[`lineItems.${index}.glAccountId`] = "Unknown GL account.";
    }

    const lineType = (LINE_TYPES as readonly string[]).includes(line.lineType)
      ? line.lineType
      : "EXPENSE";

    if (
      description &&
      Number.isFinite(quantity) &&
      quantity >= 1 &&
      unitPriceCents !== null &&
      unitPriceCents >= 0
    ) {
      lineItems.push({
        description,
        quantity,
        unitPriceCents,
        // Denormalised on write so nothing downstream has to re-multiply.
        amountCents: lineAmountCents(quantity, unitPriceCents),
        glAccountId,
        department: line.department?.trim() || null,
        lineType,
        sortOrder: index,
      });
    }
  });

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    value: {
      vendorId: vendor!.id,
      name,
      amountCents: amountCents!,
      currency,
      paymentTerms: input.paymentTerms,
      memo: input.memo?.trim() || null,
      frequency: input.frequency,
      nextRunDate: nextRunDate!,
      dayOfMonth,
      active: Boolean(input.active),
      lineItems,
    },
  };
}

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

function revalidateTemplate(templateId?: string): void {
  revalidatePath("/recurring");
  if (templateId) {
    revalidatePath(`/recurring/${templateId}`);
    revalidatePath(`/recurring/${templateId}/edit`);
  }
}

/** Generation writes bills, so the bill inbox and the dashboard move too. */
function revalidateAfterGeneration(templateId?: string): void {
  revalidateTemplate(templateId);
  revalidatePath("/bills");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

/**
 * Generate the drafts a single template owes, right now.
 *
 * Deliberately an explicit user action rather than a background scheduler: a
 * cron job would make the feature invisible for as long as it takes the clock
 * to come round, and the reviewer needs to see a coded draft appear in one
 * click. The scheduler seam is the same call — point a job at
 * `generateAllDueRecurringBills` and nothing else changes.
 */
export async function generateNow(
  templateId: string,
): Promise<ActionResult<GenerationSummary>> {
  const currentUser = await getCurrentUser();

  const template = await db.recurringBill.findUnique({
    where: { id: templateId },
    include: { lineItems: true },
  });

  if (!template) {
    return { ok: false, error: "That recurring template no longer exists." };
  }

  if (!template.active) {
    return {
      ok: false,
      error: "This template is paused. Resume it before generating a bill.",
    };
  }

  const summary = await runGeneration([template], currentUser.id);
  revalidateAfterGeneration(templateId);

  return { ok: true, data: summary };
}

/** Generate every draft that every active template currently owes. */
export async function generateAllDueRecurringBills(): Promise<
  ActionResult<GenerationSummary>
> {
  const currentUser = await getCurrentUser();

  // Filtering on `nextRunDate` in the query is only a cheap pre-filter; the
  // authority on "is it due" is `dueOccurrences`, which runs per template.
  const templates = await db.recurringBill.findMany({
    where: { active: true, nextRunDate: { lte: todayUtc() } },
    include: { lineItems: true },
    orderBy: { nextRunDate: "asc" },
  });

  const summary = await runGeneration(templates, currentUser.id);
  revalidateAfterGeneration();

  return { ok: true, data: summary };
}

export async function createRecurringBill(
  input: RecurringBillInput,
): Promise<ActionResult<{ id: string }>> {
  const currentUser = await getCurrentUser();
  const validation = await validateTemplate(input);

  if (!validation.ok) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: validation.fieldErrors,
    };
  }

  const value = validation.value;
  const template = await db.recurringBill.create({
    data: {
      vendorId: value.vendorId,
      name: value.name,
      amountCents: value.amountCents,
      currency: value.currency,
      paymentTerms: value.paymentTerms,
      memo: value.memo,
      frequency: value.frequency,
      nextRunDate: value.nextRunDate,
      dayOfMonth: value.dayOfMonth,
      active: value.active,
      createdById: currentUser.id,
      lineItems: { create: value.lineItems },
    },
    select: { id: true },
  });

  revalidateTemplate(template.id);
  return { ok: true, data: { id: template.id } };
}

export async function updateRecurringBill(
  templateId: string,
  input: RecurringBillInput,
): Promise<ActionResult<{ id: string }>> {
  const existing = await db.recurringBill.findUnique({
    where: { id: templateId },
    select: { id: true },
  });

  if (!existing) {
    return { ok: false, error: "That recurring template no longer exists." };
  }

  const validation = await validateTemplate(input);
  if (!validation.ok) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: validation.fieldErrors,
    };
  }

  const value = validation.value;

  await db.$transaction(async (tx) => {
    // Template lines are replaced wholesale rather than diffed. Nothing points
    // at them — a generated bill COPIES the coding onto its own line items — so
    // rewriting the template never rewrites history.
    await tx.recurringBillLineItem.deleteMany({
      where: { recurringBillId: templateId },
    });

    await tx.recurringBill.update({
      where: { id: templateId },
      data: {
        vendorId: value.vendorId,
        name: value.name,
        amountCents: value.amountCents,
        currency: value.currency,
        paymentTerms: value.paymentTerms,
        memo: value.memo,
        frequency: value.frequency,
        nextRunDate: value.nextRunDate,
        dayOfMonth: value.dayOfMonth,
        active: value.active,
        lineItems: { create: value.lineItems },
      },
    });
  });

  revalidateTemplate(templateId);
  return { ok: true, data: { id: templateId } };
}

/** Pause or resume a template. A paused template owes nothing until resumed. */
export async function setRecurringBillActive(
  templateId: string,
  active: boolean,
): Promise<ActionResult<{ active: boolean }>> {
  const existing = await db.recurringBill.findUnique({
    where: { id: templateId },
    select: { id: true },
  });

  if (!existing) {
    return { ok: false, error: "That recurring template no longer exists." };
  }

  await db.recurringBill.update({
    where: { id: templateId },
    data: { active },
  });

  revalidateTemplate(templateId);
  return { ok: true, data: { active } };
}
