"use client";

import {
  LayoutDashboard, Film, Share2, Users, CircleDollarSign, BarChart2,
  Radio, Sparkles, ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AppSidebar, type AppNavGroup } from "@/components/shell/app-sidebar";

const STUDIO_ICONS: Record<string, LucideIcon> = {
  overview:     LayoutDashboard,
  replay:       Film,
  distribution: Share2,
  audience:     Users,
  monetize:     CircleDollarSign,
  insights:     BarChart2,
};

interface StudioShellProps {
  navGroups: AppNavGroup[];
  userName: string;
  planLabel: string;
  isAdmin?: boolean;
}

export function StudioShell({ navGroups, userName, planLabel, isAdmin }: StudioShellProps) {
  return (
    <AppSidebar
      appName="Creator Studio"
      appSubtitle="Content workspace"
      appHref="/studio"
      brandIconKey="studio"
      navGroups={navGroups}
      iconMap={STUDIO_ICONS}
      userName={userName}
      planLabel={planLabel}
      isAdmin={isAdmin}
      crossLinks={[
        { href: "/host/dashboard", label: "Host Dashboard", iconKey: "live" },
        { href: "/ai",             label: "AI Hub",         iconKey: "ai" },
        ...(isAdmin ? [{ href: "/admin", label: "Admin Center", iconKey: "admin" as const }] : []),
      ]}
    />
  );
}
