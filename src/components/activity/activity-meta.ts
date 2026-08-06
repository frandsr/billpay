import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Banknote,
  CalendarClock,
  CheckCircle2,
  FilePlus2,
  MessageSquare,
  PencilLine,
  Send,
  XCircle,
} from "lucide-react";

/**
 * Display metadata for the audit trail, one entry per `ActivityType` in the
 * schema. Kept as data next to the feed so adding a type is a single line here
 * rather than a new branch in the renderer.
 */

export type ActivityTypeName =
  | "CREATED"
  | "UPDATED"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "PAYMENT_SCHEDULED"
  | "PAID"
  | "COMMENTED"
  | "ARCHIVED";

export interface ActivityMeta {
  /** Short label for the chip next to the actor. */
  label: string;
  icon: LucideIcon;
  /** Colour for the icon medallion. */
  className: string;
}

export const ACTIVITY_META: Record<ActivityTypeName, ActivityMeta> = {
  CREATED: {
    label: "Created",
    icon: FilePlus2,
    className:
      "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  },
  UPDATED: {
    label: "Updated",
    icon: PencilLine,
    className:
      "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  },
  SUBMITTED: {
    label: "Submitted",
    icon: Send,
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300",
  },
  APPROVED: {
    label: "Approved",
    icon: CheckCircle2,
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300",
  },
  REJECTED: {
    label: "Rejected",
    icon: XCircle,
    className: "bg-red-100 text-red-700 dark:bg-red-950/70 dark:text-red-300",
  },
  PAYMENT_SCHEDULED: {
    label: "Payment scheduled",
    icon: CalendarClock,
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300",
  },
  PAID: {
    label: "Paid",
    icon: Banknote,
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300",
  },
  COMMENTED: {
    label: "Comment",
    icon: MessageSquare,
    className:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300",
  },
  ARCHIVED: {
    label: "Archived",
    icon: Archive,
    className:
      "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
  },
};

const FALLBACK: ActivityMeta = ACTIVITY_META.UPDATED;

export function activityMeta(type: string): ActivityMeta {
  return ACTIVITY_META[type as ActivityTypeName] ?? FALLBACK;
}
