"use client";

/**
 * components/shell/app-sidebar.tsx
 *
 * Unified enterprise sidebar shell — one component used across Admin,
 * Studio, and AI sections. Inspired by Microsoft 365 admin-center UX:
 * grouped navigation, compact rows, left-border active state, clean footer.
 *
 * Receives plain serialisable data from server layouts (no React
 * component references across the RSC boundary).
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Lock, Menu, ChevronRight, ExternalLink,
  Radio, Sparkles, Layers, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import type { LucideIcon } from "lucide-react";

// ─── Data types ───────────────────────────────────────────────────────────────

export interface AppNavItem {
  href: string;
  label: string;
  iconKey: string;
  gated?: boolean;
  gateKey?: string;
  external?: boolean;
  badge?: string;
}

export interface AppNavGroup {
  label: string;
  items: AppNavItem[];
}

export interface CrossLink {
  href: string;
  label: string;
  iconKey: "live" | "studio" | "ai" | "admin";
  external?: boolean;
}

export interface AppSidebarProps {
  appName: string;
  appSubtitle: string;
  appHref: string;
  brandIconKey: "live" | "studio" | "ai" | "admin";
  navGroups: AppNavGroup[];
  iconMap: Record<string, LucideIcon>;
  userName: string;
  planLabel: string;
  isAdmin?: boolean;
  crossLinks?: CrossLink[];
}

// ─── Brand icon map ────────────────────────────────────────────────────────────

const BRAND_ICONS: Record<string, { icon: LucideIcon; gradient: string }> = {
  live:   { icon: Radio,        gradient: "from-blue-600 to-cyan-500" },
  studio: { icon: Layers,       gradient: "from-violet-500 to-indigo-600" },
  ai:     { icon: Sparkles,     gradient: "from-violet-600 via-purple-500 to-fuchsia-500" },
  admin:  { icon: ShieldCheck,  gradient: "from-slate-700 to-slate-500" },
};

const CROSS_LINK_ICONS: Record<string, LucideIcon> = {
  live:   Radio,
  studio: Layers,
  ai:     Sparkles,
  admin:  ShieldCheck,
};

// ─── Nav items (shared between desktop + sheet) ────────────────────────────────

function NavGroups({
  groups,
  iconMap,
  pathname,
  onNavigate,
}: {
  groups: AppNavGroup[];
  iconMap: Record<string, LucideIcon>;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-5">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = iconMap[item.iconKey];
              const isActive = item.href === "/"
                ? pathname === "/"
                : item.href.split("?")[0] === pathname
                  ? true
                  : pathname.startsWith(item.href + "/")
                    || (pathname === item.href);

              return (
                <Link
                  key={item.href}
                  href={item.gated ? "#" : item.href}
                  target={item.external ? "_blank" : undefined}
                  rel={item.external ? "noopener noreferrer" : undefined}
                  onClick={item.gated ? (e) => e.preventDefault() : onNavigate}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-all",
                    isActive
                      ? "border-l-2 border-primary bg-primary/8 font-medium text-primary"
                      : "border-l-2 border-transparent text-foreground/75 hover:border-border hover:bg-muted/60 hover:text-foreground",
                    item.gated && "cursor-not-allowed opacity-50",
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  {Icon && (
                    <Icon className={cn(
                      "h-4 w-4 shrink-0",
                      isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                    )} />
                  )}
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.gated && <Lock className="h-3 w-3 shrink-0 text-muted-foreground/60" />}
                  {item.badge && !item.gated && (
                    <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                      {item.badge}
                    </span>
                  )}
                  {item.external && !item.gated && (
                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

// ─── Footer ────────────────────────────────────────────────────────────────────

function SidebarFooter({
  userName,
  planLabel,
  isAdmin,
  crossLinks,
  onNavigate,
}: {
  userName: string;
  planLabel: string;
  isAdmin?: boolean;
  crossLinks?: CrossLink[];
  onNavigate?: () => void;
}) {
  const initials = userName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "U";

  return (
    <div className="border-t border-border">
      {/* Cross-section quick links */}
      {crossLinks && crossLinks.length > 0 && (
        <div className="px-2 pt-3 pb-1 space-y-0.5">
          {crossLinks.map((link) => {
            const Icon = CROSS_LINK_ICONS[link.iconKey];
            return (
              <a
                key={link.href}
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noopener noreferrer" : undefined}
                onClick={onNavigate}
                className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{link.label}</span>
                <ChevronRight className="ml-auto h-3 w-3 opacity-40" />
              </a>
            );
          })}
        </div>
      )}

      {/* User identity block */}
      <div className="p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium leading-tight">{userName}</p>
            <div className="flex items-center gap-1 mt-0.5">
              {isAdmin && <ShieldCheck className="h-2.5 w-2.5 text-amber-500" />}
              <p className="text-[10px] text-muted-foreground">{planLabel}</p>
            </div>
          </div>
          <ThemeToggle size="sm" />
        </div>
      </div>
    </div>
  );
}

