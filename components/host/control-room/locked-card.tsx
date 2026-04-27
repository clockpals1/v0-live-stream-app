"use client";

import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * Locked feature card.
 *
 * Visible at all times — we never hide a premium feature. The host
 * needs to know what they could unlock without leaving the page.
 * Pattern matches the Studio sidebar (locked items render with a
 * dimmed style + a lock chip).
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
    <Card className="border-dashed bg-muted/20 relative overflow-hidden">
      <div className="absolute top-2 right-2">
        <Badge variant="outline" className="gap-1 text-[10px] h-5 px-1.5">
          <Lock className="w-3 h-3" />
          Premium
        </Badge>
      </div>
      <CardContent className="p-4 flex items-start gap-3">
        <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          <Button asChild size="sm" variant="outline" className="mt-3 h-7 text-xs">
            <Link href={ctaHref}>{ctaLabel}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
