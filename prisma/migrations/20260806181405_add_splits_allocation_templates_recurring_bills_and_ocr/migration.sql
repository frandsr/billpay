-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUALLY');

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "recurringBillId" TEXT;

-- CreateTable
CREATE TABLE "LineItemSplit" (
    "id" TEXT NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "glAccountId" TEXT NOT NULL,
    "department" TEXT,
    "amountCents" INTEGER NOT NULL,
    "percentBasisPoints" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineItemSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllocationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationTemplateSplit" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "glAccountId" TEXT NOT NULL,
    "department" TEXT,
    "percentBasisPoints" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AllocationTemplateSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringBill" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paymentTerms" "PaymentTerms" NOT NULL DEFAULT 'NET_30',
    "memo" TEXT,
    "frequency" "RecurringFrequency" NOT NULL DEFAULT 'MONTHLY',
    "nextRunDate" TIMESTAMP(3) NOT NULL,
    "dayOfMonth" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "lastGeneratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringBillLineItem" (
    "id" TEXT NOT NULL,
    "recurringBillId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "glAccountId" TEXT,
    "department" TEXT,
    "lineType" "LineType" NOT NULL DEFAULT 'EXPENSE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RecurringBillLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrExtraction" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "rawResult" JSONB NOT NULL,
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT NOT NULL,
    "confidenceBasisPoints" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcrExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LineItemSplit_lineItemId_sortOrder_idx" ON "LineItemSplit"("lineItemId", "sortOrder");

-- CreateIndex
CREATE INDEX "LineItemSplit_glAccountId_idx" ON "LineItemSplit"("glAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "AllocationTemplate_name_key" ON "AllocationTemplate"("name");

-- CreateIndex
CREATE INDEX "AllocationTemplate_active_idx" ON "AllocationTemplate"("active");

-- CreateIndex
CREATE INDEX "AllocationTemplateSplit_glAccountId_idx" ON "AllocationTemplateSplit"("glAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "AllocationTemplateSplit_templateId_sortOrder_key" ON "AllocationTemplateSplit"("templateId", "sortOrder");

-- CreateIndex
CREATE INDEX "RecurringBill_active_nextRunDate_idx" ON "RecurringBill"("active", "nextRunDate");

-- CreateIndex
CREATE INDEX "RecurringBill_vendorId_idx" ON "RecurringBill"("vendorId");

-- CreateIndex
CREATE INDEX "RecurringBill_createdById_idx" ON "RecurringBill"("createdById");

-- CreateIndex
CREATE INDEX "RecurringBillLineItem_recurringBillId_sortOrder_idx" ON "RecurringBillLineItem"("recurringBillId", "sortOrder");

-- CreateIndex
CREATE INDEX "RecurringBillLineItem_glAccountId_idx" ON "RecurringBillLineItem"("glAccountId");

-- CreateIndex
CREATE INDEX "OcrExtraction_billId_extractedAt_idx" ON "OcrExtraction"("billId", "extractedAt");

-- CreateIndex
CREATE INDEX "Bill_recurringBillId_idx" ON "Bill"("recurringBillId");

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_recurringBillId_fkey" FOREIGN KEY ("recurringBillId") REFERENCES "RecurringBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineItemSplit" ADD CONSTRAINT "LineItemSplit_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "LineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineItemSplit" ADD CONSTRAINT "LineItemSplit_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationTemplateSplit" ADD CONSTRAINT "AllocationTemplateSplit_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AllocationTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationTemplateSplit" ADD CONSTRAINT "AllocationTemplateSplit_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringBill" ADD CONSTRAINT "RecurringBill_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringBill" ADD CONSTRAINT "RecurringBill_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringBillLineItem" ADD CONSTRAINT "RecurringBillLineItem_recurringBillId_fkey" FOREIGN KEY ("recurringBillId") REFERENCES "RecurringBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringBillLineItem" ADD CONSTRAINT "RecurringBillLineItem_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "GlAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrExtraction" ADD CONSTRAINT "OcrExtraction_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
