import type { User } from "@prisma/client";
import {
  ArrowRight,
  CheckCircle2,
  CircleDot,
  CircleSlash,
  Clock,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from "lucide-react";

import {
  ApprovalDecisionForm,
  ReopenBillButton,
  SubmitForApprovalButton,
} from "@/components/approvals/approval-actions";
import {
  APPROVAL_STEP_STATUS_LABELS,
  canDecideCurrentStep,
  currentPendingStep,
} from "@/components/approvals/approval-chain";
import { getApprovalPreview } from "@/components/approvals/approval-preview";
import { UserAvatar } from "@/components/shell/user-avatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { approvalProgress } from "@/lib/approval-policy";
import { draftReadinessDetail } from "@/lib/bill-status";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { BillDetail, BillDetailApprovalStep } from "@/server/bill-detail";

/**
 * The approval chain — the control that makes this payables software rather
 * than a list of invoices.
 *
 * What it shows depends on where the bill is:
 *  * DRAFT — the routing PREVIEW (which policy applies and who will approve, in
 *    order) plus the submit control, disabled while the draft is `Missing info`.
 *  * AWAITING_APPROVAL — the snapshotted chain with "X of N approved", the
 *    current step called out, and approve/reject offered ONLY to the approver
 *    whose turn it is.
 *  * APPROVED / PAID — the completed chain, or a note that the amount matched a
 *    policy with no steps and the bill was auto-approved.
 *  * REJECTED — where the chain stopped, why, and the way back to DRAFT.
 *
 * The decision on who may act comes from `refuseDecision` in `approval-chain.ts`,
 * the same predicate the server actions enforce, so the buttons and the rules
 * cannot drift apart. Rendering is the courtesy; the server is the control.
 */
export interface ApprovalPanelProps {
  bill: BillDetail;
  currentUser: User;
}

export async function ApprovalPanel({ bill, currentUser }: ApprovalPanelProps) {
  const steps = bill.approvalSteps;
  const progress = approvalProgress(steps);
  const current = currentPendingStep(steps);
  const isMyTurn = canDecideCurrentStep(bill.status, steps, currentUser.id);
  const rejectedStep = steps.find((step) => step.status === "REJECTED") ?? null;

  // Only a draft needs to know where it WOULD go; every other status is already
  // governed by the chain snapshotted on the bill.
  const preview = bill.status === "DRAFT" ? await getApprovalPreview(bill.totalCents) : null;

  const readiness = draftReadinessDetail(bill);
  const showChain = steps.length > 0 && bill.status !== "DRAFT";

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="text-muted-foreground size-4" />
          Approvals
        </CardTitle>
        {steps.length > 0 ? (
          <CardAction>
            <Badge variant="outline" className="font-mono text-[11px]">
              {progress.approved} of {progress.total} approved
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        {showChain ? (
          <div className="space-y-3">
            <Progress
              value={
                progress.total === 0
                  ? 0
                  : (progress.approved / progress.total) * 100
              }
              aria-label={progress.label}
            />
            <ol className="space-y-2">
              {steps.map((step) => (
                <ApprovalStepRow
                  key={step.id}
                  step={step}
                  totalSteps={steps.length}
                  isCurrent={current?.id === step.id}
                  isActingUser={step.approverId === currentUser.id}
                  chainStopped={bill.status === "REJECTED"}
                />
              ))}
            </ol>
          </div>
        ) : null}

        {bill.status === "DRAFT" && preview ? (
          <DraftRouting
            billId={bill.id}
            preview={preview}
            readiness={readiness}
            previousRejection={rejectedStep}
          />
        ) : null}

        {bill.status === "AWAITING_APPROVAL" && current ? (
          isMyTurn ? (
            <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-800/60 dark:bg-amber-950/30">
              <p className="text-sm font-medium">
                Your approval is needed — step {current.stepOrder} of{" "}
                {steps.length}.
              </p>
              <ApprovalDecisionForm
                billId={bill.id}
                stepId={current.id}
                stepOrder={current.stepOrder}
                totalSteps={steps.length}
              />
            </div>
          ) : (
            <Alert>
              <Clock />
              <AlertTitle>
                Waiting on {current.approver.name} — step {current.stepOrder} of{" "}
                {steps.length}
              </AlertTitle>
              <AlertDescription>
                Only {current.approver.name} can decide this step. Switch user in
                the top bar to act as them.
              </AlertDescription>
            </Alert>
          )
        ) : null}

        {bill.status === "APPROVED" || bill.status === "PAID" ? (
          steps.length === 0 ? (
            <Alert>
              <CheckCircle2 />
              <AlertTitle>Auto-approved</AlertTitle>
              <AlertDescription>
                This amount matched an approval policy with no steps, so the bill
                was approved on submission without an approver chain.
              </AlertDescription>
            </Alert>
          ) : (
            <p className="text-muted-foreground text-sm">
              Fully approved
              {bill.approvedAt ? ` on ${formatDate(bill.approvedAt)}` : ""} —
              every step in the chain signed off.
            </p>
          )
        ) : null}

        {bill.status === "REJECTED" ? (
          <div className="space-y-3">
            <Alert variant="destructive">
              <XCircle />
              <AlertTitle>
                Rejected
                {rejectedStep
                  ? ` by ${rejectedStep.approver.name} at step ${rejectedStep.stepOrder} of ${steps.length}`
                  : ""}
              </AlertTitle>
              <AlertDescription>
                {rejectedStep?.note
                  ? `“${rejectedStep.note}”`
                  : "No reason was recorded."}
              </AlertDescription>
            </Alert>
            <p className="text-muted-foreground text-sm">
              Send it back to draft to correct it. Re-submitting rebuilds the
              chain from the policies as they stand then.
            </p>
            <ReopenBillButton billId={bill.id} />
          </div>
        ) : null}

        {bill.status === "ARCHIVED" ? (
          <p className="text-muted-foreground text-sm">
            This bill was archived and left the approval flow without being paid.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// One step of the snapshotted chain
// ---------------------------------------------------------------------------

interface ApprovalStepRowProps {
  step: BillDetailApprovalStep;
  totalSteps: number;
  isCurrent: boolean;
  isActingUser: boolean;
  chainStopped: boolean;
}

function ApprovalStepRow({
  step,
  totalSteps,
  isCurrent,
  isActingUser,
  chainStopped,
}: ApprovalStepRowProps) {
  const state = step.status;

  const statusLine =
    state === "APPROVED"
      ? `Approved${step.decidedAt ? ` on ${formatDate(step.decidedAt)}` : ""}`
      : state === "REJECTED"
        ? `Rejected${step.decidedAt ? ` on ${formatDate(step.decidedAt)}` : ""}`
        : isCurrent
          ? isActingUser
            ? "Your turn — this step is waiting on you"
            : "Waiting on this approver"
          : chainStopped
            ? "Never reached — the chain stopped earlier"
            : "Not reached yet — approval is sequential";

  return (
    <li
      className={cn(
        "rounded-lg border p-3 transition-colors",
        isCurrent
          ? "border-amber-400 bg-amber-50/70 shadow-sm dark:border-amber-700 dark:bg-amber-950/30"
          : "border-border/70 bg-muted/30",
        state === "REJECTED" &&
          "border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30",
      )}
      aria-current={isCurrent ? "step" : undefined}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
            state === "APPROVED"
              ? "bg-emerald-600 text-white"
              : state === "REJECTED"
                ? "bg-red-600 text-white"
                : isCurrent
                  ? "bg-amber-500 text-white"
                  : "bg-muted text-muted-foreground",
          )}
          aria-hidden
        >
          {step.stepOrder}
        </span>

        <UserAvatar
          initials={step.approver.initials}
          color={step.approver.avatarColor}
          title={step.approver.name}
          className="size-7"
        />

        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm leading-tight font-medium">
            {step.approver.name}
            {step.approver.title ? (
              <span className="text-muted-foreground font-normal">
                {" "}
                · {step.approver.title}
              </span>
            ) : null}
          </p>
          <p className="text-muted-foreground flex items-center gap-1 text-xs">
            <StepIcon
              state={state}
              isCurrent={isCurrent}
              chainStopped={chainStopped}
            />
            {statusLine}
            <span className="text-muted-foreground/70">
              · step {step.stepOrder} of {totalSteps}
            </span>
          </p>
          {step.note ? (
            <p className="text-foreground/80 border-border/70 mt-1 border-l-2 pl-2 text-xs italic">
              “{step.note}”
            </p>
          ) : null}
        </div>

        <Badge
          variant={state === "REJECTED" ? "destructive" : "outline"}
          className="shrink-0"
        >
          {APPROVAL_STEP_STATUS_LABELS[state]}
        </Badge>
      </div>
    </li>
  );
}

function StepIcon({
  state,
  isCurrent,
  chainStopped,
}: {
  state: BillDetailApprovalStep["status"];
  isCurrent: boolean;
  chainStopped: boolean;
}) {
  if (state === "APPROVED")
    return <CheckCircle2 className="size-3.5 text-emerald-600" />;
  if (state === "REJECTED")
    return <XCircle className="size-3.5 text-red-600" />;
  if (isCurrent) return <CircleDot className="size-3.5 text-amber-600" />;
  if (chainStopped) return <CircleSlash className="size-3.5" />;
  return <Clock className="size-3.5" />;
}

// ---------------------------------------------------------------------------
// DRAFT — where this bill will go, and the control that sends it there
// ---------------------------------------------------------------------------

interface DraftRoutingProps {
  billId: string;
  preview: Awaited<ReturnType<typeof getApprovalPreview>>;
  readiness: ReturnType<typeof draftReadinessDetail>;
  /** A step left over from a round that was rejected and returned to draft. */
  previousRejection: BillDetailApprovalStep | null;
}

function DraftRouting({
  billId,
  preview,
  readiness,
  previousRejection,
}: DraftRoutingProps) {
  const ready = readiness.state === "READY";

  return (
    <div className="space-y-4">
      {previousRejection ? (
        <Alert>
          <TriangleAlert />
          <AlertTitle>
            Came back from {previousRejection.approver.name}
          </AlertTitle>
          <AlertDescription>
            {previousRejection.note
              ? `“${previousRejection.note}” — fix it and submit again.`
              : "Fix it and submit again."}
          </AlertDescription>
        </Alert>
      ) : null}

      {ready ? null : (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Missing info — this draft cannot be submitted</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-4">
              {readiness.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Routing preview
        </p>

        {preview.autoApproved ? (
          <p className="text-sm">
            No approvers needed for this amount
            {preview.policyName ? (
              <>
                {" "}
                — the <span className="font-medium">{preview.policyName}</span>{" "}
                policy matches
              </>
            ) : null}
            . Submitting approves the bill immediately.
          </p>
        ) : (
          <>
            <p className="text-sm">
              Matches the{" "}
              <span className="font-medium">{preview.policyName}</span> policy —{" "}
              {preview.steps.length}{" "}
              {preview.steps.length === 1 ? "approver" : "approvers"}, in order.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {preview.steps.map((step, index) => (
                <span key={step.approverId} className="flex items-center gap-2">
                  {index > 0 ? (
                    <ArrowRight className="text-muted-foreground size-3.5" />
                  ) : null}
                  <span className="bg-muted/50 flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1">
                    <UserAvatar
                      initials={step.initials}
                      color={step.avatarColor}
                      className="size-5 text-[10px]"
                    />
                    <span className="text-xs">
                      {step.name}
                      {step.title ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {step.title}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </span>
              ))}
            </div>
          </>
        )}

        <p className="text-muted-foreground text-xs">
          The chain is copied onto the bill when you submit, so later policy
          changes never rewrite a bill already in flight.
        </p>
      </div>

      <SubmitForApprovalButton
        billId={billId}
        ready={ready}
        autoApproved={preview.autoApproved}
      />
    </div>
  );
}
