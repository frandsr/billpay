import type { User } from "@prisma/client";

import { MobileNav } from "@/components/shell/mobile-nav";
import { UserSwitcher } from "@/components/shell/user-switcher";

export interface TopBarProps {
  currentUser: User;
  users: User[];
}

export function TopBar({ currentUser, users }: TopBarProps) {
  return (
    <header className="bg-background/80 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
      <MobileNav />
      <div className="flex-1" />
      <UserSwitcher currentUser={currentUser} users={users} />
    </header>
  );
}
