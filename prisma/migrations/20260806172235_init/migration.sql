-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'APPROVER', 'MEMBER');

-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GlAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "PaymentTerms" AS ENUM ('DUE_ON_RECEIPT', 'NET_15', 'NET_30', 'NET_45', 'NET_60', 'NET_90');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'PAID', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BillSource" AS ENUM ('MANUAL', 'OCR', 'CSV', 'EMAIL');

-- CreateEnum
CREATE TYPE "LineType" AS ENUM ('EXPENSE', 'ITEM');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ACH', 'CHECK', 'CARD', 'WIRE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('SCHEDULED', 'INITIATED', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "ApprovalStepStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CREATED', 'UPDATED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAYMENT_SCHEDULED', 'PAID', 'COMMENTED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "title" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "initials" TEXT NOT NULL,
    "avatarColor" TEXT NOT NULL DEFAULT '#525252',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "status" "VendorStatus" NOT NULL DEFAULT 'ACTIVE',
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'US',
    "bankName" TEXT,
    "accountLast4" TEXT,
    "routingLast4" TEXT,
    "defaultPaymentTerms" "PaymentTerms" NOT NULL DEFAULT 'NET_30',
    "defaultGlAccountId" TEXT,
    "taxId" TEXT,
    "is1099" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GlAccountType" NOT NULL DEFAULT 'EXPENSE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL,
    "billNumber" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paymentTerms" "PaymentTerms" NOT NULL DEFAULT 'NET_30',
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "memo" TEXT,
    "status" "BillStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "BillSource" NOT NULL DEFAULT 'MANUAL',
    "invoiceFileUrl" TEXT,
    "invoiceFileName" TEXT,
    "createdById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineItem" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "glAccountId" TEXT,
    "department" TEXT,
    "lineType" "LineType" NOT NULL DEFAULT 'EXPENSE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'ACH',
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "initiatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "PaymentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalPolicy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "minAmountCents" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalPolicyStep" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "approverId" TEXT NOT NULL,

    CONSTRAINT "ApprovalPolicyStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "approverId" TEXT NOT NULL,
    "status" "ApprovalStepStatus" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "ActivityType" NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Vendor_status_idx" ON "Vendor"("status");

-- CreateIndex
CREATE INDEX "Vendor_defaultGlAccountId_idx" ON "Vendor"("defaultGlAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_name_key" ON "Vendor"("name");

-- CreateIndex
CREATE UNIQUE INDEX "GlAccount_code_key" ON "GlAccount"("code");

-- CreateIndex
CREATE INDEX "GlAccount_active_idx" ON "GlAccount"("active");

-- CreateIndex
CREATE INDEX "Bill_status_idx" ON "Bill"("status");

-- CreateIndex
CREATE INDEX "Bill_dueDate_idx" ON "Bill"("dueDate");

-- CreateIndex
CREATE INDEX "Bill_vendorId_idx" ON "Bill"("vendorId");

-- CreateIndex
CREATE INDEX "Bill_status_dueDate_idx" ON "Bill"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_vendorId_billNumber_key" ON "Bill"("vendorId", "billNumber");

-- CreateIndex
CREATE INDEX "LineItem_billId_idx" ON "LineItem"("billId");

-- CreateIndex
CREATE INDEX "LineItem_glAccountId_idx" ON "LineItem"("glAccountId");

-- CreateIndex
CREATE INDEX "Payment_billId_idx" ON "Payment"("billId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_scheduledDate_idx" ON "Payment"("scheduledDate");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalPolicy_name_key" ON "ApprovalPolicy"("name");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_active_priority_idx" ON "ApprovalPolicy"("active", "priority");

-- CreateIndex
CREATE INDEX "ApprovalPolicyStep_approverId_idx" ON "ApprovalPolicyStep"("approverId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalPolicyStep_policyId_stepOrder_key" ON "ApprovalPolicyStep"("policyId", "stepOrder");

-- CreateIndex
CREATE INDEX "ApprovalStep_approverId_status_idx" ON "ApprovalStep"("approverId", "status");

-- CreateIndex
CREATE INDEX "ApprovalStep_billId_idx" ON "ApprovalStep"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalStep_billId_stepOrder_key" ON "ApprovalStep"("billId", "stepOrder");

-- CreateIndex
CREATE INDEX "Activity_billId_createdAt_idx" ON "Activity"("billId", "createdAt");

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_defaultGlAccountId_fkey" FOREIGN KEY ("defaultGlAccountId") REFERENCES "GlAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineItem" ADD CONSTRAINT "LineItem_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineItem" ADD CONSTRAINT "LineItem_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "GlAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicyStep" ADD CONSTRAINT "ApprovalPolicyStep_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ApprovalPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicyStep" ADD CONSTRAINT "ApprovalPolicyStep_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
