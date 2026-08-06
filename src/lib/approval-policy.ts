/**
 * Approval policy resolution — a pure function so the seed, the server actions
 * and the UI preview all agree on which policy applies to a bill.
 *
 * Rule: among ACTIVE policies, evaluate by `priority` ASC and take the FIRST
 * whose `minAmountCents` <= the bill total. A policy with zero steps means
 * auto-approve (the bill goes straight from DRAFT to APPROVED on submit).
 *
 * Seed data therefore orders policies as:
 *   priority 10  >= $10,000  Controller then CFO
 *   priority 20  >= $1,000   Controller
 *   priority 30  >= $0       auto-approve
 *
 * PURE MODULE: no Prisma, no React, no `next/*`. Keep it dependency-free even
 * of `@/lib/domain` — `prisma/seed.ts` imports this file directly and the
 * Docker runner ships it to the seed toolchain, so every import here has to
 * survive outside the Next.js module graph.
 */

export interface PolicyLike {
  id: string;
  name: string;
  priority: number;
  minAmountCents: number;
  active: boolean;
  steps?: PolicyStepLike[];
}

export interface PolicyStepLike {
  stepOrder: number;
  approverId: string;
}

/**
 * Pick the policy that governs a bill of `totalCents`.
 * Returns `null` when no active policy matches (treat as auto-approve).
 */
export function resolveApprovalPolicy<T extends PolicyLike>(
  policies: readonly T[],
  totalCents: number,
): T | null {
  const candidates = policies
    .filter((policy) => policy.active && policy.minAmountCents <= totalCents)
    .sort((a, b) => a.priority - b.priority);

  return candidates[0] ?? null;
}

/**
 * The approver chain a bill of `totalCents` must clear, in order.
 * An empty array means auto-approve.
 */
export function resolveApproverChain(
  policies: readonly PolicyLike[],
  totalCents: number,
): PolicyStepLike[] {
  const policy = resolveApprovalPolicy(policies, totalCents);
  if (!policy?.steps) return [];
  return [...policy.steps].sort((a, b) => a.stepOrder - b.stepOrder);
}

export interface ApprovalProgress {
  approved: number;
  total: number;
  /** "2 of 3 approved" — the indicator shown on the bill row and header. */
  label: string;
}

/** Build the "X of N" indicator from a bill's materialised approval steps. */
export function approvalProgress(
  steps: readonly { status: "PENDING" | "APPROVED" | "REJECTED" }[],
): ApprovalProgress {
  const total = steps.length;
  const approved = steps.filter((step) => step.status === "APPROVED").length;
  return { approved, total, label: `${approved} of ${total} approved` };
}
