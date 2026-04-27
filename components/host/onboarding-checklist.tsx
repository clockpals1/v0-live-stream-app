"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Circle,
  Sparkles,
  X,
  ArrowRight,
  User as UserIcon,
  Video,
  Youtube,
  CreditCard,
} from "lucide-react";

/**
 * Onboarding checklist — surfaces a "get started" card on the host
 * dashboard for new hosts whose accounts are incomplete.
 *
 * DESIGN
 * ------
 * Soft, non-blocking. We never gate functionality on completion —
 * a host with a partially-set-up account can still stream. The
 * checklist just makes the obvious next moves visible.
 *
 * The card is dismissible. We persist dismissal in localStorage
 * keyed on user id, NOT in the DB, because:
 *   - It's a soft UI preference; we'd rather show it again on a new
 *     device than burn a column on the hosts table.
 *   - Avoids a migration round-trip just to hide a card.
 *   - If the host clears storage they see it again, which is fine —
 *     the items are either already done (and shown as ticked) or
 *     genuinely still useful suggestions.
 *
 * The card auto-hides once every MANDATORY step is complete, so the
 * "dismiss" affordance is mostly for hosts who want to skip the
 * optional items and reduce dashboard clutter.
 *
 * MANDATORY vs OPTIONAL
 * ---------------------
 * The display-name and first-stream items are mandatory: without
 * them the dashboard is genuinely empty. YouTube + plan review are
 * marked optional (small "Optional" badge) — useful but not required
 * to use the platform.
 *
 * STATE SOURCES
 * -------------
 * Most state comes from props (host + stream count) so we don't pay
 * for an extra round-trip on first render. YouTube connection state
 * is fetched client-side once because it depends on a separate API
 * with its own plan/server-config gates we don't want to duplicate
 * here.
 */

interface OnboardingChecklistProps {
  userId: string;
  displayName: string | null;
  streamCount: number;
  planSlug: string | null;
}

interface YoutubeStatus {
  connected: { channelId: string } | null;
  serverConfigured: boolean;
  planAllows: boolean;
}

export function OnboardingChecklist({
  userId,
  displayName,
  streamCount,
  planSlug,
}: OnboardingChecklistProps) {
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [youtube, setYoutube] = useState<YoutubeStatus | null>(null);

  // Check dismissal preference. We avoid SSR/hydration mismatch by
  // starting in `null` (= "we don't know yet") and only flipping to
  // a concrete boolean on the client.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`onboarding-dismissed-${userId}`);
      setDismissed(raw === "1");
    } catch {
      // Private mode or storage disabled — treat as not dismissed.
      setDismissed(false);
    }
  }, [userId]);

  // Fetch YouTube state once; failures are swallowed (the item just
  // shows as not-connected, which is the correct default).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/host/integrations/youtube/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        setYoutube(j as YoutubeStatus);
      })
      .catch(() => {
        /* swallow */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Derive completion. "Display name set to something other than the
  // raw auto-generated default" is hard to detect reliably, so we
  // accept any non-empty trim as complete. Better to over-tick than
  // nag a host whose name happens to match their email prefix.
  const profileDone = !!displayName && displayName.trim().length > 0;
  const firstStreamDone = streamCount > 0;
  const youtubeDone = !!youtube?.connected;
  // We consider the plan "reviewed" once they're on anything other
  // than a brand-new free plan, OR if Stripe isn't configured yet
  // (in which case there's nothing for them to do here).
  const planReviewed = planSlug !== null && planSlug !== "free";

  const items = [
    {
      key: "profile",
      done: profileDone,
      mandatory: true,
      icon: UserIcon,
      title: "Add your display name",
      blurb: "How viewers see you in chat and on stream pages.",
      cta: { label: "Set name", href: "/host/settings#profile" },
    },
    {
      key: "stream",
      done: firstStreamDone,
      mandatory: true,
      icon: Video,
      title: "Create your first stream",
      blurb: "Use the form below to start a room and go live.",
      cta: null,
    },
    {
      key: "youtube",
      done: youtubeDone,
      mandatory: false,
      icon: Youtube,
      title: "Connect YouTube",
      blurb: "Push recordings to your channel after each stream.",
      cta: { label: "Connect", href: "/host/settings#integrations" },
    },
    {
      key: "plan",
      done: planReviewed,
      mandatory: false,
      icon: CreditCard,
      title: "Review your plan",
      blurb: "Unlock cloud archives, longer retention, and more.",
      cta: { label: "View plans", href: "/host/settings#subscription" },
    },
  ] as const;

  const totalMandatory = items.filter((i) => i.mandatory).length;
  const doneMandatory = items.filter((i) => i.mandatory && i.done).length;
  const totalDone = items.filter((i) => i.done).length;
  const allMandatoryDone = doneMandatory === totalMandatory;

  // Don't render until we know dismissal state (avoids a flash on
  // page load for hosts who already dismissed).
  if (dismissed === null) return null;

  // Hide when fully dismissed OR when every mandatory step is done
  // AND the host has NO action left to take. The second condition
  // means a host who finished mandatory items but skipped optional
  // ones won't see the card forever — once mandatory is clean we
  // fade it out automatically.
  if (dismissed || allMandatoryDone) return null;

  function handleDismiss() {
    try {
      window.localStorage.setItem(`onboarding-dismissed-${userId}`, "1");
    } catch {
      /* swallow */
    }
    setDismissed(true);
  }

  return (
    <Card className="mb-6 border-primary/30 bg-gradient-to-br from-primary/5 via-background to-background">
      <CardContent className="p-5 sm:p-6">
        {/* ─── header ───────────────────────────────────────────── */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight">
                Get started
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {totalDone}/{items.length} done · finish setup to make the most
                of your account.
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            aria-label="Dismiss onboarding checklist"
            className="-mr-2 h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* ─── progress bar ─────────────────────────────────────── */}
        <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-500"
            style={{ width: `${(totalDone / items.length) * 100}%` }}
          />
        </div>

        {/* ─── checklist items ──────────────────────────────────── */}
        <ul className="space-y-3">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <li
                key={item.key}
                className={
                  "flex items-start gap-3 rounded-lg border p-3 transition-colors " +
                  (item.done
                    ? "border-emerald-500/20 bg-emerald-500/5"
                    : "border-border bg-background hover:bg-muted/30")
                }
              >
                <div className="mt-0.5 shrink-0">
                  {item.done ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground/50" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon
                      className={
                        "h-3.5 w-3.5 " +
                        (item.done
                          ? "text-emerald-500"
                          : "text-muted-foreground")
                      }
                    />
                    <span
                      className={
                        "text-sm font-medium " +
                        (item.done ? "text-foreground/80 line-through" : "")
                      }
                    >
                      {item.title}
                    </span>
                    {!item.mandatory && !item.done && (
                      <Badge
                        variant="outline"
                        className="h-4 px-1.5 text-[10px] font-normal text-muted-foreground"
                      >
                        Optional
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.blurb}
                  </p>
                </div>
                {!item.done && item.cta && (
                  <Button
                    variant="ghost"
                    size="sm"
                    asChild
                    className="shrink-0 self-center"
                  >
                    <Link href={item.cta.href}>
                      {item.cta.label}
                      <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
