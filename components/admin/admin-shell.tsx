"use client";

import {
  LayoutDashboard, Users, CreditCard, Sparkles,
  Radio, Layers,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { ADMIN_NAV_GROUPS } from "@/lib/admin/nav";

const ADMIN_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  users:    Users,
  billing:  CreditCard,
  ai:       Sparkles,
};

export function AdminShell({ userName }: { userName: string }) {
  return (
    <AppSidebar
      appName="Admin Center"
      appSubtitle="Platform management"
      appHref="/admin"
      brandIconKey="admin"
      navGroups={[...ADMIN_NAV_GROUPS]}
      iconMap={ADMIN_ICONS}
      userName={userName}
      planLabel="Platform Admin"
      isAdmin
      crossLinks={[
        { href: "/host/dashboard", label: "Host Dashboard",   iconKey: "live" },
        { href: "/studio",         label: "Creator Studio",   iconKey: "studio" },
        { href: "/ai",             label: "AI Hub",           iconKey: "ai" },
      ]}
    />
  );
}
