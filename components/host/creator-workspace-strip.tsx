"use client";

import { Sparkles, Lock, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { STUDIO_NAV } from "@/lib/studio/nav";
import { STUDIO_ICONS } from "@/components/studio/sidebar";
import { featureEnabled, type BillingPlan } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

/**
 * Creator Workspace strip — the live → studio bridge.
 *
 * Surfaces the four studio modules (Replay, Distribution, Audience,
 * Monetize) as cards on the live host dashboard so the host always
 * has a visible path from "I just streamed" to "now I publish, share,
 * monetize". Each card:
 *
 *   - links to the matching studio.isunday.me/<route>
 *   - shows a lock icon when the host's plan doesn't include the
 *     gate key for that module
 *   - reuses STUDIO_NAV from `@/lib/studio/nav` so the live and
 *     studio surfaces stay in lockstep — adding a new studio module
 *     auto-shows up here
 *
 * Why a fresh component, not the studio sidebar?
 * The sidebar is a vertical chrome element. This is a horizontal
 * promo strip on the live dashboard, with different copy and density.
 * Sharing the data (STUDIO_NAV) but not the UI keeps each surface
 * idiomatic.
 */

interface CreatorWorkspaceStripProps {
  /** Resolved plan from the entitlement resolver, or null (free). */
  plan: Pick<BillingPlan, "features" | "name"> | null;
  /** True when the user is a platform admin (everything unlocked). */
  isPlatformAdmin?: boolean;
}

export function CreatorWorkspaceStrip({
  plan,
  isPlatformAdmin = false,
}: CreatorWorkspaceStripProps) {
  // Studio overview ("/studio") isn't a module — it's the landing
  // page. The 4 cards below are the actual product modules.
  const modules = STUDIO_NAV.filter((item) => item.gateKey != null);

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <Sparkles className="h-5 w-5 text-primary" />
          Creator Workspace
        </h2>
        <a
          href="https://studio.isunday.me"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Open Studio
          <ArrowUpRight className="h-3 w-3" />
        </a>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {modules.map((m) => {
          const Icon = STUDIO_ICONS[m.iconKey];
          const unlocked =
            isPlatformAdmin || (m.gateKey ? featureEnabled(plan, m.gateKey) : true);
          // Use a plain anchor — different host (subdomain). With
          // shared cookies on .isunday.me the session carries over so
          // the host doesn't see a fresh login.
          const href = `https://studio.isunday.me${m.href.replace(/^\/studio/, "") || "/"}`;
          return (
            <a
              key={m.href}
              href={href}
              className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Card
                className={cn(
                  "h-full transition-colors",
                  unlocked
                    ? "hover:border-primary/40 hover:bg-primary/5"
                    : "opacity-75 hover:opacity-100",
                )}
              >
                <CardContent className="flex h-full flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-lg",
                        unlocked
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    {!unlocked ? (
                      <Badge
                        variant="secondary"
                        className="h-5 gap-1 px-1.5 text-[10px]"
                      >
                        <Lock className="h-2.5 w-2.5" />
                        Upgrade
                      </Badge>
                    ) : (
                      <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-tight">
                      {m.label}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {m.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </a>
          );
        })}
      </div>
    </section>
  );
}
