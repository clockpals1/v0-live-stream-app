"use client";

import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TYPO } from "@/lib/control-room/styles";

/**
 * Locked feature card — visible at all times, never hidden.
 *
 * Visual: dotted ring with a soft primary gradient inside, lock chip
 * top-right, sparkles icon left. The "lock + opportunity" cue should
 * be obvious but never fight with the actual unlocked controls
 * around it.
 */
export function LockedCard({
  title,
  description,
  ctaLabel = "Upgrade plan",
  ctaHref = "/host/dashboard?tab=billing",
}: {
  title: string;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
}) {
  return (
    <div className="relative rounded-lg p-3.5 border border-dashed border-primary/40 bg-gradient-to-br from-primary/[0.06] to-transparent">
      <span className="absolute top-2 right-2 inline-flex items-center gap-1 h-5 px-1.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] bg-primary/10 text-primary ring-1 ring-primary/30">
        <Lock className="w-3 h-3" />
        Premium
      </span>
      <div className="flex items-start gap-2.5 pr-16">
        <span className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary to-primary/70 ring-1 ring-primary/40 text-primary-foreground flex items-center justify-center shrink-0 shadow-sm shadow-primary/20">
          <Sparkles className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={TYPO.title}>{title}</p>
          <p className={`${TYPO.sub} mt-0.5 leading-relaxed`}>{description}</p>
          <Button asChild size="sm" variant="outline" className="mt-2.5 h-7 text-xs">
            <Link href={ctaHref}>{ctaLabel}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
