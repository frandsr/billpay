/**
 * Seeds the demo dataset. Safe to re-run: it truncates the domain tables first,
 * then rebuilds everything from `seed-data.ts`.
 *
 * Run with `pnpm db:seed` (docker compose runs it automatically on start).
 */

import {
  ActivityType,
  ApprovalStepStatus,
  BillStatus,
  PrismaClient,
} from "@prisma/client";

import { resolveApproverChain } from "../src/lib/approval-policy";
import {
  ACTIVITY_MESSAGES,
  ALLOCATION_TEMPLATES,
  APPROVAL_POLICIES,
  GL_ACCOUNTS,
  OCR_EXTRACTIONS,
  USERS,
  VENDORS,
  type SeedBill,
} from "./seed-data";
import {
  COMPUTED_BILLS,
  COMPUTED_BILLS_BY_KEY,
  COMPUTED_LINE_ITEM_SPLITS,
  COMPUTED_RECURRING_BILLS,
  MS_PER_DAY,
  at,
  dayOffset,
  invoiceFileName,
  makeRandom,
  toCents,
} from "./seed-compute";

const prisma = new PrismaClient();
const random = makeRandom(20260101);

async function main() {
  // The Docker entrypoint sets SEED_IF_EMPTY=1 so restarting the container
  // does not wipe whatever the reviewer did in the UI. `pnpm db:seed` reseeds
  // unconditionally.
  if (process.env.SEED_IF_EMPTY === "1") {
    const existing = await prisma.user.count();
    if (existing > 0) {
      console.log("Database already seeded — skipping.");
      await report();
      return;
    }
  }

  console.log("Seeding Bill Pay demo data…\n");

  // Order matters: children first. Bills are removed before recurring bills
  // because a generated bill points back at the template that produced it.
  await prisma.activity.deleteMany();
  await prisma.approvalStep.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.lineItemSplit.deleteMany();
  await prisma.lineItem.deleteMany();
  await prisma.ocrExtraction.deleteMany();
  await prisma.bill.deleteMany();
  await prisma.recurringBillLineItem.deleteMany();
  await prisma.recurringBill.deleteMany();
  await prisma.allocationTemplateSplit.deleteMany();
  await prisma.allocationTemplate.deleteMany();
  await prisma.approvalPolicyStep.deleteMany();
  await prisma.approvalPolicy.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.glAccount.deleteMany();
  await prisma.user.deleteMany();

  // --- Users -------------------------------------------------------------
  // Explicit createdAt keeps the "first user" fallback in getCurrentUser()
  // deterministic: Maya Chen, the AP clerk, is the default identity.
  for (const [index, user] of USERS.entries()) {
    await prisma.user.create({
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        title: user.title,
        role: user.role,
        initials: user.initials,
        avatarColor: user.avatarColor,
        createdAt: at(dayOffset(-400), 8, index),
      },
    });
  }

  // --- GL accounts -------------------------------------------------------
  const glIdByCode = new Map<string, string>();
  for (const account of GL_ACCOUNTS) {
    const created = await prisma.glAccount.create({
      data: {
        code: account.code,
        name: account.name,
        type: account.type,
        active: account.active ?? true,
      },
    });
    glIdByCode.set(account.code, created.id);
  }

  // --- Vendors -----------------------------------------------------------
  const vendorIdByKey = new Map<string, string>();
  for (const vendor of VENDORS) {
    const created = await prisma.vendor.create({
      data: {
        name: vendor.name,
        email: vendor.email,
        addressLine1: vendor.addressLine1,
        addressLine2: vendor.addressLine2,
        city: vendor.city,
        state: vendor.state,
        postalCode: vendor.postalCode,
        country: vendor.country ?? "US",
        bankName: vendor.bankName,
        accountLast4: vendor.accountLast4,
        routingLast4: vendor.routingLast4,
        defaultPaymentTerms: vendor.defaultPaymentTerms,
        defaultGlAccountId: glIdByCode.get(vendor.defaultGlCode),
        taxId: vendor.taxId,
        is1099: vendor.is1099 ?? false,
        notes: vendor.notes,
      },
    });
    vendorIdByKey.set(vendor.key, created.id);
  }

  // --- Allocation templates ----------------------------------------------
  // Saved, named split patterns (GLOSSARY: allocation template). Percentage
  // only, so the same template applies to a line of any size.
  for (const template of ALLOCATION_TEMPLATES) {
    await prisma.allocationTemplate.create({
      data: {
        id: template.id,
        name: template.name,
        description: template.description,
        active: template.active ?? true,
        splits: {
          create: template.rows.map((row, index) => ({
            glAccountId: requireGlId(glIdByCode, row.glCode),
            department: row.department,
            percentBasisPoints: row.percentBasisPoints,
            sortOrder: index,
          })),
        },
      },
    });
  }

  // --- Approval policies -------------------------------------------------
  const policies = [];
  for (const policy of APPROVAL_POLICIES) {
    const created = await prisma.approvalPolicy.create({
      data: {
        id: policy.id,
        name: policy.name,
        description: policy.description,
        priority: policy.priority,
        minAmountCents: toCents(policy.minAmountDollars),
        active: true,
        steps: {
          create: policy.approverIds.map((approverId, index) => ({
            stepOrder: index + 1,
            approverId,
          })),
        },
      },
      include: { steps: true },
    });
    policies.push(created);
  }

  // --- Recurring bills ----------------------------------------------------
  // A recurring bill is a GENERATOR, not a bill: it owes a DRAFT on each
  // occurrence of its cadence. Two of the four are already due, so "generate
  // now" produces a visible draft on the reviewer's first click.
  for (const recurring of COMPUTED_RECURRING_BILLS) {
    const { spec, lines, totalCents, nextRunDate, lastGeneratedAt } = recurring;
    const vendorId = vendorIdByKey.get(spec.vendorKey);
    if (!vendorId) throw new Error(`Unknown vendor key: ${spec.vendorKey}`);

    await prisma.recurringBill.create({
      data: {
        id: spec.id,
        vendorId,
        name: spec.name,
        amountCents: totalCents,
        currency: "USD",
        paymentTerms: spec.terms,
        memo: spec.memo,
        frequency: spec.frequency,
        nextRunDate,
        dayOfMonth: spec.dayOfMonth,
        active: spec.active ?? true,
        createdById: spec.createdById ?? USERS[0].id,
        lastGeneratedAt,
        lineItems: {
          create: lines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            amountCents: line.amountCents,
            glAccountId: line.glCode ? glIdByCode.get(line.glCode) : null,
            department: line.department,
            lineType: line.lineType ?? "EXPENSE",
            sortOrder: line.sortOrder,
          })),
        },
      },
    });
  }

  // --- Bills -------------------------------------------------------------
  const defaultCreatorId = USERS[0].id;
  /** billKey -> line item ids in `sortOrder`, so splits can be attached after. */
  const lineItemIdsByBillKey = new Map<string, string[]>();
  const billIdByKey = new Map<string, string>();

  for (const computed of COMPUTED_BILLS) {
    const { spec, lines, totalCents, dueDate, issueDate, createdAt } = computed;
    const vendorId = vendorIdByKey.get(spec.vendorKey);
    if (!vendorId) throw new Error(`Unknown vendor key: ${spec.vendorKey}`);

    const createdById = spec.createdById ?? defaultCreatorId;
    const chain = resolveApproverChain(policies, totalCents);

    const submittedAt =
      spec.status === "DRAFT" || spec.status === "ARCHIVED"
        ? null
        : at(new Date(createdAt.getTime() + MS_PER_DAY), 10, 5);

    const bill = await prisma.bill.create({
      data: {
        billNumber: spec.billNumber,
        vendorId,
        issueDate,
        dueDate,
        paymentTerms: spec.terms,
        totalCents,
        currency: "USD",
        memo: spec.memo,
        status: spec.status,
        source: spec.source ?? "MANUAL",
        invoiceFileUrl: spec.noInvoice
          ? null
          : `/invoices/${invoiceFileName(spec.billNumber)}`,
        invoiceFileName: spec.noInvoice
          ? null
          : invoiceFileName(spec.billNumber),
        createdById,
        submittedAt,
        createdAt,
        lineItems: {
          create: lines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            amountCents: line.amountCents,
            glAccountId: line.glCode ? glIdByCode.get(line.glCode) : null,
            department: line.department,
            // Per-line first: one invoice can carry goods and services at once.
            lineType: line.lineType ?? spec.lineType ?? "EXPENSE",
            sortOrder: line.sortOrder,
          })),
        },
      },
      include: { lineItems: true },
    });

    billIdByKey.set(spec.key, bill.id);
    lineItemIdsByBillKey.set(
      spec.key,
      [...bill.lineItems]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((line) => line.id),
    );

    // --- Approval steps --------------------------------------------------
    const stepDecisions = decideSteps(
      spec.status,
      chain.length,
      spec.approvedSteps,
    );
    const decisionDates = stepDecisions.map((stepStatus, index) =>
      stepStatus === "PENDING" || !submittedAt
        ? null
        : at(
            new Date(submittedAt.getTime() + (index + 1) * MS_PER_DAY),
            11,
            20 + index * 7,
          ),
    );
    const lastDecisionAt =
      [...decisionDates].reverse().find((date) => date !== null) ?? null;

    for (const [index, stepStatus] of stepDecisions.entries()) {
      await prisma.approvalStep.create({
        data: {
          billId: bill.id,
          stepOrder: index + 1,
          approverId: chain[index].approverId,
          status: stepStatus,
          decidedAt: decisionDates[index],
          note:
            stepStatus === "REJECTED"
              ? (spec.decisionNote ?? "Rejected — see the attached invoice.")
              : null,
        },
      });
    }

    const approvedAt =
      spec.status === "APPROVED" || spec.status === "PAID"
        ? (lastDecisionAt ?? submittedAt)
        : null;

    if (approvedAt) {
      await prisma.bill.update({
        where: { id: bill.id },
        data: { approvedAt },
      });
    }

    // --- Payment ---------------------------------------------------------
    let paymentCompletedAt: Date | null = null;
    let hasPayment = false;

    if (spec.payment) {
      const scheduledDate = dayOffset(spec.payment.scheduledInDays);
      const initiatedAt =
        spec.payment.status === "SCHEDULED" ? null : at(scheduledDate, 14, 0);
      const completedAt =
        spec.payment.status === "PAID"
          ? at(new Date(scheduledDate.getTime() + 2 * MS_PER_DAY), 16, 30)
          : null;

      await prisma.payment.create({
        data: {
          billId: bill.id,
          amountCents: totalCents,
          method: spec.payment.method,
          scheduledDate,
          initiatedAt,
          completedAt,
          status: spec.payment.status,
          reference: paymentReference(spec.payment.method),
          createdAt: approvedAt ?? createdAt,
        },
      });

      hasPayment = true;
      paymentCompletedAt = completedAt;
    }

    // --- Activity --------------------------------------------------------
    const activities: {
      type: ActivityType;
      userId: string | null;
      message: string;
      createdAt: Date;
    }[] = [
      {
        type: "CREATED",
        userId: createdById,
        message: sourceMessage(spec),
        createdAt,
      },
    ];

    if (submittedAt) {
      activities.push({
        type: "SUBMITTED",
        userId: createdById,
        message: ACTIVITY_MESSAGES.SUBMITTED!,
        createdAt: submittedAt,
      });
    }

    for (const [index, stepStatus] of stepDecisions.entries()) {
      const decidedAt = decisionDates[index];
      if (!decidedAt) continue;
      activities.push({
        type: stepStatus === "APPROVED" ? "APPROVED" : "REJECTED",
        userId: chain[index].approverId,
        message:
          stepStatus === "APPROVED"
            ? ACTIVITY_MESSAGES.APPROVED!
            : `${ACTIVITY_MESSAGES.REJECTED!}: ${spec.decisionNote ?? "no reason given"}`,
        createdAt: decidedAt,
      });
    }

    if (
      spec.memo &&
      (spec.status === "AWAITING_APPROVAL" || spec.status === "APPROVED")
    ) {
      activities.push({
        type: "COMMENTED",
        userId: random() > 0.5 ? "usr_daniel" : "usr_maya",
        message: spec.memo,
        createdAt: at(
          new Date((submittedAt ?? createdAt).getTime() + MS_PER_DAY / 2),
          15,
          40,
        ),
      });
    }

    if (hasPayment) {
      activities.push({
        type: "PAYMENT_SCHEDULED",
        userId: defaultCreatorId,
        message: ACTIVITY_MESSAGES.PAYMENT_SCHEDULED!,
        createdAt: approvedAt ?? createdAt,
      });
      if (paymentCompletedAt) {
        activities.push({
          type: "PAID",
          userId: null,
          message: ACTIVITY_MESSAGES.PAID!,
          createdAt: paymentCompletedAt,
        });
      }
    }

    if (spec.status === "ARCHIVED") {
      activities.push({
        type: "ARCHIVED",
        userId: createdById,
        message: `${ACTIVITY_MESSAGES.ARCHIVED!}: ${spec.decisionNote ?? "no reason given"}`,
        createdAt: at(new Date(createdAt.getTime() + 2 * MS_PER_DAY), 12, 10),
      });
    }

    activities.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    await prisma.activity.createMany({
      data: activities.map((activity) => ({
        billId: bill.id,
        userId: activity.userId,
        type: activity.type,
        message: activity.message,
        createdAt: activity.createdAt,
      })),
    });
  }

  // --- Line-item splits ---------------------------------------------------
  // A line with splits is coded BY the splits, and Σ(splits) equals the line
  // amount exactly — the cents were distributed by the same
  // `distributeByBasisPoints` the app uses (see seed-compute.ts).
  for (const spec of COMPUTED_LINE_ITEM_SPLITS) {
    const lineItemIds = lineItemIdsByBillKey.get(spec.billKey);
    const lineItemId = lineItemIds?.[spec.lineSortOrder];
    if (!lineItemId) {
      throw new Error(
        `No line item ${spec.lineSortOrder} on bill ${spec.billKey} to split.`,
      );
    }

    const total = spec.splits.reduce((sum, split) => sum + split.amountCents, 0);
    if (total !== spec.lineAmountCents) {
      throw new Error(
        `Splits for ${spec.billKey}#${spec.lineSortOrder} sum to ${total}, not ${spec.lineAmountCents}.`,
      );
    }

    await prisma.lineItemSplit.createMany({
      data: spec.splits.map((split) => ({
        lineItemId,
        glAccountId: requireGlId(glIdByCode, split.glCode),
        department: split.department,
        amountCents: split.amountCents,
        percentBasisPoints: split.percentBasisPoints,
        sortOrder: split.sortOrder,
      })),
    });
  }

  // --- OCR extractions ----------------------------------------------------
  // Stored as a sibling row, not folded into the bill, so the review UI can
  // show what the extractor claimed NEXT TO what the bill says.
  for (const spec of OCR_EXTRACTIONS) {
    const billId = billIdByKey.get(spec.billKey);
    const computed = COMPUTED_BILLS_BY_KEY.get(spec.billKey);
    if (!billId || !computed) {
      throw new Error(`OCR extraction references unknown bill: ${spec.billKey}`);
    }

    await prisma.ocrExtraction.create({
      data: {
        billId,
        provider: spec.provider,
        confidenceBasisPoints: spec.confidenceBasisPoints,
        extractedAt: at(dayOffset(spec.extractedInDays), 7, 42),
        rawResult: {
          documentFileName: invoiceFileName(computed.spec.billNumber),
          fields: {
            vendorName: {
              value: vendorNameByKey(computed.spec.vendorKey),
              confidenceBasisPoints: spec.fieldConfidence.vendorName,
            },
            billNumber: {
              value: computed.spec.billNumber,
              confidenceBasisPoints: spec.fieldConfidence.billNumber,
            },
            issueDate: {
              value: computed.issueDate.toISOString().slice(0, 10),
              confidenceBasisPoints: spec.fieldConfidence.issueDate,
            },
            dueDate: {
              value: computed.dueDate.toISOString().slice(0, 10),
              confidenceBasisPoints: spec.fieldConfidence.dueDate,
            },
            paymentTerms: {
              value: computed.spec.terms,
              confidenceBasisPoints: spec.fieldConfidence.paymentTerms,
            },
            totalCents: {
              value: computed.totalCents,
              confidenceBasisPoints: spec.fieldConfidence.totalCents,
            },
          },
          lineItems: computed.lines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            amountCents: line.amountCents,
            confidenceBasisPoints: spec.fieldConfidence.lineItems,
          })),
          // The whole point of this row: the extractor's own total and its own
          // lines disagree, which is why the bill reads `Missing info`.
          lineTotalCents: computed.lineTotalCents,
          warnings: spec.warnings,
        },
      },
    });
  }

  await report();
}

