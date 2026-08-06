"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { dueDateFrom, fromDateInputValue, todayUtc } from "@/lib/dates";
import { PAYMENT_TERMS, type PaymentTerms } from "@/lib/domain";
import { lineAmountCents, parseAmountToCents } from "@/lib/money";

/**
 * Mutations owned by vertical A: manual bill creation.
 *
 * ADR 0004 is the rule that shapes this file. `Bill.totalCents` is the
 * authoritative amount owed; the line items are coding detail. So the action
 * writes the header total the human typed, writes the lines exactly as they
 * were entered, and NEVER reconciles one against the other. A bill whose lines
 * do not sum to the total saves happily as a DRAFT and surfaces as
 * `Missing info` — which is what `draftReadinessDetail()` already derives, and
 * what stops it being submitted for approval later.
 */

/** Currencies the app renders. Mirrors `CurrencyCode` in `@/lib/money`. */
const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "MXN"] as const;

export interface CreateBillFormState {
  status: "idle" | "error";
  /** Form-level message, e.g. an unexpected failure. */
  message?: string;
  /** Field name → message. Line fields are keyed `line.<index>.<field>`. */
  fieldErrors?: Record<string, string>;
}

interface ParsedLineItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  glAccountId: string | null;
  department: string | null;
  sortOrder: number;
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function textList(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .map((value) => (typeof value === "string" ? value.trim() : ""));
}

/**
 * Create a DRAFT bill with `source = MANUAL` plus its CREATED activity row.
 *
 * Shaped for `useActionState`: it returns a serialisable error state, or
 * redirects to the new bill's detail page on success.
 */
