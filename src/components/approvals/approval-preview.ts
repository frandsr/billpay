import "server-only";

import { resolveApprovalPolicy } from "@/lib/approval-policy";
import { db } from "@/lib/db";

/**
 * "Where will this bill go when I submit it?" — resolved from the policies as
 * they stand right now.
 *
 * This is a PREVIEW, not a snapshot: nothing is written until the bill is
 * submitted, and the chain that is then copied onto the bill is what governs it
 * from that moment on (ADR 0003). The distinction is worth showing, because it
 * is the reason a policy change only reaches an in-flight bill via re-submission.
 *
 * It is a second query on the bill detail page, which `src/server/bill-detail.ts`
 * asks features to avoid — but policies are not a relation of the bill, so they
 * cannot be folded into `billDetailInclude`, and the panel only asks for the
 * preview while the bill is still a draft (or was rejected back into one).
 */

export interface ApprovalPreviewStep {
  stepOrder: number;
  approverId: string;
  name: string;
  title: string | null;
  initials: string;
  avatarColor: string;
}

export interface ApprovalPreview {
  policyName: string | null;
  policyDescription: string | null;
  steps: ApprovalPreviewStep[];
  /** True when the matching policy has no steps — submitting approves at once. */
  autoApproved: boolean;
}

export async function getApprovalPreview(
  totalCents: number,
): Promise<ApprovalPreview> {
  const policies = await db.approvalPolicy.findMany({
    where: { active: true },
    include: {
      steps: {
        include: { approver: true },
        orderBy: { stepOrder: "asc" },
      },
    },
    orderBy: { priority: "asc" },
  });

  const policy = resolveApprovalPolicy(policies, totalCents);
  const steps = [...(policy?.steps ?? [])]
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map((step, index) => ({
      stepOrder: index + 1,
      approverId: step.approverId,
      name: step.approver.name,
      title: step.approver.title,
      initials: step.approver.initials,
      avatarColor: step.approver.avatarColor,
    }));

  return {
    policyName: policy?.name ?? null,
    policyDescription: policy?.description ?? null,
    steps,
    autoApproved: steps.length === 0,
  };
}
