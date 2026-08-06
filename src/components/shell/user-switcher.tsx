"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@prisma/client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/shell/user-avatar";
import { setCurrentUser } from "@/lib/current-user";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<User["role"], string> = {
  ADMIN: "Admin",
  APPROVER: "Approver",
  MEMBER: "Member",
};

export interface UserSwitcherProps {
  currentUser: User;
  users: User[];
}

/**
 * Demo identity switcher. There is no auth — picking a user writes a cookie and
 * refreshes, which is how a reviewer walks a bill through a multi-step approval
 * chain on their own.
 */
export function UserSwitcher({ currentUser, users }: UserSwitcherProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function selectUser(user: User) {
    if (user.id === currentUser.id) return;

    startTransition(async () => {
      await setCurrentUser(user.id);
      router.refresh();
      toast.success(`Now acting as ${user.name}`, {
        description: `${user.title ?? ROLE_LABELS[user.role]} · ${ROLE_LABELS[user.role]}`,
      });
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 gap-2 px-2"
          disabled={isPending}
          aria-label="Switch demo user"
        >
          <UserAvatar
            initials={currentUser.initials}
            color={currentUser.avatarColor}
            className="size-6"
          />
          <span className="hidden text-left leading-tight sm:block">
            <span className="block text-xs font-medium">{currentUser.name}</span>
            <span className="text-muted-foreground block text-[10px]">
              {currentUser.title ?? ROLE_LABELS[currentUser.role]}
            </span>
          </span>
          <ChevronsUpDown className="text-muted-foreground size-3.5" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-muted-foreground text-[11px] font-normal">
          Acting as — switch to test approvals
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {users.map((user) => (
          <DropdownMenuItem
            key={user.id}
            onSelect={() => selectUser(user)}
            className="gap-2.5 py-2"
          >
            <UserAvatar
              initials={user.initials}
              color={user.avatarColor}
              className="size-7"
            />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium">
                {user.name}
              </span>
              <span className="text-muted-foreground block truncate text-[11px]">
                {user.title ?? "—"} · {ROLE_LABELS[user.role]}
              </span>
            </span>
            <Check
              className={cn(
                "size-4 shrink-0",
                user.id === currentUser.id ? "opacity-100" : "opacity-0",
              )}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