// ─── Brand block ───────────────────────────────────────────────────────────────

function BrandBlock({
  appName,
  appSubtitle,
  appHref,
  brandIconKey,
  onClick,
}: {
  appName: string;
  appSubtitle: string;
  appHref: string;
  brandIconKey: string;
  onClick?: () => void;
}) {
  const brand = BRAND_ICONS[brandIconKey] ?? BRAND_ICONS.live;
  const Icon = brand.icon;

  return (
    <div className="border-b border-border px-4 py-3.5">
      <Link href={appHref} onClick={onClick} className="flex items-center gap-2.5 group">
        <div className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm",
          brand.gradient,
        )}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight text-foreground">{appName}</p>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{appSubtitle}</p>
        </div>
      </Link>
    </div>
  );
}

// ─── Main export ───────────────────────────────────────────────────────────────

export function AppSidebar({
  appName,
  appSubtitle,
  appHref,
  brandIconKey,
  navGroups,
  iconMap,
  userName,
  planLabel,
  isAdmin,
  crossLinks,
}: AppSidebarProps) {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);
  const closeSheet = () => setSheetOpen(false);

  const sidebarContent = (
    <>
      <BrandBlock
        appName={appName}
        appSubtitle={appSubtitle}
        appHref={appHref}
        brandIconKey={brandIconKey}
        onClick={closeSheet}
      />
      <NavGroups
        groups={navGroups}
        iconMap={iconMap}
        pathname={pathname}
        onNavigate={closeSheet}
      />
      <SidebarFooter
        userName={userName}
        planLabel={planLabel}
        isAdmin={isAdmin}
        crossLinks={crossLinks}
        onNavigate={closeSheet}
      />
    </>
  );

  return (
    <>
      {/* ── Mobile top bar ──────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 flex h-12 items-center justify-between border-b border-border bg-card/95 px-4 backdrop-blur lg:hidden">
        <Link href={appHref} className="flex items-center gap-2">
          {(() => {
            const brand = BRAND_ICONS[brandIconKey] ?? BRAND_ICONS.live;
            const Icon = brand.icon;
            return (
              <div className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br text-white",
                brand.gradient,
              )}>
                <Icon className="h-3.5 w-3.5" />
              </div>
            );
          })()}
          <span className="text-sm font-semibold">{appName}</span>
        </Link>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <Menu className="h-4 w-4" />
              <span className="sr-only">Open menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-64 flex-col p-0 bg-card">
            {sidebarContent}
          </SheetContent>
        </Sheet>
      </header>

      {/* ── Desktop sidebar ─────────────────────────────────────────── */}
      <aside className="hidden w-60 shrink-0 border-r border-border bg-card lg:flex lg:flex-col">
        {sidebarContent}
      </aside>
    </>
  );
}
