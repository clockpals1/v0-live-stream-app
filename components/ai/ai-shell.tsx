"use client";

import {
  Sparkles, Zap, Send, CircleDollarSign, BarChart2,
  Radio, Layers, ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AppSidebar, type AppNavGroup } from "@/components/shell/app-sidebar";

const AI_ICONS: Record<string, LucideIcon> = {
  studio:   Sparkles,
  automate: Zap,
  publish:  Send,
  monetize: CircleDollarSign,
  insights: BarChart2,
};

interface AiShellProps {
  navGroups: AppNavGroup[];
  userName: string;
  planLabel: string;
  isAdmin?: boolean;
}

export function AiShell({ navGroups, userName, planLabel, isAdmin }: AiShellProps) {
  return (
    <AppSidebar
      appName="AI Hub"
      appSubtitle="Automation platform"
      appHref="/ai"
      brandIconKey="ai"
      navGroups={navGroups}
      iconMap={AI_ICONS}
      userName={userName}
      planLabel={planLabel}
      isAdmin={isAdmin}
      crossLinks={[
        { href: "/host/dashboard", label: "Host Dashboard", iconKey: "live" },
        { href: "/studio",         label: "Creator Studio", iconKey: "studio" },
        ...(isAdmin ? [{ href: "/admin", label: "Admin Center", iconKey: "admin" as const }] : []),
      ]}
    />
  );
}
