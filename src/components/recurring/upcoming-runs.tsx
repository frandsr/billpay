import { CalendarClock } from "lucide-react";

import { formatDate, formatShortDate } from "@/lib/dates";
import { upcomingOccurrences, type RecurringSchedule } from "@/lib/recurring";
import { cn } from "@/lib/utils";

export interface UpcomingRunsProps {
  schedule: RecurringSchedule;
  /** How many occurrences to preview, `nextRunDate` included. */
  count?: number;
  /** Render the full "Mar 14, 2026" form instead of "Mar 14". */
  long?: boolean;
  className?: string;
}

/**
 * The next few occurrences of a schedule, rendered as a chain.
 *
 * A cadence stated as "Monthly, day 31" is a rule the reader has to evaluate in
 * their head — and evaluate wrongly, because month-end is clamped and then
 * restored. Showing the dates makes the rule legible: Jan 31 → Feb 28 → Mar 31
 * is the behaviour, spelled out.
 */
export function UpcomingRuns({
  schedule,
  count = 3,
  long = false,
  className,
}: UpcomingRunsProps) {
  const occurrences = upcomingOccurrences(schedule, count);
  const format = long ? formatDate : formatShortDate;

  return (
    <div
      className={cn(
        "text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs",
        className,
      )}
    >
      <CalendarClock className="size-3.5 shrink-0" />
      <span className="font-medium">Next runs</span>
      {occurrences.map((occurrence, index) => (
        <span key={occurrence.toISOString()} className="flex items-center gap-1.5">
          {index > 0 ? (
            <span aria-hidden className="text-muted-foreground/50">
              →
            </span>
          ) : null}
          <span
            className={cn(
              "bg-muted rounded px-1.5 py-0.5 tabular-nums",
              index === 0 && "text-foreground font-medium",
            )}
          >
            {format(occurrence)}
          </span>
        </span>
      ))}
    </div>
  );
}
