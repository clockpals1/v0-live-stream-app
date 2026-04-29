/**
 * components/shell/page-header.tsx
 *
 * Standardised page-header for all dashboard sections.
 * Provides: breadcrumb trail, page title + description, and an
 * optional right-aligned action slot.
 *
 * Usage (server or client):
 *   <PageHeader
 *     breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Plans & Billing" }]}
 *     title="Plans & Billing"
 *     description="Manage subscription plans and billing configuration."
 *     actions={<Button>Add plan</Button>}
 *   />
 */

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Breadcrumb {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  breadcrumbs?: Breadcrumb[];
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  breadcrumbs,
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("border-b border-border bg-background/95 px-6 py-4 backdrop-blur", className)}>
      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="mb-1.5 flex items-center gap-1" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, i) => {
            const isLast = i === breadcrumbs.length - 1;
            return (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
                {crumb.href && !isLast ? (
                  <Link
                    href={crumb.href}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span className={cn(
                    "text-[11px]",
                    isLast ? "text-foreground/70" : "text-muted-foreground",
                  )}>
                    {crumb.label}
                  </span>
                )}
              </span>
            );
          })}
        </nav>
      )}

      {/* Title row */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight text-foreground">{title}</h1>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground leading-snug">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  );
}
