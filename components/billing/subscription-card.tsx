"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  CreditCard,
  Sparkles,
  ArrowUpRight,
  Settings,
  AlertTriangle,
} from "lucide-react";
import { PlanPickerDialog } from "./plan-picker-dialog";
import { cn } from "@/lib/utils";

interface PlanShape {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  billing_interval: "month" | "year" | "one_time";
  features: Record<string, unknown> | null;
}

interface SubShape {
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
}

interface ApiResponse {
  plan: PlanShape | null;
  subscription: SubShape | null;
  error?: string;
}

/**
 * Host dashboard card — current plan + upgrade/manage actions.
 *
 * Behaviour
 * - On mount fetches /api/host/billing/subscription.
 * - If the host has no subscription (free tier): primary CTA is
 *   "Upgrade plan" → opens PlanPickerDialog.
 * - If they have a subscription: shows status + renewal date and a
 *   "Manage subscription" button → opens Stripe Customer Portal.
 * - "?billing=success" / "?billing=cancelled" / "?billing=returned" in
 *   the URL produces a one-shot toast and refetches state.
 */
export function SubscriptionCard() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState(false);
  const [portalPending, setPortalPending] = useState(false);

  async function refresh() {
    try {
      const res = await fetch("/api/host/billing/subscription", {
        cache: "no-store",
      });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setData(json);
    } catch (e) {
      console.error("[subscription-card] refresh failed:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Read URL params once on mount to surface checkout return state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;
    if (billing === "success") {
      toast.success("Subscription active. Welcome to your new plan!");
      // Re-fetch — webhook may take a moment, so retry once after 2s.
      refresh();
      setTimeout(refresh, 2000);
    } else if (billing === "cancelled") {
      toast.info("Checkout cancelled.");
    } else if (billing === "returned") {
      refresh();
    }
    // Strip the param so refresh doesn't re-toast.
    params.delete("billing");
    params.delete("session_id");
    const next = params.toString();
    const url = window.location.pathname + (next ? `?${next}` : "");
    window.history.replaceState({}, "", url);
  }, []);

  async function openPortal() {
    setPortalPending(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        throw new Error(json.error ?? "Could not open billing portal.");
      }
      window.location.href = json.url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Portal failed.");
      setPortalPending(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4" />
            Subscription
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading…</div>
        </CardContent>
      </Card>
    );
  }

  if (!data || !data.plan) {
    return null;
  }

  const { plan, subscription } = data;
  const isPaid = plan.price_cents > 0;
  const status = subscription?.status;
  const periodEnd = subscription?.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd)
    : null;
  const willCancel = !!subscription?.cancelAtPeriodEnd;
  const isPastDue = status === "past_due" || status === "unpaid";

  function priceLabel() {
    if (plan.price_cents === 0) return "Free";
    const dollars = (plan.price_cents / 100).toLocaleString(undefined, {
      style: "currency",
      currency: plan.currency.toUpperCase(),
      maximumFractionDigits: 2,
    });
    if (plan.billing_interval === "one_time") return dollars;
    return `${dollars}/${plan.billing_interval === "year" ? "yr" : "mo"}`;
  }

  return (
    <>
      <Card
        className={cn(
          isPastDue
            ? "border-rose-500/40"
            : isPaid
              ? "border-primary/30"
              : "",
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="h-4 w-4" />
                Subscription
              </CardTitle>
              <CardDescription className="mt-1">
                {isPaid
                  ? "Manage your plan or change billing details."
                  : "Upgrade to unlock cloud archive, YouTube upload, and more."}
              </CardDescription>
            </div>
            <PlanBadge isPaid={isPaid} status={status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Plan summary */}
          <div className="flex items-end justify-between gap-3 rounded-lg border border-border bg-muted/30 p-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Current plan
              </div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="text-lg font-semibold tracking-tight">
                  {plan.name}
                </span>
                <span className="font-mono text-sm text-muted-foreground">
                  {priceLabel()}
                </span>
              </div>
              {plan.description ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {plan.description}
                </p>
              ) : null}
            </div>
            {!isPaid ? (
              <Sparkles className="h-5 w-5 text-muted-foreground" />
            ) : null}
          </div>

          {/* Renewal info */}
          {periodEnd && status ? (
            <div
              className={cn(
                "rounded-lg border p-3 text-xs",
                isPastDue
                  ? "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300"
                  : willCancel
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"
                    : "border-border bg-muted/30 text-muted-foreground",
              )}
            >
              {isPastDue ? (
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Payment failed. Update your card in the billing portal to
                  keep access.
                </span>
              ) : willCancel ? (
                <>
                  Cancels on{" "}
                  <span className="font-medium">
                    {periodEnd.toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  . You'll keep access until then.
                </>
              ) : (
                <>
                  Renews on{" "}
                  <span className="font-medium">
                    {periodEnd.toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  .
                </>
              )}
            </div>
          ) : null}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {isPaid ? (
              <>
                <Button
                  variant="outline"
                  onClick={openPortal}
                  disabled={portalPending}
                >
                  <Settings className="mr-2 h-4 w-4" />
                  {portalPending ? "Opening…" : "Manage subscription"}
                </Button>
                <Button onClick={() => setPicker(true)}>
                  Change plan
                  <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <Button onClick={() => setPicker(true)}>
                <Sparkles className="mr-2 h-4 w-4" />
                Upgrade plan
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <PlanPickerDialog
        open={picker}
        onOpenChange={setPicker}
        currentPlanSlug={plan.slug}
      />
    </>
  );
}

function PlanBadge({
  isPaid,
  status,
}: {
  isPaid: boolean;
  status: string | null | undefined;
}) {
  if (status === "past_due" || status === "unpaid") {
    return (
      <Badge variant="outline" className="border-rose-500/40 text-rose-600 dark:text-rose-400">
        Past due
      </Badge>
    );
  }
  if (status === "trialing") {
    return (
      <Badge className="border-0 bg-blue-500/15 text-blue-700 dark:text-blue-300">
        Trial
      </Badge>
    );
  }
  if (status === "active" && isPaid) {
    return (
      <Badge className="border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
        Active
      </Badge>
    );
  }
  if (!isPaid) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Free
      </Badge>
    );
  }
  return null;
}
