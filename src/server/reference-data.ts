import "server-only";

import type { ApprovalPolicy, GlAccount, Vendor } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * Small shared reads used by more than one feature phase (GL pickers, vendor
 * pickers, the approval preview). Owned by the foundation phase.
 */

export async function getActiveGlAccounts(): Promise<GlAccount[]> {
  return db.glAccount.findMany({
    where: { active: true },
    orderBy: { code: "asc" },
  });
}

export async function getActiveVendors(): Promise<Vendor[]> {
  return db.vendor.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
  });
}

export type ApprovalPolicyWithSteps = ApprovalPolicy & {
  steps: { id: string; stepOrder: number; approverId: string }[];
};

/** Active policies with their steps, ready for `resolveApprovalPolicy`. */
export async function getApprovalPolicies(): Promise<ApprovalPolicyWithSteps[]> {
  return db.approvalPolicy.findMany({
    where: { active: true },
    orderBy: { priority: "asc" },
    include: {
      steps: {
        orderBy: { stepOrder: "asc" },
        select: { id: true, stepOrder: true, approverId: true },
      },
    },
  });
}
