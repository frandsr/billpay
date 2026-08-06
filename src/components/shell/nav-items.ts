import {
  Banknote,
  Building2,
  FilePlus,
  LayoutDashboard,
  ReceiptText,
  Repeat,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
  /**
   * Routes that belong to this entry but do not sit under its `href`.
   *
   * The ingestion channels are siblings of the hub that lists them —
   * `/bills/upload` is not nested under `/bills/add` — so without this the
   * sidebar would fall back to **Bills** the moment you picked a channel, and
   * you would lose the trail back to the other ways in.
   */
  alsoActiveFor?: string[];
}

/** Primary navigation. Keep the order — it matches the AP workflow. */
export const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    description: "What needs attention today",
  },
  {
    href: "/bills",
    label: "Bills",
    icon: ReceiptText,
    description: "The accounts payable inbox",
  },
  {
    href: "/payments",
    label: "Payments",
    icon: Banknote,
    description: "Money leaving the bank, by status and date",
  },
  {
    href: "/bills/add",
    label: "Add bills",
    icon: FilePlus,
    description: "Every way a bill gets in: an invoice, a spreadsheet, or by hand",
    alsoActiveFor: ["/bills/upload", "/bills/import"],
  },
  {
    href: "/recurring",
    label: "Recurring",
    icon: Repeat,
    description: "Templates that generate bills on a schedule",
  },
  {
    href: "/vendors",
    label: "Vendors",
    icon: Building2,
    description: "Suppliers and payment details",
  },
];

/**
 * The nav entry that should read as active, or `null` when none does.
 *
 * Longest match wins, so `/bills/import` highlights **Add bills** rather than
 * lighting up both it and **Bills** — a plain `startsWith` check marks two
 * entries active as soon as one route nests inside another. The comparison is
 * on the matched route, not on the entry's `href`, so a route claimed through
 * `alsoActiveFor` still beats the shorter parent it happens to sit under.
 */
export function activeNavHref(pathname: string): string | null {
  let best: string | null = null;
  let bestLength = -1;

  for (const item of NAV_ITEMS) {
    for (const route of [item.href, ...(item.alsoActiveFor ?? [])]) {
      const matches = pathname === route || pathname.startsWith(`${route}/`);
      if (matches && route.length > bestLength) {
        best = item.href;
        bestLength = route.length;
      }
    }
  }

  return best;
}
