/**
 * The audit trail: who did what to this bill, and when.
 *
 * Reverse-chronological — `billDetailInclude` already orders `activities` by
 * `createdAt desc`, so the newest entry is first without a second sort.
 *
 * A Server Component on purpose: relative timestamps are rendered once, on the
 * server, so SSR and hydration cannot disagree about what "just now" means.
 * The only interactive part, the comment box, is its own client island.
 */

import { History } from "lucide-react";

import { activityMeta } from "@/components/activity/activity-meta";
import { CommentBox } from "@/components/activity/comment-box";
import { EmptyState } from "@/components/common/empty-state";
import { UserAvatar } from "@/components/shell/user-avatar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getCurrentUser } from "@/lib/current-user";
import { formatDateTime, formatRelativeTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { BillDetail, BillDetailActivity } from "@/server/bill-detail";

export interface ActivityFeedProps {
  bill: BillDetail;
}

export async function ActivityFeed({ bill }: ActivityFeedProps) {
  const currentUser = await getCurrentUser();
  const activities = bill.activities;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <History className="text-muted-foreground size-4" />
          <p className="text-sm font-medium">Activity</p>
          <span className="text-muted-foreground text-xs">
            {activities.length}{" "}
            {activities.length === 1 ? "entry" : "entries"}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pb-(--card-spacing)">
        <CommentBox billId={bill.id} currentUser={currentUser} />

        <Separator />

        {activities.length === 0 ? (
          <EmptyState
            icon={History}
            title="Nothing has happened yet"
            description="Edits, approvals, payments and comments all land here."
          />
        ) : (
          <ol className="space-y-0">
            {activities.map((activity, index) => (
              <ActivityRow
                key={activity.id}
                activity={activity}
                isLast={index === activities.length - 1}
                isCurrentUser={activity.userId === currentUser.id}
              />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityRow({
  activity,
  isLast,
  isCurrentUser,
}: {
  activity: BillDetailActivity;
  isLast: boolean;
  isCurrentUser: boolean;
}) {
  const meta = activityMeta(activity.type);
  const Icon = meta.icon;
  const isComment = activity.type === "COMMENTED";
  const actor = activity.user;

  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {/* Timeline connector — drawn behind the medallion, stopped on the last row. */}
      {isLast ? null : (
        <span
          aria-hidden
          className="bg-border absolute top-8 bottom-0 left-[13px] w-px"
        />
      )}

      <span className="relative shrink-0">
        {actor ? (
          <UserAvatar
            initials={actor.initials}
            color={actor.avatarColor}
            title={actor.name}
          />
        ) : (
          <span
            className={cn(
              "flex size-7 items-center justify-center rounded-full",
              meta.className,
            )}
          >
            <Icon className="size-3.5" />
          </span>
        )}
        {actor ? (
          <span
            aria-hidden
            className={cn(
              "ring-card absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full ring-2",
              meta.className,
            )}
          >
            <Icon className="size-2.5" />
          </span>
        ) : null}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium">
            {actor ? (isCurrentUser ? "You" : actor.name) : "System"}
          </span>
          <span className="text-muted-foreground text-xs">{meta.label}</span>
          <span
            className="text-muted-foreground ml-auto text-xs whitespace-nowrap"
            title={formatDateTime(activity.createdAt)}
          >
            {formatRelativeTime(activity.createdAt)}
          </span>
        </div>

        {isComment ? (
          <p className="bg-muted/60 mt-1.5 rounded-lg rounded-tl-none px-3 py-2 text-sm whitespace-pre-wrap">
            {activity.message}
          </p>
        ) : (
          <p className="text-muted-foreground mt-0.5 text-sm">
            {activity.message}
          </p>
        )}
      </div>
    </li>
  );
}
