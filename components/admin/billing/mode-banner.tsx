"use client";

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Persistent banner shown when Stripe is in TEST mode. Renders nothing
 * in live mode. Use this at the top of any admin/host billing surface
 * to make sure no admin ever forgets they're testing.
 */
export function ModeBanner({
  mode,
  className,
}: {
  mode: "test" | "live" | null;
  className?: string;
}) {
  if (mode !== "test") return null;
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200",
        className,
      )}
      role="status"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <div className="font-medium">Stripe is in TEST mode.</div>
        <div className="mt-0.5 text-xs opacity-90">
          No real charges will occur. Switch to live mode in the Stripe
          configuration panel below before launching.
        </div>
      </div>
    </div>
  );
}
