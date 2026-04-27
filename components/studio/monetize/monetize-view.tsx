"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CircleDollarSign,
  CreditCard,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Lock,
  Zap,
  ArrowUpRight,
  RefreshCw,
  Building2,
  ShieldCheck,
  Banknote,
  Film,
  Sparkles,
  Clock,
  Star,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { PlanPickerDialog } from "@/components/billing/plan-picker-dialog";
import type { BillingPlan, FeatureKey } from "@/lib/billing/plans";

// ─── Types ────────────────────────────────────────────────────────────

export interface MonetizeViewProps {
  planName: string;
  planSlug: string;
  planSource: "admin" | "grant" | "stripe" | "default";
  planFeatures: Record<string, boolean>;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
  connectAccountId: string | null;
  connectChargesEnabled: boolean;
  connectPayoutsEnabled: boolean;
  connectDetailsSubmitted: boolean;
  isPlatformAdmin: boolean;
}

interface ConnectStatus {
  connected: boolean;
  accountId: string | null;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirements: string[];
  dashboardUrl: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function subStatusBadge(status: string | null, cancelAtPeriodEnd: boolean) {
  if (!status) return null;
  if (cancelAtPeriodEnd)
    return <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px]">Cancels at period end</Badge>;
  const map: Record<string, { cls: string; label: string }> = {
    active: { cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", label: "Active" },
    trialing: { cls: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300", label: "Trial" },
    past_due: { cls: "border-red-500/40 bg-red-500/10 text-destructive", label: "Payment overdue" },
    canceled: { cls: "border-muted text-muted-foreground", label: "Canceled" },
    paused: { cls: "border-amber-500/40 text-amber-700 dark:text-amber-300", label: "Paused" },
  };
  const { cls, label } = map[status] ?? { cls: "", label: status };
  return <Badge variant="outline" className={cn("text-[10px]", cls)}>{label}</Badge>;
}

// ─── Connect status card ──────────────────────────────────────────────

function ConnectStatusIcon({ status }: { status: "active" | "pending" | "incomplete" | "none" }) {
  if (status === "active")
    return <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10"><CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /></div>;
  if (status === "pending")
    return <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10"><Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" /></div>;
  if (status === "incomplete")
    return <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-500/10"><AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400" /></div>;
  return <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted"><Building2 className="h-5 w-5 text-muted-foreground" /></div>;
}

function ConnectSection({
  initialStatus,
  planAllows,
  isPlatformAdmin,
}: {
  initialStatus: ConnectStatus | null;
  planAllows: boolean;
  isPlatformAdmin: boolean;
}) {
  const [status, setStatus] = useState<ConnectStatus | null>(initialStatus);
  const [onboarding, setOnboarding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const canConnect = isPlatformAdmin || planAllows;

  const connectStatus: "active" | "pending" | "incomplete" | "none" = status?.connected
    ? status.chargesEnabled ? "active" : status.detailsSubmitted ? "pending" : "incomplete"
    : "none";

  const handleOnboard = async () => {
    setOnboarding(true);
    try {
      const res = await fetch("/api/billing/connect/onboard", { method: "POST" });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "Couldn't start onboarding."); return; }
      window.location.href = json.url;
    } catch { toast.error("Network error. Try again."); }
    finally { setOnboarding(false); }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/billing/connect/status");
      const json = await res.json();
      if (res.ok) setStatus(json);
    } catch { /* silent */ }
    finally { setRefreshing(false); }
  };

