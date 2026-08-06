import { Badge } from "@/components/ui/badge";
import {
  BILL_STATUS_META,
  DRAFT_READINESS_META,
  PAYMENT_STATUS_META,
  type DraftReadiness,
} from "@/lib/bill-status";
import type { BillStatus, PaymentStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";

/**
 * The single rendering of bill status in the app.
 *
 * Every label and colour comes from the display metadata in
 * `@/lib/bill-status` — the module that also owns the transition table — so the
 * inbox, the bill detail header and the activity feed cannot drift into three
 * different palettes or three spellings of "Awaiting approval".
 *
 * Owned by vertical A and rendered by vertical B. It is a Server Component on
 * purpose: no state, no handlers, nothing to hydrate. If a new variant is
 * needed, add it here rather than styling a `<Badge>` inline somewhere else.
 */

export interface BillStatusBadgeProps {
  status: BillStatus;
  /** Attach the glossary description as a native tooltip. Default true. */
  withTooltip?: boolean;
  className?: string;
}

export function BillStatusBadge({
  status,
  withTooltip = true,
  className,
}: BillStatusBadgeProps) {
  const meta = BILL_STATUS_META[status];

  return (
    <Badge
      variant={meta.badgeVariant === "ghost" ? "outline" : meta.badgeVariant}
      className={cn(meta.badgeClassName, className)}
      title={withTooltip ? meta.description : undefined}
    >
      {meta.label}
    </Badge>
  );
}

export interface DraftReadinessBadgeProps {
  readiness: DraftReadiness;
  /**
   * The reasons from `draftReadinessDetail().issues`, surfaced as a tooltip so
   * "Missing info" always answers "missing what?".
   */
  issues?: string[];
  className?: string;
}

/**
 * `Missing info` / `Ready` — DERIVED flags on a draft, never stored statuses.
 * Rendered alongside the Draft badge, never instead of it.
 */
export function DraftReadinessBadge({
  readiness,
  issues,
  className,
}: DraftReadinessBadgeProps) {
  const meta = DRAFT_READINESS_META[readiness];
  const tooltip =
    issues && issues.length > 0 ? issues.join(" · ") : meta.description;

  return (
    <Badge
      variant={meta.badgeVariant === "ghost" ? "outline" : meta.badgeVariant}
      className={cn(meta.badgeClassName, className)}
      title={tooltip}
    >
      {meta.label}
    </Badge>
  );
}

export interface PaymentStatusBadgeProps {
  status: PaymentStatus;
  className?: string;
}

/**
 * The Payment's own lifecycle, which is NOT the bill's (ADR 0002). An approved
 * bill with a scheduled payment shows both badges, because they are two facts.
 */
export function PaymentStatusBadge({
  status,
  className,
}: PaymentStatusBadgeProps) {
  const meta = PAYMENT_STATUS_META[status];

  return (
    <Badge
      variant={meta.badgeVariant === "ghost" ? "outline" : meta.badgeVariant}
      className={cn(meta.badgeClassName, className)}
      title={meta.description}
    >
      {meta.label}
    </Badge>
  );
}