function requireGlId(glIdByCode: Map<string, string>, code: string): string {
  const id = glIdByCode.get(code);
  if (!id) throw new Error(`Unknown GL account code: ${code}`);
  return id;
}

function vendorNameByKey(key: string): string {
  const vendor = VENDORS.find((candidate) => candidate.key === key);
  if (!vendor) throw new Error(`Unknown vendor key: ${key}`);
  return vendor.name;
}

/**
 * Decide the status of each materialised approval step for a bill.
 * Keeps the "X of N" indicator consistent with where the bill actually sits.
 */
function decideSteps(
  status: BillStatus,
  chainLength: number,
  approvedSteps = 0,
): ApprovalStepStatus[] {
  if (chainLength === 0) return [];

  switch (status) {
    case "DRAFT":
    case "ARCHIVED":
      // Steps are materialised on submit, so an unsubmitted bill has none.
      return [];
    case "AWAITING_APPROVAL": {
      const approved = Math.min(approvedSteps, chainLength - 1);
      return Array.from({ length: chainLength }, (_, index) =>
        index < approved ? "APPROVED" : "PENDING",
      );
    }
    case "APPROVED":
    case "PAID":
      return Array.from({ length: chainLength }, () => "APPROVED");
    case "REJECTED":
      return Array.from({ length: chainLength }, (_, index) =>
        index < chainLength - 1 ? "APPROVED" : "REJECTED",
      );
    default:
      return [];
  }
}

