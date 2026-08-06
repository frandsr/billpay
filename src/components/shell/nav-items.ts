import {
  Banknote,
  Building2,
  LayoutDashboard,
  ReceiptText,
  Repeat,
  Upload,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
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
    href: "/bills/import",
    label: "Import",
    icon: Upload,
    description: "Bring bills in from a CSV or a scanned invoice",
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
 * Longest match wins, so `/bills/import` highlights **Import** rather than
 * lighting up both it and its parent **Bills** — a plain `startsWith` check
 * marks two entries active as soon as one route nests inside another.
 */
export function activeNavHref(pathname: string): string | null {
  let best: string | null = null;

  for (const item of NAV_ITEMS) {
    const matches =
      pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (best === null || item.href.length > best.length)) {
      best = item.href;
    }
  }

  return best;
}
