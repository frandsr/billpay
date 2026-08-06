"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wallet } from "lucide-react";

import { NAV_ITEMS, activeNavHref } from "@/components/shell/nav-items";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  const pathname = usePathname();
  const currentHref = activeNavHref(pathname);

  return (
    <aside className="bg-sidebar text-sidebar-foreground hidden w-60 shrink-0 flex-col border-r md:flex">
      <div className="flex h-14 items-center gap-2.5 border-b px-4">
        <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
          <Wallet className="size-4" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">Bill Pay</p>
          <p className="text-muted-foreground text-[11px]">Northwind Labs</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 p-2" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active = currentHref === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-3">
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          Demo environment. Payments are simulated and no money moves.
        </p>
      </div>
    </aside>
  );
}
