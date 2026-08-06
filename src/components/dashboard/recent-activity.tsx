import Link from "next/link";
import { History } from "lucide-react";

import { activityMeta } from "@/components/activity/activity-meta";
import { EmptyState } from "@/components/common/empty-state";
import { UserAvatar } from "@/components/shell/user-avatar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { RecentActivity } from "@/server/queries/dashboard";

export interface RecentActivityFeedProps {
  activity: RecentActivity[];
}

/**
 * The newest entries of the audit trail, across every bill.
 *
 * It reuses `ACTIVITY_META` from the bill's own activity feed rather than
 * inventing a second icon-and-colour vocabulary, so "Approved" looks the same
 * here as it does on the bill. Every row links to the bill it belongs to —
 * an audit trail nobody can follow back to the record is decoration.
 */
export function RecentActivityFeed({ activity }: RecentActivityFeedProps) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <History className="text-muted-foreground size-4" />
          Recent activity
        </CardTitle>
      </CardHeader>

      <CardContent>
        {activity.length === 0 ? (
          <EmptyState
            icon={History}
            title="Nothing has happened yet"
            description="Every create, edit, approval and payment is recorded here as it happens."
            className="py-8"
          />
        ) : (
          <ol className="space-y-3">
            {activity.map((entry) => {
              const meta = activityMeta(entry.type);
              const Icon = meta.icon;

              return (
                <li key={entry.id} className="flex gap-2.5">
                  <span
                    className={cn(
                      "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
                      meta.className,
                    )}
                  >
                    <Icon className="size-3" />
                  </span>

                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm leading-snug">
                      <Link
                        href={`/bills/${entry.bill.id}`}
                        className="font-medium hover:underline"
                      >
                        {entry.bill.vendor.name} · {entry.bill.billNumber}
                      </Link>
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {entry.message}
                    </p>
                    <p className="text-muted-foreground/80 flex items-center gap-1.5 text-[11px]">
                      {entry.user ? (
                        <UserAvatar
                          initials={entry.user.initials}
                          color={entry.user.avatarColor}
                          className="size-4 text-[8px]"
                        />
                      ) : null}
                      {entry.user?.name ?? "System"}
                      <span aria-hidden>·</span>
                      {formatRelativeTime(entry.createdAt)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
