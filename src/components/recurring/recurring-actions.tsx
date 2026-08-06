"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Pause, Play, Zap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  generateAllDueRecurringBills,
  generateNow,
  setRecurringBillActive,
} from "@/server/actions/recurring";
import type { GenerationSummary } from "@/components/recurring/types";

/**
 * The write controls on the recurring pages.
 *
 * Generation is an explicit click, not a background job. A scheduler would be
 * the production answer, but it makes the feature invisible until the clock
 * comes round — and an AP lead wants to decide *when* a period's drafts land
 * anyway. The server action is the same one a cron job would call.
 */

/** Turn a generation run into a sentence a person can act on. */
function describeGeneration(summary: GenerationSummary): {
  message: string;
  description?: string;
  created: boolean;
} {
  if (summary.billsCreated > 0) {
    const plural = summary.billsCreated === 1 ? "draft bill" : "draft bills";
    const skipped =
      summary.alreadyGenerated > 0
        ? ` ${summary.alreadyGenerated} period(s) were already generated and were skipped.`
        : "";
    return {
      created: true,
      message: `${summary.billsCreated} ${plural} created`,
      description: `Coded from the template and waiting in Bills as a draft.${skipped}`,
    };
  }

  if (summary.alreadyGenerated > 0) {
    return {
      created: false,
      message: "Already generated",
      description:
        "Every period this template owes already has a bill, so nothing was created.",
    };
  }

  return {
    created: false,
    message: "Nothing due",
    description: "No template owes a bill as of today.",
  };
}

export interface GenerateNowButtonProps {
  templateId: string;
  /** A paused template owes nothing; the button says so rather than failing. */
  paused?: boolean;
  due?: boolean;
  size?: "sm" | "default";
}

export function GenerateNowButton({
  templateId,
  paused = false,
  due = false,
  size = "sm",
}: GenerateNowButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await generateNow(templateId);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const { message, description, created } = describeGeneration(result.data);
      if (created) toast.success(message, { description });
      else toast.info(message, { description });

      router.refresh();
    });
  }

  return (
    <Button
      size={size}
      variant={due ? "default" : "outline"}
      onClick={run}
      disabled={isPending || paused}
      title={
        paused
          ? "This template is paused. Resume it to generate a bill."
          : "Create the draft bills this template currently owes"
      }
    >
      <Zap data-icon="inline-start" />
      {isPending ? "Generating…" : "Generate now"}
    </Button>
  );
}

export interface GenerateAllDueButtonProps {
  /** How many templates are due, for the label. */
  dueCount: number;
}

export function GenerateAllDueButton({ dueCount }: GenerateAllDueButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await generateAllDueRecurringBills();

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const { message, description, created } = describeGeneration(result.data);
      if (created) toast.success(message, { description });
      else toast.info(message, { description });

      router.refresh();
    });
  }

  return (
    <Button onClick={run} disabled={isPending || dueCount === 0}>
      <Zap data-icon="inline-start" />
      {isPending
        ? "Generating…"
        : dueCount > 0
          ? `Generate all due (${dueCount})`
          : "Generate all due"}
    </Button>
  );
}

export interface PauseToggleButtonProps {
  templateId: string;
  active: boolean;
  size?: "sm" | "default";
}

export function PauseToggleButton({
  templateId,
  active,
  size = "sm",
}: PauseToggleButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const result = await setRecurringBillActive(templateId, !active);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(
        result.data.active ? "Template resumed" : "Template paused",
        {
          description: result.data.active
            ? "It will owe a bill again from its next run date."
            : "It owes nothing until it is resumed.",
        },
      );

      router.refresh();
    });
  }

  return (
    <Button
      size={size}
      variant="ghost"
      onClick={toggle}
      disabled={isPending}
      title={active ? "Pause this template" : "Resume this template"}
    >
      {active ? (
        <Pause data-icon="inline-start" />
      ) : (
        <Play data-icon="inline-start" />
      )}
      {active ? "Pause" : "Resume"}
    </Button>
  );
}
