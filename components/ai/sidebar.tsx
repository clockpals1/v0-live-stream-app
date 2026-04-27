"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  Lock,
  Sparkles,
  Zap,
  Send,
  CircleDollarSign,
  BarChart2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import type { AiIconKey, AiNavItem } from "@/lib/ai/nav";

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

export function AiSidebar({ items, hostName, planLabel }: AiSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 border-r border-border bg-card lg:flex lg:flex-col">
      {/* ─── brand ──────────────────────────────────────────────────── */}
      <div className="border-b border-border px-5 py-4">
        <Link href="/ai" className="flex items-center gap-2">
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

      {/* ─── nav ────────────────────────────────────────────────────── */}
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
              href={item.gated ? "#" : item.href}
              className={cn(
                "group relative flex items-start gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-foreground/80 hover:bg-muted hover:text-foreground",
                item.gated && "pointer-events-none opacity-50",
              )}
              aria-current={active ? "page" : undefined}
              aria-disabled={item.gated}
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

      {/* ─── footer ─────────────────────────────────────────────────── */}
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
          href="https://studio.isunday.me"
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Studio
        </Link>
      </div>
    </aside>
  );
}