export async function createBillAction(
  _previousState: CreateBillFormState,
  formData: FormData,
): Promise<CreateBillFormState> {
  const fieldErrors: Record<string, string> = {};

  // -- Header ---------------------------------------------------------------

  const vendorId = text(formData, "vendorId");
  if (!vendorId) fieldErrors.vendorId = "Select a vendor.";

  const billNumber = text(formData, "billNumber");
  if (!billNumber) fieldErrors.billNumber = "Enter the invoice number.";

  const termsInput = text(formData, "paymentTerms");
  const paymentTerms: PaymentTerms = (
    PAYMENT_TERMS as readonly string[]
  ).includes(termsInput)
    ? (termsInput as PaymentTerms)
    : "NET_30";

  const issueDate = fromDateInputValue(text(formData, "issueDate")) ?? todayUtc();

  // The due date is DERIVED from the terms unless the user overrode it, and an
  // override is kept verbatim — AP teams negotiate dates that no term explains.
  const dueDateOverride = fromDateInputValue(text(formData, "dueDate"));
  const dueDate = dueDateOverride ?? dueDateFrom(issueDate, paymentTerms);
  if (dueDate.getTime() < issueDate.getTime()) {
    fieldErrors.dueDate = "The due date cannot be before the issue date.";
  }

  const currencyInput = text(formData, "currency").toUpperCase();
  const currency = (SUPPORTED_CURRENCIES as readonly string[]).includes(
    currencyInput,
  )
    ? currencyInput
    : "USD";

  const totalInput = text(formData, "totalAmount");
  const parsedTotal = parseAmountToCents(totalInput, currency);
  if (totalInput !== "" && parsedTotal === null) {
    fieldErrors.totalAmount = "Enter an amount like 1,250.00.";
  }
  if (parsedTotal !== null && parsedTotal < 0) {
    fieldErrors.totalAmount = "The bill total cannot be negative.";
  }
  // A blank total is not a hard failure: the draft simply reads `Missing info`.
  const totalCents = parsedTotal !== null && parsedTotal >= 0 ? parsedTotal : 0;

  const memo = text(formData, "memo");

  // -- Line items -----------------------------------------------------------

  const descriptions = textList(formData, "lineDescription");
  const quantities = textList(formData, "lineQuantity");
  const unitPrices = textList(formData, "lineUnitPrice");
  const glAccountIds = textList(formData, "lineGlAccountId");
  const departments = textList(formData, "lineDepartment");

  const lineItems: ParsedLineItem[] = [];

  for (let index = 0; index < descriptions.length; index += 1) {
    const description = descriptions[index] ?? "";
    const quantityInput = quantities[index] ?? "";
    const unitPriceInput = unitPrices[index] ?? "";
    const glAccountId = glAccountIds[index] ?? "";
    const department = departments[index] ?? "";

    const isEmptyRow =
      description === "" &&
      unitPriceInput === "" &&
      glAccountId === "" &&
      department === "";
    if (isEmptyRow) continue;

    const quantity = quantityInput === "" ? 1 : Number.parseInt(quantityInput, 10);
    if (!Number.isInteger(quantity) || quantity < 1) {
      fieldErrors[`line.${index}.quantity`] = "Quantity must be a whole number of 1 or more.";
      continue;
    }

    const unitPriceCents =
      unitPriceInput === "" ? 0 : parseAmountToCents(unitPriceInput, currency);
    if (unitPriceCents === null) {
      fieldErrors[`line.${index}.unitPrice`] = "Enter a price like 1,250.00.";
      continue;
    }

    lineItems.push({
      description,
      quantity,
      // The line amount is quantity x unit price, computed once by the domain
      // helper so the form, the server and the seed all round identically.
      unitPriceCents,
      amountCents: lineAmountCents(quantity, unitPriceCents),
      glAccountId: glAccountId === "" ? null : glAccountId,
      department: department === "" ? null : department,
      sortOrder: lineItems.length,
    });
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", fieldErrors, message: "Fix the highlighted fields." };
  }

  // -- Referential checks ---------------------------------------------------

  const [vendor, currentUser] = await Promise.all([
    db.vendor.findUnique({ where: { id: vendorId }, select: { id: true } }),
    getCurrentUser(),
  ]);

  if (!vendor) {
    return {
      status: "error",
      fieldErrors: { vendorId: "That vendor no longer exists." },
    };
  }

  const referencedGlAccountIds = [
    ...new Set(
      lineItems
        .map((line) => line.glAccountId)
        .filter((id): id is string => id !== null),
    ),
  ];

  if (referencedGlAccountIds.length > 0) {
    const found = await db.glAccount.count({
      where: { id: { in: referencedGlAccountIds }, active: true },
    });
    if (found !== referencedGlAccountIds.length) {
      return {
        status: "error",
        message: "One of the selected GL accounts is no longer available.",
      };
    }
  }

  // -- Write ----------------------------------------------------------------

  let createdBillId: string;

  try {
    const bill = await db.$transaction(async (tx) => {
      const created = await tx.bill.create({
        data: {
          billNumber,
          vendorId,
          issueDate,
          dueDate,
          paymentTerms,
          totalCents,
          currency,
          memo: memo === "" ? null : memo,
          status: "DRAFT",
          source: "MANUAL",
          createdById: currentUser.id,
          lineItems: {
            create: lineItems.map((line) => ({
              description: line.description,
              quantity: line.quantity,
              unitPriceCents: line.unitPriceCents,
              amountCents: line.amountCents,
              glAccountId: line.glAccountId,
              department: line.department,
              sortOrder: line.sortOrder,
            })),
          },
        },
        select: { id: true, billNumber: true },
      });

      await tx.activity.create({
        data: {
          billId: created.id,
          userId: currentUser.id,
          type: "CREATED",
          message: "created this bill",
        },
      });

      return created;
    });

    createdBillId = bill.id;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        status: "error",
        fieldErrors: {
          billNumber: "This vendor already has a bill with that invoice number.",
        },
      };
    }

    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Could not save the bill. Try again.",
    };
  }

  revalidatePath("/bills");
  revalidatePath("/dashboard");
  revalidatePath(`/bills/${createdBillId}`);

  // `redirect` throws, so it stays outside the try/catch above.
  //
  // Land on the bill, NOT the inbox. Saving is the start of coding it, not the
  // end of the job: splits, allocation templates and the approval submit all
  // live on the detail page, so sending the person to a list would only make
  // them find the bill again. `?created=1` is what the detail page reads to
  // acknowledge the save.
  redirect(`/bills/${createdBillId}?created=1`);
}
