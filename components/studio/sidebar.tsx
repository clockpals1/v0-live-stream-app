"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import type { StudioNavItem } from "@/lib/studio/nav";

/**
 * Studio sidebar — the persistent left rail on every Studio page.
 *
 * Receives the resolved navigation list from the server layout, where
 * each item is annotated with `gated`: true when the host's effective
 * plan does NOT include the feature key. We render gated entries as
 * disabled links with a small lock badge so it's clear what's
 * available and what's an upgrade prompt — never hide them, the
 * existence of the feature is part of the product story.
 *
 * Active state matches by prefix, so /studio/replay/123/edit lights
 * up "Replay Library".
 */
export interface StudioSidebarItem extends StudioNavItem {
  gated: boolean;
}

interface StudioSidebarProps {
  items: ReadonlyArray<StudioSidebarItem>;
  hostName: string;
  planLabel: string;
}

export function StudioSidebar({
  items,
  hostName,
  planLabel,
}: StudioSidebarProps) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-64 shrink-0 border-r border-border bg-card lg:flex lg:flex-col">
      {/* ─── brand ───────────────────────────────────────────────────── */}
      <div className="border-b border-border px-5 py-4">
        <Link href="/studio" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
            <span className="text-[11px] font-bold tracking-wider">IS</span>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight">
              Isunday Studio
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Creator workspace
            </div>
          </div>
        </Link>
      </div>

      {/* ─── nav ─────────────────────────────────────────────────────── */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {items.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/studio"
              ? pathname === "/studio"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-start gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-foreground/80 hover:bg-muted hover:text-foreground",
                item.gated && "opacity-60",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">{item.label}</span>
                  {item.gated && (
                    <Lock className="h-3 w-3 text-muted-foreground" />
                  )}
                </div>
                <div className="text-[11px] leading-snug text-muted-foreground">
                  {item.description}
                </div>
              </div>
            </Link>
          );
        })}
      </nav>

      {/* ─── footer: account + back-to-live ──────────────────────────── */}
      <div className="space-y-2 border-t border-border p-3 text-xs">
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <div className="min-w-0">
            <div className="truncate font-medium">{hostName}</div>
            <Badge
              variant="outline"
              className="mt-0.5 h-4 px-1.5 text-[10px] font-normal"
            >
              {planLabel}
            </Badge>
          </div>
          <ThemeToggle size="sm" />
        </div>
        <Link
          href="https://live.isunday.me/host/dashboard"
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to live dashboard
        </Link>
      </div>
    </aside>
  );
}
