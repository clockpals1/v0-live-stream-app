import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Studio "coming soon" placeholder.
 *
 * Used by surfaces whose UI lands in a later phase (Phase 2-5). Avoids
 * a wall of empty pages by giving each module a clear identity, a
 * preview list of what it will contain, and a single Back action.
 *
 * Each placeholder takes a small list of bullet points so the
 * different modules don't all look identical — Distribution Hub
 * previews different bullets than Audience CRM.
 */
interface ComingSoonProps {
  title: string;
  description: string;
  icon: LucideIcon;
  bullets: ReadonlyArray<string>;
  phaseLabel: string;
}

export function ComingSoon({
  title,
  description,
  icon: Icon,
  bullets,
  phaseLabel,
}: ComingSoonProps) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-14 sm:px-8">
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/studio">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Studio overview
          </Link>
        </Button>
      </div>
      <Card className="overflow-hidden border-primary/20">
        <CardContent className="p-8 sm:p-10">
          <div className="mb-2 flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-primary/30 text-primary text-[10px]"
            >
              <Sparkles className="mr-1 h-2.5 w-2.5" />
              {phaseLabel}
            </Badge>
          </div>
          <div className="mb-1 flex items-center gap-2.5">
            <Icon className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          </div>
          <p className="mb-6 text-sm text-muted-foreground">{description}</p>
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              In the next release
            </h3>
            <ul className="space-y-1.5 text-sm">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-primary" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
