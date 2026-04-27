"use client";

import { Sparkles, Lock, ArrowUpRight, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STUDIO_NAV } from "@/lib/studio/nav";
import { STUDIO_ICONS } from "@/components/studio/sidebar";
import { featureEnabled, type BillingPlan } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

interface CreatorWorkspaceStripProps {
  plan: Pick<BillingPlan, "features" | "name"> | null;
  isPlatformAdmin?: boolean;
}

export function CreatorWorkspaceStrip({
  plan,
  isPlatformAdmin = false,
}: CreatorWorkspaceStripProps) {
  const modules = STUDIO_NAV.filter((item) => item.gateKey != null);

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <CardHeader className="px-4 py-3 border-b border-border/60 bg-muted/30">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
              Creator Studio
            </span>
          </div>
          <Button variant="ghost" size="sm" asChild className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground">
            <a href="https://studio.isunday.me">
              Open Studio
              <ArrowUpRight className="h-3 w-3" />
            </a>
          </Button>
        </div>
      </CardHeader>

      {/* Module list */}
      <CardContent className="p-0">
        <ul className="divide-y divide-border/50">
          {modules.map((m) => {
            const Icon = STUDIO_ICONS[m.iconKey];
            const unlocked =
              isPlatformAdmin || (m.gateKey ? featureEnabled(plan, m.gateKey) : true);
            const href = `https://studio.isunday.me${m.href.replace(/^\/studio/, "") || "/"}`;

            return (
              <li key={m.href}>
                <a
                  href={href}
                  className={cn(
                    "group flex items-center gap-3 px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                    unlocked
                      ? "hover:bg-primary/5"
                      : "opacity-60 hover:opacity-90 hover:bg-muted/40",
                  )}
                >
                  {/* Icon */}
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      unlocked
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>

                  {/* Text */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium leading-snug">
                        {m.label}
                      </span>
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
                      {m.description}
                    </p>
                  </div>

                  {/* Arrow */}
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 shrink-0 transition-transform",
                      unlocked
                        ? "text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5"
                        : "text-muted-foreground/20",
                    )}
                  />
                </a>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