  return (
    <div className="space-y-4">
      {/* Status card */}
      <Card className={cn(
        connectStatus === "active" ? "border-emerald-500/30" :
        connectStatus === "pending" ? "border-amber-500/30" : "",
      )}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <ConnectStatusIcon status={connectStatus} />
              <div>
                <CardTitle className="text-base">Stripe Connect</CardTitle>
                <CardDescription className="text-xs">
                  Direct payouts to your bank account when you earn through the platform.
                </CardDescription>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing} className="shrink-0">
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status detail */}
          {connectStatus === "none" && (
            <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              Connect your bank account to receive payouts from replay purchases, tips, and subscription revenue. Powered by Stripe Express — takes about 5 minutes.
            </div>
          )}
          {connectStatus === "incomplete" && (
            <div className="flex items-start gap-2 rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 text-sm text-orange-700 dark:text-orange-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Onboarding started but not complete. Finish setting up your account to enable payouts.
            </div>
          )}
          {connectStatus === "pending" && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
              <Clock className="mt-0.5 h-4 w-4 shrink-0" />
              Account submitted — Stripe is reviewing your details. Charges will be enabled shortly.
            </div>
          )}
          {connectStatus === "active" && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: "Charges", ok: status?.chargesEnabled ?? false },
                { label: "Payouts", ok: status?.payoutsEnabled ?? false },
                { label: "Verified", ok: status?.detailsSubmitted ?? false },
              ].map(({ label, ok }) => (
                <div key={label} className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                  {ok
                    ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    : <XCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  <span className="text-xs font-medium">{label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Requirements */}
          {(status?.requirements ?? []).length > 0 && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
              <p className="mb-1.5 text-xs font-medium text-red-700 dark:text-red-400">Action required</p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {status!.requirements.slice(0, 5).map((r) => (
                  <li key={r} className="flex items-start gap-1.5">
                    <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                    {r.replace(/_/g, " ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          {!canConnect ? (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              <Lock className="mr-1.5 inline h-3 w-3" />
              Monetization requires a paid plan. Upgrade below to enable Stripe Connect.
            </div>
          ) : connectStatus === "none" || connectStatus === "incomplete" ? (
            <Button className="w-full gap-2" onClick={handleOnboard} disabled={onboarding}>
              {onboarding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
              {onboarding ? "Redirecting to Stripe…" : connectStatus === "incomplete" ? "Continue onboarding" : "Set up payouts"}
            </Button>
          ) : status?.dashboardUrl ? (
            <Button variant="outline" className="w-full gap-2" asChild>
              <a href={status.dashboardUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Open Stripe Express Dashboard
              </a>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {/* Express dashboard info */}
      {connectStatus === "active" && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
          <Banknote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Earnings &amp; payouts</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Your full earnings history, payout schedule, and bank details live in the Stripe Express Dashboard. Stripe handles all compliance, 1099s, and currency conversion.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Feature gate card ────────────────────────────────────────────────

function FeatureGateCard({
  title,
  description,
  icon,
  enabled,
  comingSoon,
  onUpgrade,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  enabled: boolean;
  comingSoon?: boolean;
  onUpgrade?: () => void;
}) {
  return (
    <Card className={cn("transition-colors", !enabled && "opacity-70")}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
              enabled ? "bg-primary/10" : "bg-muted",
            )}>
              {icon}
            </div>
            <div>
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                {title}
                {comingSoon && (
                  <Badge variant="outline" className="text-[9px] border-violet-500/30 text-violet-600 dark:text-violet-400">
                    Coming soon
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="mt-0.5 text-xs">{description}</CardDescription>
            </div>
          </div>
          {enabled
            ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            : <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          }
        </div>
      </CardHeader>
      {!enabled && onUpgrade && (
        <CardContent className="pt-0">
          <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs" onClick={onUpgrade}>
            <Zap className="h-3 w-3 text-primary" />
            Upgrade to unlock
          </Button>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Main view ────────────────────────────────────────────────────────

export function MonetizeView({
  planName,
  planSlug,
  planSource,
  planFeatures,
  subscriptionStatus,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  hasCustomer,
  connectAccountId,
  connectChargesEnabled,
  connectPayoutsEnabled,
  connectDetailsSubmitted,
  isPlatformAdmin,
}: MonetizeViewProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  // Handle Stripe Connect callback status params from URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const connect = params.get("connect");
    if (!connect) return;
    const reason = params.get("reason");
    if (connect === "connected") toast.success("Stripe Connect active! Charges enabled.");
    else if (connect === "pending") toast.info("Stripe account submitted — review in progress.");
    else if (connect === "incomplete") toast.warning("Onboarding not yet complete. Finish it to enable payouts.");
    else if (connect === "error") toast.error(reason ? `Connect error: ${reason}` : "Connect setup failed.");
    params.delete("connect"); params.delete("reason");
    const next = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (next ? `?${next}` : ""));
  }, []);

  const handlePortal = async () => {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "Couldn't open billing portal."); return; }
      window.location.href = json.url;
    } catch { toast.error("Network error."); }
    finally { setPortalLoading(false); }
  };

  const hasMonetizationBasic = isPlatformAdmin || !!planFeatures.monetization_basic;
  const hasPaywall = isPlatformAdmin || !!planFeatures.monetization_paywall;
  const isFreePlan = planSlug === "free" || planSource === "default";

  const connectStatus: ConnectStatus | null = connectAccountId ? {
    connected: true,
    accountId: connectAccountId,
    detailsSubmitted: connectDetailsSubmitted,
    chargesEnabled: connectChargesEnabled,
    payoutsEnabled: connectPayoutsEnabled,
    requirements: [],
    dashboardUrl: `https://dashboard.stripe.com/connect/accounts/${connectAccountId}`,
  } : null;

  return (
    <div className="space-y-8">
      {/* ─── Overview stats bar ──────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className={cn(!isFreePlan && "border-primary/20 bg-primary/5")}>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              <CircleDollarSign className="h-3.5 w-3.5" />
              Current plan
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-xl font-semibold">{planName}</span>
              {planSource === "admin" && (
                <Badge variant="outline" className="text-[9px] border-violet-500/30 text-violet-600 dark:text-violet-400">Admin</Badge>
              )}
              {planSource === "grant" && (
                <Badge variant="outline" className="text-[9px] border-sky-500/30 text-sky-600 dark:text-sky-400">Granted</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Subscription
            </div>
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              {subscriptionStatus
                ? subStatusBadge(subscriptionStatus, cancelAtPeriodEnd)
                : <span className="text-sm text-muted-foreground">Free plan</span>}
            </div>
            {currentPeriodEnd && (
              <div className="mt-0.5 text-xs text-muted-foreground">
                {cancelAtPeriodEnd ? "Ends" : "Renews"} {fmt(currentPeriodEnd)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={cn(connectChargesEnabled && "border-emerald-500/30")}>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              Payouts
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              {connectChargesEnabled
                ? <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" />Active</span>
                : connectDetailsSubmitted
                  ? <span className="flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400"><Clock className="h-4 w-4" />Pending</span>
                  : <span className="text-sm text-muted-foreground">Not set up</span>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Main tabs ───────────────────────────────────────────── */}
      <Tabs defaultValue="billing">
        <TabsList>
          <TabsTrigger value="billing" className="gap-1.5 text-xs">
            <CreditCard className="h-3.5 w-3.5" />
            Billing
          </TabsTrigger>
          <TabsTrigger value="connect" className="gap-1.5 text-xs">
            <Building2 className="h-3.5 w-3.5" />
            Payouts
          </TabsTrigger>
          <TabsTrigger value="features" className="gap-1.5 text-xs">
            <Star className="h-3.5 w-3.5" />
            Features
          </TabsTrigger>
        </TabsList>

        {/* ─── Billing tab ────────────────────────────────────────── */}
        <TabsContent value="billing" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-sm font-semibold">Plan &amp; subscription</CardTitle>
              <CardDescription className="text-xs">
                Manage your active plan, cancel, or switch from the Stripe billing portal.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {/* Plan detail row */}
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div>
                  <div className="text-sm font-medium">{planName}</div>
                  <div className="text-xs text-muted-foreground">
                    {isFreePlan ? "No billing — free forever" : `${subscriptionStatus ?? "active"} · renews ${fmt(currentPeriodEnd)}`}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  {!isFreePlan && hasCustomer && (
                    <Button variant="outline" size="sm" onClick={handlePortal} disabled={portalLoading}>
                      {portalLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="mr-1.5 h-3.5 w-3.5" />}
                      Manage billing
                    </Button>
                  )}
                  {(isFreePlan || !hasMonetizationBasic) && planSource !== "admin" && (
                    <Button size="sm" className="gap-1.5" onClick={() => setPickerOpen(true)}>
                      <Zap className="h-3.5 w-3.5" />
                      Upgrade
                    </Button>
                  )}
                </div>
              </div>

              {/* Payment failed banner */}
              {subscriptionStatus === "past_due" && (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">Payment overdue</p>
                    <p className="text-xs mt-0.5 text-muted-foreground">Update your payment method in the billing portal to keep your plan active.</p>
                  </div>
                  <Button size="sm" variant="outline" className="ml-auto shrink-0" onClick={handlePortal}>
                    Fix now
                  </Button>
                </div>
              )}

              {/* Cancel notice */}
              {cancelAtPeriodEnd && currentPeriodEnd && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                  Your plan cancels on {fmt(currentPeriodEnd)}. You'll keep access until then.
                </div>
              )}

              {/* Free plan CTA */}
              {isFreePlan && (
                <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-4">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Unlock monetization features</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Upgrade to a paid plan to enable Stripe Connect payouts, replay paywalls, and subscriber-only content.
                    </p>
                  </div>
                  <Button size="sm" className="shrink-0 gap-1.5" onClick={() => setPickerOpen(true)}>
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    See plans
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Connect tab ────────────────────────────────────────── */}
        <TabsContent value="connect" className="mt-4">
          <ConnectSection
            initialStatus={connectStatus}
            planAllows={hasMonetizationBasic}
            isPlatformAdmin={isPlatformAdmin}
          />
        </TabsContent>

        {/* ─── Features tab ───────────────────────────────────────── */}
        <TabsContent value="features" className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FeatureGateCard
              title="Stripe Connect payouts"
              description="Receive direct bank payouts when you earn through the platform."
              icon={<Building2 className={cn("h-4 w-4", hasMonetizationBasic ? "text-primary" : "text-muted-foreground")} />}
              enabled={hasMonetizationBasic}
              onUpgrade={() => setPickerOpen(true)}
            />
            <FeatureGateCard
              title="Replay paywall"
              description="Gate individual replays behind a one-time purchase price."
              icon={<Film className={cn("h-4 w-4", hasPaywall ? "text-primary" : "text-muted-foreground")} />}
              enabled={hasPaywall}
              comingSoon
              onUpgrade={() => setPickerOpen(true)}
            />
            <FeatureGateCard
              title="Subscriber-only replays"
              description="Lock replays to your Insider Circle subscribers only."
              icon={<Sparkles className={cn("h-4 w-4", hasPaywall ? "text-primary" : "text-muted-foreground")} />}
              enabled={hasPaywall}
              comingSoon
              onUpgrade={() => setPickerOpen(true)}
            />
            <FeatureGateCard
              title="Plan upgrade prompts"
              description="Show contextual upgrade CTAs at every feature gate."
              icon={<Zap className="h-4 w-4 text-primary" />}
              enabled={true}
            />
          </div>

          {/* Roadmap banner */}
          <div className="flex items-start gap-3 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-4">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
            <div>
              <p className="text-sm font-medium text-violet-700 dark:text-violet-300">Paywall launch coming soon</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Replay paywalls and subscriber-only content require a single database migration that will ship in the next release.
                Set up Stripe Connect now so you're ready to earn from day one.
              </p>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Plan picker dialog */}
      <PlanPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        currentPlanSlug={planSlug}
      />
    </div>
  );
}
