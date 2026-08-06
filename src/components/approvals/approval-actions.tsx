"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Send, Undo2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  approveApprovalStep,
  rejectBillAtStep,
  returnBillToDraft,
  submitBillForApproval,
} from "@/server/actions/approvals";

/**
 * The interactive parts of the approval panel.
 *
 * Each one calls a server action and shows whatever the server says. The
 * buttons are rendered only when the acting user may use them, but that is a
 * courtesy — the server re-derives the same answer from `getCurrentUser()` and
 * the stored chain, so a request forged past the UI is refused with a message
 * and lands here as a red toast.
 */

// ---------------------------------------------------------------------------
// Submit for approval
// ---------------------------------------------------------------------------

export interface SubmitForApprovalButtonProps {
  billId: string;
  /** False while the draft is `Missing info`; the server checks again anyway. */
  ready: boolean;
  autoApproved: boolean;
}

export function SubmitForApprovalButton({
  billId,
  ready,
  autoApproved,
}: SubmitForApprovalButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await submitBillForApproval(billId);
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <Button onClick={submit} disabled={!ready || isPending} size="lg">
      <Send data-icon="inline-start" />
      {isPending
        ? "Submitting…"
        : autoApproved
          ? "Submit — approves immediately"
          : "Submit for approval"}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Approve / reject the current step
// ---------------------------------------------------------------------------

export interface ApprovalDecisionFormProps {
  billId: string;
  stepId: string;
  stepOrder: number;
  totalSteps: number;
}

/**
 * One note box, two decisions. The note is optional on approval and required on
 * rejection — a rejection with no reason gives the AP clerk nothing to act on,
 * and the server refuses it too.
 */
export function ApprovalDecisionForm({
  billId,
  stepId,
  stepOrder,
  totalSteps,
}: ApprovalDecisionFormProps) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const [noteRequired, setNoteRequired] = useState(false);

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(result.message);
        setNote("");
        setNoteRequired(false);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  function approve() {
    run(() => approveApprovalStep(billId, stepId, note));
  }

  function reject() {
    if (note.trim() === "") {
      setNoteRequired(true);
      toast.error("Add a reason before rejecting this bill.");
      return;
    }
    run(() => rejectBillAtStep(billId, stepId, note));
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
          if (noteRequired) setNoteRequired(false);
        }}
        rows={2}
        aria-invalid={noteRequired}
        aria-label={`Note for step ${stepOrder} of ${totalSteps}`}
        placeholder="Add a note — optional to approve, required to reject."
        disabled={isPending}
      />
      <div className="flex flex-wrap gap-2">
        <Button onClick={approve} disabled={isPending} size="lg">
          <Check data-icon="inline-start" />
          {isPending ? "Working…" : `Approve step ${stepOrder} of ${totalSteps}`}
        </Button>
        <Button
          onClick={reject}
          disabled={isPending}
          size="lg"
          variant="destructive"
        >
          <X data-icon="inline-start" />
          Reject bill
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Rejecting at any step sends the whole bill back — it does not skip to the
        next approver.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reopen a rejected bill
// ---------------------------------------------------------------------------

export function ReopenBillButton({ billId }: { billId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function reopen() {
    startTransition(async () => {
      const result = await returnBillToDraft(billId);
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <Button onClick={reopen} disabled={isPending} variant="outline" size="lg">
      <Undo2 data-icon="inline-start" />
      {isPending ? "Reopening…" : "Return to draft"}
    </Button>
  );
}
