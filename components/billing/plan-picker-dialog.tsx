"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Check, Sparkles, Loader2, ArrowUpRight } from "lucide-react";
import { type BillingPlan, FEATURE_KEYS, type FeatureKey } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

const FEATURE_LABELS: Record<FeatureKey, string> = {
  // Live & storage
  insider_circle: "Insider Circle broadcasts",
  cloud_archive: "Cloud archive of ended streams",
  youtube_upload: "Upload to your YouTube channel",
  // Live control room
  live_watermark: "Logo watermark on stream",
  live_branded_page: "Branded watch page",
  live_premium_layouts: "Premium layouts (Split / PiP)",
  // Replay Library
  replay_publishing: "Replay publishing",
  replay_likes: "Replay likes",
  replay_comments: "Replay comments",
  replay_featured: "Featured replays",
  replay_clips: "Replay clips",
  replay_analytics: "Replay analytics",
  // Distribution Hub
  distribution_youtube: "YouTube distribution",
  distribution_export: "Export & download replays",
  // Audience CRM
  audience_crm: "Audience CRM",
  // Monetization Center
  monetization_basic: "Basic monetization",
  monetization_paywall: "Paywall & gated content",
  // Analytics & Insights
  live_analytics: "Live stream analytics & Insights",
};

function priceLine(p: BillingPlan): string {
  if (p.price_cents === 0) return "Free forever";
  const dollars = (p.price_cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: p.currency.toUpperCase(),
    maximumFractionDigits: 2,
  });
  if (p.billing_interval === "one_time") return dollars;
  return `${dollars} / ${p.billing_interval === "year" ? "year" : "month"}`;
}

export function PlanPickerDialog({
  open,
  onOpenChange,
  currentPlanSlug,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentPlanSlug: string | null;
}) {
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkoutPlanId, setCheckoutPlanId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/host/billing/plans", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { plans?: BillingPlan[]; error?: string }) => {
        if (j.error) throw new Error(j.error);
        setPlans(j.plans ?? []);
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : "Failed to load plans.");
      })
      .finally(() => setLoading(false));
  }, [open]);

  function handleSelect(plan: BillingPlan) {
    if (plan.slug === currentPlanSlug) return;
    if (plan.price_cents === 0) {
      // Downgrade to free goes through the Customer Portal so the
      // user explicitly cancels their paid sub.
      handlePortal();
      return;
    }
    setCheckoutPlanId(plan.id);
    startTransition(async () => {
      try {
        const res = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId: plan.id }),
        });
        const json = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !json.url) {
          throw new Error(json.error ?? "Checkout failed");
        }
        // Hard navigate so we leave the SPA state cleanly.
        window.location.href = json.url;
      } catch (e) {
        setCheckoutPlanId(null);
        toast.error(e instanceof Error ? e.message : "Checkout failed.");
      }
    });
  }

  async function handlePortal() {
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        throw new Error(json.error ?? "Could not open the billing portal.");
      }
      window.location.href = json.url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Portal failed.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="space-y-1 border-b border-border bg-muted/30 px-6 py-4 text-left">
          <DialogTitle className="text-base">Choose a plan</DialogTitle>
          <DialogDescription className="text-xs">
            Switch tiers any time. Paid plans are billed through Stripe;
            downgrades are handled via the Customer Portal.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(90vh-9rem)] overflow-y-auto p-6">
          {loading ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Loading plans…
            </div>
          ) : plans.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No plans available. An admin needs to create a plan first.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {plans.map((plan) => {
                const isCurrent = plan.slug === currentPlanSlug;
                const isCheckingOut = checkoutPlanId === plan.id;
                const enabledFeatures = FEATURE_KEYS.filter(
                  (k) => plan.features?.[k],
                );
                return (
                  <div
                    key={plan.id}
                    className={cn(
                      "flex flex-col rounded-xl border p-5 transition",
                      isCurrent
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border hover:border-primary/40 hover:shadow-sm",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold tracking-tight">
                          {plan.name}
                        </div>
                        {plan.description ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {plan.description}
                          </p>
                        ) : null}
                      </div>
                      {isCurrent ? (
                        <Badge className="border-0 bg-primary/15 text-primary hover:bg-primary/20">
                          Current
                        </Badge>
                      ) : null}
                    </div>

                    <div className="mt-4 font-mono text-2xl font-semibold tracking-tight">
                      {priceLine(plan)}
                    </div>

                    <ul className="mt-4 space-y-2 text-sm">
                      {enabledFeatures.length === 0 ? (
                        <li className="flex items-center gap-2 text-muted-foreground">
                          <Sparkles className="h-3.5 w-3.5" />
                          Live streaming with chat and viewers
                        </li>
                      ) : (
                        enabledFeatures.map((k) => (
                          <li
                            key={k}
                            className="flex items-start gap-2 text-foreground"
                          >
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                            {FEATURE_LABELS[k]}
                          </li>
                        ))
                      )}
                    </ul>

                    <div className="mt-5 flex-1" />
                    <Button
                      className="mt-2 w-full"
                      variant={isCurrent ? "outline" : "default"}
                      disabled={isCurrent || isCheckingOut}
                      onClick={() => handleSelect(plan)}
                    >
                      {isCheckingOut ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      {isCurrent
                        ? "Current plan"
                        : plan.price_cents === 0
                          ? "Switch to free"
                          : isCheckingOut
                            ? "Opening Checkout…"
                            : `Upgrade to ${plan.name}`}
                      {!isCurrent && plan.price_cents > 0 && !isCheckingOut ? (
                        <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                      ) : null}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
