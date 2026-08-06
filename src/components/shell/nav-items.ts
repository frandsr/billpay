import {
  Building2,
  LayoutDashboard,
  ReceiptText,
  Timer,
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
    href: "/vendors",
    label: "Vendors",
    icon: Building2,
    description: "Suppliers and payment details",
  },
  {
    href: "/aging",
    label: "AP Aging",
    icon: Timer,
    description: "Outstanding balance by age",
  },
];
