import type { ReactNode } from "react";

import { AppSidebar } from "@/components/shell/app-sidebar";
import { TopBar } from "@/components/shell/top-bar";
import { getCurrentUser, listDemoUsers } from "@/lib/current-user";

/**
 * Application shell: sidebar + top bar with the demo user switcher.
 * Owned by the foundation phase — feature phases should not edit this file.
 */
export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [currentUser, users] = await Promise.all([
    getCurrentUser(),
    listDemoUsers(),
  ]);

  return (
    <div className="flex min-h-svh">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar currentUser={currentUser} users={users} />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
