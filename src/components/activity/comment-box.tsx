"use client";

/**
 * Comment box for the audit trail. Appends an `Activity` of type `COMMENTED`
 * attributed to the acting user (`getCurrentUser()` on the server), so a
 * comment is one more row in the same trail as an approval or a payment —
 * not a parallel notes feature.
 */

import { useRef, useState, useTransition } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@prisma/client";

import { UserAvatar } from "@/components/shell/user-avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { postComment } from "@/server/actions/bill-edit";

export interface CommentBoxProps {
  billId: string;
  currentUser: User;
}

export function CommentBox({ billId, currentUser }: CommentBoxProps) {
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = message.trim();

  function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (!trimmed || pending) return;

    startTransition(async () => {
      const result = await postComment(billId, trimmed);
      if (result.ok) {
        setMessage("");
        inputRef.current?.focus();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex items-start gap-3">
      <UserAvatar
        initials={currentUser.initials}
        color={currentUser.avatarColor}
        title={currentUser.name}
      />
      <div className="min-w-0 flex-1 space-y-2">
        <Textarea
          ref={inputRef}
          value={message}
          rows={2}
          maxLength={2000}
          placeholder={`Add a comment as ${currentUser.name}…`}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              submit();
            }
          }}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">
            {trimmed ? "⌘ + Enter to post" : "Comments are part of the audit trail."}
          </p>
          <Button type="submit" size="sm" disabled={!trimmed || pending}>
            <Send />
            {pending ? "Posting…" : "Comment"}
          </Button>
        </div>
      </div>
    </form>
  );
}
