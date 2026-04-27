"use client";

import {
  Sparkles,
  Lock,
  ArrowUpRight,
  ChevronRight,
  Zap,
  Send,
  CircleDollarSign,
  BarChart2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STUDIO_NAV } from "@/lib/studio/nav";
import { STUDIO_ICONS } from "@/components/studio/sidebar";
import { AI_NAV } from "@/lib/ai/nav";
import type { AiIconKey } from "@/lib/ai/nav";
import { featureEnabled, type BillingPlan } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

const AI_ICON_MAP: Record<AiIconKey, LucideIcon> = {
  studio:   Sparkles,
  automate: Zap,
  publish:  Send,
  monetize: CircleDollarSign,
  insights: BarChart2,
};

interface CreatorWorkspaceStripProps {
  plan: Pick<BillingPlan, "features" | "name"> | null;
  isPlatformAdmin?: boolean;
}

export function CreatorWorkspaceStrip({
  plan,
  isPlatformAdmin = false,
}: CreatorWorkspaceStripProps) {
  const studioModules = STUDIO_NAV.filter((item) => item.gateKey != null);
  const aiModules = AI_NAV; // all AI nav items have gateKeys

  return (
    <div className="space-y-3">
      {/* ── Creator Studio card ─────────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardHeader className="px-4 py-3 border-b border-border/60 bg-muted/30">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                Creator Studio
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
            >
              <a href="https://studio.isunday.me">
                Open
                <ArrowUpRight className="h-3 w-3" />
              </a>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <ul className="divide-y divide-border/50">
            {studioModules.map((m) => {
              const Icon = STUDIO_ICONS[m.iconKey];
              const unlocked =
                isPlatformAdmin || (m.gateKey ? featureEnabled(plan, m.gateKey) : true);
              const href = `https://studio.isunday.me${m.href.replace(/^\/studio/, "") || "/"}`;

              return (
                <ModuleRow
                  key={m.href}
                  href={href}
                  Icon={Icon}
                  label={m.label}
                  description={m.description}
                  unlocked={unlocked}
                  accentClass="bg-primary/10 text-primary"
                  hoverClass="hover:bg-primary/5"
                  activeArrowClass="group-hover:text-primary"
                />
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {/* ── AI Automation Hub card ───────────────────────────────── */}
      <Card className="overflow-hidden border-violet-200/60 dark:border-violet-800/40">
        <CardHeader className="px-4 py-3 border-b border-violet-100/60 dark:border-violet-800/40 bg-gradient-to-r from-violet-500/5 to-fuchsia-500/5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-violet-500" />
              <span className="text-xs font-semibold tracking-wide uppercase text-violet-600/80 dark:text-violet-400/80">
                AI Hub
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
            >
              <a href="https://ai.isunday.me">
                Open
                <ArrowUpRight className="h-3 w-3" />
              </a>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <ul className="divide-y divide-violet-100/40 dark:divide-violet-800/30">
            {aiModules.map((m) => {
              const Icon = AI_ICON_MAP[m.iconKey];
              const unlocked =
                isPlatformAdmin || (m.gateKey ? featureEnabled(plan, m.gateKey) : true);
              const href = `https://ai.isunday.me${m.href.replace(/^\/ai/, "") || "/"}`;

              return (
                <ModuleRow
                  key={m.href}
                  href={href}
                  Icon={Icon}
                  label={m.label}
                  description={m.description}
                  unlocked={unlocked}
                  accentClass="bg-violet-500/10 text-violet-600 dark:text-violet-400"
                  hoverClass="hover:bg-violet-500/5"
                  activeArrowClass="group-hover:text-violet-500"
                />
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Shared row component ────────────────────────────────────────────────

function ModuleRow({
  href,
  Icon,
  label,
  description,
  unlocked,
  accentClass,
  hoverClass,
  activeArrowClass,
}: {
  href: string;
  Icon: LucideIcon;
  label: string;
  description: string;
  unlocked: boolean;
  accentClass: string;
  hoverClass: string;
  activeArrowClass: string;
}) {
  return (
    <li>
      <a
        href={href}
        className={cn(
          "group flex items-center gap-3 px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
          unlocked ? hoverClass : "opacity-55 hover:opacity-80 hover:bg-muted/40",
        )}
      >
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            unlocked ? accentClass : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium leading-snug">{label}</span>
            {!unlocked && (
              <Badge
                variant="secondary"
                className="h-4 gap-0.5 px-1 text-[9px] font-medium"
              >
                <Lock className="h-2 w-2" />
                Upgrade
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-snug mt-0.5">
            {description}
          </p>
        </div>

        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 transition-transform",
            unlocked
              ? `text-muted-foreground/40 ${activeArrowClass} group-hover:translate-x-0.5`
              : "text-muted-foreground/20",
          )}
        />
      </a>
    </li>
  );
}
