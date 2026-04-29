import type { AppNavGroup } from "@/components/shell/app-sidebar";

/**
 * Admin Center navigation groups.
 * Mirrors Microsoft 365 admin center–style grouping:
 *   Platform → operational overview + host management
 *   Configuration → billing plans + AI provider settings
 */
export const ADMIN_NAV_GROUPS: ReadonlyArray<AppNavGroup> = [
  {
    label: "Platform",
    items: [
      {
        href: "/admin",
        label: "Overview",
        iconKey: "overview",
      },
      {
        href: "/admin/hosts",
        label: "Hosts & Users",
        iconKey: "users",
      },
    ],
  },
  {
    label: "Configuration",
    items: [
      {
        href: "/admin/billing",
        label: "Plans & Billing",
        iconKey: "billing",
      },
      {
        href: "/admin/ai",
        label: "AI Configuration",
        iconKey: "ai",
      },
    ],
  },
];
