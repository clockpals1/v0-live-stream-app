"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Lock,
  Sparkles,
  Zap,
  Send,
  CircleDollarSign,
  BarChart2,
  Radio,
  Menu,
  ArrowUpRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import type { AiIconKey, AiNavItem } from "@/lib/ai/nav";

const UPGRADE_URL = "https://live.isunday.me/host/settings";

/**
 * Icon registry — same pattern as the Studio sidebar.
 * String keys cross the RSC boundary safely; components don't.
 */
export const AI_ICONS: Record<AiIconKey, LucideIcon> = {
  studio:   Sparkles,
  automate: Zap,
  publish:  Send,
  monetize: CircleDollarSign,
  insights: BarChart2,
};

export interface AiSidebarItem extends AiNavItem {
  gated: boolean;
}

interface AiSidebarProps {
  items: ReadonlyArray<AiSidebarItem>;
  hostName: string;
  planLabel: string;
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function AiNavItems({
  items,
  pathname,
  onNavigate,
}: {
  items: ReadonlyArray<AiSidebarItem>;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
      {items.map((item) => {
        const Icon = AI_ICONS[item.iconKey];
        const active =
          item.href === "/ai"
            ? pathname === "/ai"
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.gated ? UPGRADE_URL : item.href}
            onClick={onNavigate}
            className={cn(
              "group relative flex items-start gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-foreground/80 hover:bg-muted hover:text-foreground",
              item.gated && "opacity-60",
            )}
            aria-current={active ? "page" : undefined}
            title={item.gated ? "Upgrade to unlock" : undefined}
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

function AiFooter({
  hostName,
  planLabel,
  isAdmin,
  onNavigate,
}: {
  hostName: string;
  planLabel: string;
  isAdmin: boolean;
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

      {!isAdmin && (
        <a
          href={UPGRADE_URL}
          onClick={onNavigate}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 font-medium text-violet-600 hover:bg-violet-500/10 dark:text-violet-400"
        >
          <ArrowUpRight className="h-3 w-3" />
          <span>Upgrade plan</span>
        </a>
      )}

      <a
        href="https://live.isunday.me/host/dashboard"
        onClick={onNavigate}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Radio className="h-3 w-3" />
        <span>Live dashboard</span>
      </a>
      <a
        href="https://studio.isunday.me"
        onClick={onNavigate}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Sparkles className="h-3 w-3 text-primary" />
        <span>Studio</span>
      </a>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function AiSidebar({ items, hostName, planLabel }: AiSidebarProps) {
  const pathname = usePathname();
  const isAdmin = planLabel === "Admin";
  const [sheetOpen, setSheetOpen] = useState(false);

  const brandBlock = (
    <div className="border-b border-border px-5 py-4">
      <Link
        href="/ai"
        className="flex items-center gap-2"
        onClick={() => setSheetOpen(false)}
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-violet-600 via-purple-500 to-fuchsia-500 text-white shadow-sm">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">Isunday AI</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Automation hub
          </div>
        </div>
      </Link>
    </div>
  );

  return (
    <>
      {/* ─── Mobile header (lg:hidden) ─────────────────────────────── */}
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-border bg-card px-4 py-3 lg:hidden">
        <Link href="/ai" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-violet-600 via-purple-500 to-fuchsia-500 text-white shadow-sm">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <span className="text-sm font-semibold">Isunday AI</span>
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
            <AiNavItems
              items={items}
              pathname={pathname}
              onNavigate={() => setSheetOpen(false)}
            />
            <AiFooter
              hostName={hostName}
              planLabel={planLabel}
              isAdmin={isAdmin}
              onNavigate={() => setSheetOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </header>

      {/* ─── Desktop sidebar (hidden on mobile) ─────────────────────── */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-card lg:flex lg:flex-col">
        {brandBlock}
        <AiNavItems items={items} pathname={pathname} />
        <AiFooter hostName={hostName} planLabel={planLabel} isAdmin={isAdmin} />
      </aside>
    </>
  );
}
