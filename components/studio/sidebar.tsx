"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  Lock,
  LayoutDashboard,
  Film,
  Share2,
  Users,
  CircleDollarSign,
  BarChart2,
  Zap,
  Menu,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import type { StudioIconKey, StudioNavItem } from "@/lib/studio/nav";

/**
 * Icon registry. Lives client-side so the server layout can pass plain
 * string keys (`iconKey`) across the RSC boundary without serializing
 * a forwardRef component object — Next.js refuses to do that.
 */
export const STUDIO_ICONS: Record<StudioIconKey, LucideIcon> = {
  overview: LayoutDashboard,
  replay: Film,
  distribution: Share2,
  audience: Users,
  monetize: CircleDollarSign,
  insights: BarChart2,
};

/**
 * Studio sidebar — the persistent left rail on every Studio page.
 *
 * Receives the resolved navigation list from the server layout, where
 * each item is annotated with `gated`: true when the host's effective
 * plan does NOT include the feature key. We render gated entries with a
 * lock badge so it's clear what's available and what requires an upgrade.
 * On mobile (< lg) a hamburger button opens a Sheet drawer with the same
 * nav content — no blank navigation state on any screen size.
 */
export interface StudioSidebarItem extends StudioNavItem {
  gated: boolean;
}

interface StudioSidebarProps {
  items: ReadonlyArray<StudioSidebarItem>;
  hostName: string;
  planLabel: string;
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function StudioNavItems({
  items,
  pathname,
  onNavigate,
}: {
  items: ReadonlyArray<StudioSidebarItem>;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
      {items.map((item) => {
        const Icon = STUDIO_ICONS[item.iconKey];
        const active =
          item.href === "/studio"
            ? pathname === "/studio"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
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
  );
}

function StudioFooter({
  hostName,
  planLabel,
  onNavigate,
}: {
  hostName: string;
  planLabel: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="space-y-1 border-t border-border p-3 text-xs">
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
      <a
        href="https://ai.isunday.me"
        onClick={onNavigate}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Zap className="h-3 w-3 text-violet-500" />
        <span>AI Hub</span>
      </a>
      <a
        href="https://live.isunday.me/host/dashboard"
        onClick={onNavigate}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        <span>Live dashboard</span>
      </a>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function StudioSidebar({
  items,
  hostName,
  planLabel,
}: StudioSidebarProps) {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  const brandBlock = (
    <div className="border-b border-border px-5 py-4">
      <Link
        href="/studio"
        className="flex items-center gap-2"
        onClick={() => setSheetOpen(false)}
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
          <span className="text-[11px] font-bold tracking-wider">IS</span>
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">Isunday Studio</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Creator workspace
          </div>
        </div>
      </Link>
    </div>
  );

  return (
    <>
      {/* ─── Mobile header (lg:hidden) ─────────────────────────────── */}
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-border bg-card px-4 py-3 lg:hidden">
        <Link href="/studio" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
            <span className="text-[11px] font-bold tracking-wider">IS</span>
          </div>
          <span className="text-sm font-semibold">Isunday Studio</span>
        </Link>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <Menu className="h-4 w-4" />
              <span className="sr-only">Open navigation</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-72 flex-col p-0">
            {brandBlock}
            <StudioNavItems
              items={items}
              pathname={pathname}
              onNavigate={() => setSheetOpen(false)}
            />
            <StudioFooter
              hostName={hostName}
              planLabel={planLabel}
              onNavigate={() => setSheetOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </header>

      {/* ─── Desktop sidebar (hidden on mobile) ─────────────────────── */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-card lg:flex lg:flex-col">
        {brandBlock}
        <StudioNavItems items={items} pathname={pathname} />
        <StudioFooter hostName={hostName} planLabel={planLabel} />
      </aside>
    </>
  );
}