function sourceMessage(spec: SeedBill): string {
  switch (spec.source) {
    case "OCR":
      return "created this bill from a scanned invoice";
    case "CSV":
      return "created this bill from a CSV import";
    case "EMAIL":
      return "created this bill from a forwarded email";
    case "RECURRING":
      return "generated this bill from a recurring template";
    default:
      return ACTIVITY_MESSAGES.CREATED!;
  }
}

function paymentReference(method: string): string {
  const n = Math.floor(random() * 900000) + 100000;
  switch (method) {
    case "CHECK":
      return `CHK-${n}`;
    case "WIRE":
      return `WIRE-${n}`;
    case "CARD":
      return `CARD-${n}`;
    default:
      return `ACH-${n}`;
  }
}

async function report() {
  const [
    users,
    glAccounts,
    vendors,
    policyCount,
    policySteps,
    bills,
    lineItems,
    lineItemSplits,
    allocationTemplates,
    allocationTemplateSplits,
    recurringBills,
    recurringBillLineItems,
    ocrExtractions,
    payments,
    approvalSteps,
    activities,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.glAccount.count(),
    prisma.vendor.count(),
    prisma.approvalPolicy.count(),
    prisma.approvalPolicyStep.count(),
    prisma.bill.count(),
    prisma.lineItem.count(),
    prisma.lineItemSplit.count(),
    prisma.allocationTemplate.count(),
    prisma.allocationTemplateSplit.count(),
    prisma.recurringBill.count(),
    prisma.recurringBillLineItem.count(),
    prisma.ocrExtraction.count(),
    prisma.payment.count(),
    prisma.approvalStep.count(),
    prisma.activity.count(),
  ]);

  const dueRecurring = await prisma.recurringBill.count({
    where: { active: true, nextRunDate: { lte: new Date() } },
  });

  const byStatus = await prisma.bill.groupBy({
    by: ["status"],
    _count: { _all: true },
    orderBy: { status: "asc" },
  });

  const rows: [string, number][] = [
    ["users", users],
    ["gl_accounts", glAccounts],
    ["vendors", vendors],
    ["approval_policies", policyCount],
    ["approval_policy_steps", policySteps],
    ["bills", bills],
    ["line_items", lineItems],
    ["line_item_splits", lineItemSplits],
    ["allocation_templates", allocationTemplates],
    ["allocation_template_splits", allocationTemplateSplits],
    ["recurring_bills", recurringBills],
    ["recurring_bill_line_items", recurringBillLineItems],
    ["ocr_extractions", ocrExtractions],
    ["payments", payments],
    ["approval_steps", approvalSteps],
    ["activities", activities],
  ];

  console.log("Row counts");
  console.log("──────────────────────────────────");
  for (const [label, count] of rows) {
    console.log(`  ${label.padEnd(28)} ${String(count).padStart(5)}`);
  }

  console.log("\nBills by status");
  console.log("──────────────────────────────────");
  for (const row of byStatus) {
    console.log(
      `  ${row.status.padEnd(24)} ${String(row._count._all).padStart(5)}`,
    );
  }

  console.log(
    `\n${dueRecurring} recurring bill template(s) already due — "generate now" produces a draft immediately.`,
  );
  console.log("\nSeed complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
