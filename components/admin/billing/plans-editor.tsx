"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Star,
  StarOff,
  Sparkles,
  Tag,
  CircleDollarSign,
  Wand2,
  Eye,
} from "lucide-react";
import {
  FEATURE_KEYS,
  FEATURE_CATEGORIES,
  type BillingPlan,
  type FeatureKey,
} from "@/lib/billing/plans";
import {
  Heart,
  MessageSquare,
  Star as StarIcon,
  Scissors,
  BarChart3,
  Youtube,
  Download,
  Users as UsersIcon,
  CircleDollarSign as DollarIcon,
  Lock as LockIcon,
  Globe,
  ImageIcon,
  Palette,
  Layout as LayoutIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const FEATURE_LABELS: Record<
  FeatureKey,
  { label: string; help: string; icon: ReactNode }
> = {
  insider_circle: {
    label: "Insider Circle",
    help: "Collect subscribers and send rich-HTML broadcast emails.",
    icon: <Sparkles className="h-3.5 w-3.5" />,
  },
  cloud_archive: {
    label: "Cloud archive",
    help: "Save ended streams to Cloudflare R2 storage.",
    icon: <Wand2 className="h-3.5 w-3.5" />,
  },
  youtube_upload: {
    label: "YouTube upload",
    help: "Upload ended streams to the host's connected YouTube channel.",
    icon: <Wand2 className="h-3.5 w-3.5" />,
  },
  // ─── Live Control Room — production-time premium tools ───────────────
  live_watermark: {
    label: "Logo watermark",
    help: "Hosts can place a logo in any corner of their live preview.",
    icon: <ImageIcon className="h-3.5 w-3.5" />,
  },
  live_branded_page: {
    label: "Branded watch page",
    help: "Custom theme + accent colour applied to the public watch page.",
    icon: <Palette className="h-3.5 w-3.5" />,
  },
  live_premium_layouts: {
    label: "Premium layouts",
    help: "Solo / Split-screen / Picture-in-Picture compositions during a live show.",
    icon: <LayoutIcon className="h-3.5 w-3.5" />,
  },
  // ─── Replay Library ───────────────────────────────────────────────────
  replay_publishing: {
    label: "Replay publishing",
    help: "Hosts can publish recordings as replays with title, description, and thumbnail.",
    icon: <Globe className="h-3.5 w-3.5" />,
  },
  replay_likes: {
    label: "Replay likes",
    help: "Viewers can like and react to published replays.",
    icon: <Heart className="h-3.5 w-3.5" />,
  },
  replay_comments: {
    label: "Replay comments",
    help: "Viewers can leave comments on published replays.",
    icon: <MessageSquare className="h-3.5 w-3.5" />,
  },
  replay_featured: {
    label: "Featured replays",
    help: "Hosts can pin replays to the top of their public page.",
    icon: <StarIcon className="h-3.5 w-3.5" />,
  },
  replay_clips: {
    label: "Replay clips",
    help: "Cut highlight clips out of full-length replays.",
    icon: <Scissors className="h-3.5 w-3.5" />,
  },
  replay_analytics: {
    label: "Replay analytics",
    help: "Per-replay viewer counts, watch time, drop-off charts.",
    icon: <BarChart3 className="h-3.5 w-3.5" />,
  },
  // ─── Distribution Hub ─────────────────────────────────────────────────
  distribution_youtube: {
    label: "YouTube distribution",
    help: "Push published replays to the host's YouTube channel from the Studio.",
    icon: <Youtube className="h-3.5 w-3.5" />,
  },
  distribution_export: {
    label: "Export & download",
    help: "Generate downloadable archives and one-off exports.",
    icon: <Download className="h-3.5 w-3.5" />,
  },
  // ─── Audience CRM ────────────────────────────────────────────────────
  audience_crm: {
    label: "Audience CRM",
    help: "Subscriber lists, segmentation, engagement history.",
    icon: <UsersIcon className="h-3.5 w-3.5" />,
  },
  // ─── Monetization Center ─────────────────────────────────────────────
  monetization_basic: {
    label: "Monetization basics",
    help: "Earnings dashboard, plan status, basic payout overview.",
    icon: <DollarIcon className="h-3.5 w-3.5" />,
  },
  monetization_paywall: {
    label: "Replay paywall",
    help: "Gate individual replays behind a one-time price or subscription tier.",
    icon: <LockIcon className="h-3.5 w-3.5" />,
  },
  // ─── Analytics & Insights ─────────────────────────────────────────────
  live_analytics: {
    label: "Live analytics & Insights",
    help: "Viewer trends, peak concurrents, chat activity, subscriber growth, replay performance, and stream retention in the Studio Insights page.",
    icon: <BarChart3 className="h-3.5 w-3.5" />,
  },
};

function priceLabel(p: BillingPlan): string {
  if (p.price_cents === 0) return "Free";
  const dollars = p.price_cents / 100;
  const formatted = dollars.toLocaleString(undefined, {
    style: "currency",
    currency: p.currency.toUpperCase(),
    maximumFractionDigits: 2,
  });
  if (p.billing_interval === "one_time") return formatted;
  return `${formatted}/${p.billing_interval === "year" ? "yr" : "mo"}`;
}

interface PlanDraft {
  slug: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  billing_interval: "month" | "year" | "one_time";
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
  features: Partial<Record<FeatureKey, boolean>>;
  stripe_price_id_test: string;
  stripe_price_id_live: string;
}

function emptyDraft(): PlanDraft {
  return {
    slug: "",
    name: "",
    description: "",
    price_cents: 0,
    currency: "usd",
    billing_interval: "month",
    is_active: true,
    is_default: false,
    sort_order: 0,
    features: {},
    stripe_price_id_test: "",
    stripe_price_id_live: "",
  };
}

function fromPlan(p: BillingPlan): PlanDraft {
  const features: Partial<Record<FeatureKey, boolean>> = {};
  for (const k of FEATURE_KEYS) {
    features[k] = !!p.features?.[k];
  }
  return {
    slug: p.slug,
    name: p.name,
    description: p.description ?? "",
    price_cents: p.price_cents,
    currency: p.currency,
    billing_interval: p.billing_interval,
    is_active: p.is_active,
    is_default: p.is_default,
    sort_order: p.sort_order,
    features,
    stripe_price_id_test: p.stripe_price_id_test ?? "",
    stripe_price_id_live: p.stripe_price_id_live ?? "",
  };
}

export function PlansEditor() {
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<BillingPlan | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();

  async function refresh() {
    const res = await fetch("/api/admin/billing/plans", { cache: "no-store" });
    const json = (await res.json()) as { plans?: BillingPlan[]; error?: string };
    if (!res.ok) {
      toast.error(json.error ?? "Failed to load plans.");
      return;
    }
    setPlans(json.plans ?? []);
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function handleSave(draft: PlanDraft, planId?: string) {
    return new Promise<void>((resolve, reject) => {
      startTransition(async () => {
        try {
          const body: Record<string, unknown> = {
            name: draft.name,
            description: draft.description || null,
            price_cents: draft.price_cents,
            currency: draft.currency,
            billing_interval: draft.billing_interval,
            is_active: draft.is_active,
            is_default: draft.is_default,
            sort_order: draft.sort_order,
            features: draft.features,
            stripe_price_id_test: draft.stripe_price_id_test || null,
            stripe_price_id_live: draft.stripe_price_id_live || null,
          };
          if (!planId) body.slug = draft.slug;
          const url = planId
            ? `/api/admin/billing/plans/${planId}`
            : "/api/admin/billing/plans";
          const method = planId ? "PATCH" : "POST";
          const res = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const json = (await res.json()) as { error?: string };
          if (!res.ok) throw new Error(json.error ?? "Save failed");
          await refresh();
          toast.success(planId ? "Plan updated." : "Plan created.");
          resolve();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Save failed.");
          reject(e);
        }
      });
    });
  }

  async function handleDelete(plan: BillingPlan) {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/billing/plans/${plan.id}`, {
          method: "DELETE",
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Delete failed");
        await refresh();
        toast.success(`Deleted ${plan.name}.`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Delete failed.");
      }
    });
  }

  async function handlePromoteDefault(plan: BillingPlan) {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/billing/plans/${plan.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_default: true }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Update failed");
        await refresh();
        toast.success(`${plan.name} is now the default plan.`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Update failed.");
      }
    });
  }

  async function handleToggleActive(plan: BillingPlan) {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/billing/plans/${plan.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: !plan.is_active }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Update failed");
        await refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Update failed.");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 border-b border-border bg-muted/20 pb-5">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Tag className="h-4 w-4" />
            Plans
          </CardTitle>
          <CardDescription className="mt-1 max-w-prose">
            Subscription tiers, pricing, and feature access. Create the
            matching products in Stripe first, then paste the
            <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              price_
            </code>
            ids on each plan.
          </CardDescription>
        </div>
        <Dialog open={creating} onOpenChange={setCreating}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New plan
            </Button>
          </DialogTrigger>
          <PlanDialog
            key={creating ? "new" : "closed"}
            title="Create plan"
            initial={emptyDraft()}
            isCreate
            pending={pending}
            onSubmit={async (d) => {
              await handleSave(d);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        </Dialog>
      </CardHeader>

      <CardContent className="space-y-2 pt-5">
        {loading ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Loading plans…
          </div>
        ) : plans.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No plans yet. Click{" "}
            <span className="font-medium text-foreground">New plan</span> to add
            one.
          </div>
        ) : (
          plans.map((plan) => (
            <div
              key={plan.id}
              className={cn(
                "group flex flex-wrap items-center gap-4 rounded-lg border bg-card px-4 py-3.5 transition",
                "hover:border-primary/40 hover:shadow-sm",
                plan.is_default
                  ? "border-amber-500/40 bg-amber-500/5"
                  : "border-border",
              )}
            >
              {/* Left: identity + features */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-semibold tracking-tight">
                    {plan.name}
                  </span>
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {plan.slug}
                  </code>
                  {plan.is_default && (
                    <Badge className="gap-1 border-0 bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300">
                      <Star className="h-3 w-3 fill-current" />
                      Default
                    </Badge>
                  )}
                  {!plan.is_active && (
                    <Badge variant="outline" className="text-muted-foreground">
                      Inactive
                    </Badge>
                  )}
                </div>
                {plan.description ? (
                  <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                    {plan.description}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-mono text-sm font-bold text-foreground">
                    {priceLabel(plan)}
                  </span>
                  {FEATURE_KEYS.filter((k) => plan.features?.[k]).length === 0 ? (
                    <span className="text-muted-foreground">
                      · No features enabled
                    </span>
                  ) : (
                    <>
                      <span className="text-muted-foreground/60">·</span>
                      {FEATURE_KEYS.filter((k) => plan.features?.[k]).map(
                        (k) => (
                          <Badge
                            key={k}
                            variant="outline"
                            className="gap-1 font-normal"
                          >
                            {FEATURE_LABELS[k].icon}
                            {FEATURE_LABELS[k].label}
                          </Badge>
                        ),
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Right: actions */}
              <div className="flex shrink-0 items-center gap-1">
                <ToggleChip
                  on={plan.is_active}
                  disabled={pending}
                  onChange={() => handleToggleActive(plan)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handlePromoteDefault(plan)}
                  disabled={plan.is_default || pending || !plan.is_active}
                  title={
                    plan.is_default
                      ? "Already default"
                      : !plan.is_active
                        ? "Activate first"
                        : "Make default for new hosts"
                  }
                  className={
                    plan.is_default
                      ? "text-amber-500 hover:text-amber-600"
                      : ""
                  }
                >
                  {plan.is_default ? (
                    <Star className="h-4 w-4 fill-current" />
                  ) : (
                    <StarOff className="h-4 w-4" />
                  )}
                </Button>
                <Dialog
                  open={editing?.id === plan.id}
                  onOpenChange={(o) => setEditing(o ? plan : null)}
                >
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" title="Edit plan">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </DialogTrigger>
                  {editing?.id === plan.id && (
                    <PlanDialog
                      key={plan.id}
                      title={`Edit ${plan.name}`}
                      initial={fromPlan(plan)}
                      isCreate={false}
                      pending={pending}
                      onSubmit={async (d) => {
                        await handleSave(d, plan.id);
                        setEditing(null);
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  )}
                </Dialog>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={plan.slug === "free" || pending}
                      title={
                        plan.slug === "free"
                          ? "The free plan cannot be deleted."
                          : "Delete plan"
                      }
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {plan.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This is permanent. If any host is currently on this
                        plan, the deletion will be blocked.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelete(plan)}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ─── Plan editor dialog ────────────────────────────────────────────────

function Section({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header className="space-y-0.5">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {icon}
          {title}
        </h3>
        {description ? (
          <p className="text-xs text-muted-foreground/80">{description}</p>
        ) : null}
      </header>
      <div>{children}</div>
    </section>
  );
}

function PlanDialog({
  title,
  initial,
  isCreate,
  pending,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial: PlanDraft;
  isCreate: boolean;
  pending: boolean;
  onSubmit: (d: PlanDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<PlanDraft>(initial);
  const set = <K extends keyof PlanDraft>(k: K, v: PlanDraft[K]) =>
    setDraft((p) => ({ ...p, [k]: v }));

  const enabledFeatures = FEATURE_KEYS.filter((k) => draft.features[k]);

  return (
    <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
      <DialogHeader className="space-y-1 border-b border-border bg-muted/30 px-6 py-4 text-left">
        <DialogTitle className="flex items-center gap-2 text-base">
          {title}
        </DialogTitle>
        <DialogDescription className="text-xs">
          Pricing is in cents (e.g. 1900 = $19.00). Stripe price IDs are
          optional in Phase 1; you'll wire them when payments go live.
        </DialogDescription>
      </DialogHeader>

      <div className="grid max-h-[calc(90vh-9rem)] gap-7 overflow-y-auto px-6 py-6">
        {/* IDENTITY ─────────────────────────────────────────────────── */}
        <Section
          title="Identity"
          description="The user-facing name and the URL slug."
          icon={<Tag className="h-3 w-3" />}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="plan-name" className="text-xs">
                Display name
              </Label>
              <Input
                id="plan-name"
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Pro"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-slug" className="text-xs">
                Slug
              </Label>
              <Input
                id="plan-slug"
                value={draft.slug}
                onChange={(e) => set("slug", e.target.value.toLowerCase())}
                placeholder="pro"
                disabled={!isCreate}
                className="font-mono text-sm"
              />
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            <Label htmlFor="plan-desc" className="text-xs">
              Description
            </Label>
            <Textarea
              id="plan-desc"
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="One short sentence describing what this plan unlocks."
              rows={2}
              className="resize-none"
            />
          </div>
        </Section>

        {/* PRICING ──────────────────────────────────────────────────── */}
        <Section
          title="Pricing"
          description="What hosts will pay through Stripe."
          icon={<CircleDollarSign className="h-3 w-3" />}
        >
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="plan-price" className="text-xs">
                  Price (cents)
                </Label>
                <Input
                  id="plan-price"
                  type="number"
                  min={0}
                  step={1}
                  value={draft.price_cents}
                  onChange={(e) =>
                    set("price_cents", parseInt(e.target.value || "0", 10))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-currency" className="text-xs">
                  Currency
                </Label>
                <Input
                  id="plan-currency"
                  value={draft.currency}
                  onChange={(e) =>
                    set("currency", e.target.value.toLowerCase().slice(0, 3))
                  }
                  placeholder="usd"
                  className="uppercase"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-interval" className="text-xs">
                  Billing interval
                </Label>
                <Select
                  value={draft.billing_interval}
                  onValueChange={(v) =>
                    set("billing_interval", v as PlanDraft["billing_interval"])
                  }
                >
                  <SelectTrigger id="plan-interval">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Monthly</SelectItem>
                    <SelectItem value="year">Yearly</SelectItem>
                    <SelectItem value="one_time">One-time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-border/60 pt-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Hosts will see
              </div>
              <div className="font-mono text-lg font-semibold tracking-tight">
                {draft.price_cents === 0
                  ? "Free"
                  : `$${(draft.price_cents / 100).toFixed(2)} ${draft.currency.toUpperCase()}`}
                {draft.price_cents > 0 && draft.billing_interval !== "one_time" ? (
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    /{draft.billing_interval === "year" ? "yr" : "mo"}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Label htmlFor="plan-sort" className="text-xs text-muted-foreground">
              Sort order
            </Label>
            <Input
              id="plan-sort"
              type="number"
              value={draft.sort_order}
              onChange={(e) =>
                set("sort_order", parseInt(e.target.value || "0", 10))
              }
              className="h-8 w-20 text-sm"
            />
            <span className="text-[11px] text-muted-foreground">
              Lower shows first in the upgrade picker.
            </span>
          </div>
        </Section>

        {/* FEATURES ─────────────────────────────────────────────────── */}
        <Section
          title="Features"
          description={`What this plan unlocks. ${enabledFeatures.length} of ${FEATURE_KEYS.length} enabled.`}
          icon={<Sparkles className="h-3 w-3" />}
        >
          <div className="space-y-4">
            {FEATURE_CATEGORIES.map((category) => {
              const enabledInCategory = category.keys.filter(
                (k) => !!draft.features[k],
              ).length;
              return (
                <div
                  key={category.id}
                  className="overflow-hidden rounded-lg border border-border"
                >
                  {/* Category header — gives the wall of toggles structure
                      so admins can scan by product surface (replay,
                      distribution, audience, monetize) instead of one
                      unbroken list. */}
                  <div className="flex items-baseline justify-between gap-3 border-b border-border bg-muted/30 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold uppercase tracking-wide text-foreground">
                        {category.label}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {category.description}
                      </div>
                    </div>
                    <div className="shrink-0 text-[11px] font-mono tabular-nums text-muted-foreground">
                      {enabledInCategory}/{category.keys.length}
                    </div>
                  </div>
                  {category.keys.map((k, i) => {
                    const on = !!draft.features[k];
                    return (
                      <div
                        key={k}
                        className={cn(
                          "flex items-center justify-between gap-4 px-4 py-3 transition",
                          i > 0 && "border-t border-border",
                          on ? "bg-emerald-500/5" : "bg-card",
                        )}
                      >
                        <div className="flex min-w-0 items-start gap-2.5">
                          <span
                            className={cn(
                              "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                              on
                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {FEATURE_LABELS[k].icon}
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-medium">
                              {FEATURE_LABELS[k].label}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {FEATURE_LABELS[k].help}
                            </div>
                          </div>
                        </div>
                        <Switch
                          checked={on}
                          onCheckedChange={(c) =>
                            set("features", { ...draft.features, [k]: c })
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </Section>

        {/* STRIPE ────────────────────────────────────────────────────── */}
        <Section
          title="Stripe price IDs"
          description="Optional in Phase 1. Required once payments are turned on."
          icon={<CircleDollarSign className="h-3 w-3" />}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 rounded-lg border border-border p-3">
              <Label
                htmlFor="plan-stripe-test"
                className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400"
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                Test mode
              </Label>
              <Input
                id="plan-stripe-test"
                value={draft.stripe_price_id_test}
                onChange={(e) => set("stripe_price_id_test", e.target.value)}
                placeholder="price_…"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5 rounded-lg border border-border p-3">
              <Label
                htmlFor="plan-stripe-live"
                className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400"
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Live mode
              </Label>
              <Input
                id="plan-stripe-live"
                value={draft.stripe_price_id_live}
                onChange={(e) => set("stripe_price_id_live", e.target.value)}
                placeholder="price_…"
                className="font-mono text-xs"
              />
            </div>
          </div>
        </Section>

        {/* VISIBILITY ──────────────────────────────────────────────── */}
        <Section
          title="Visibility"
          description="Whether hosts can see and land on this plan."
          icon={<Eye className="h-3 w-3" />}
        >
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <div className="text-sm font-medium">Active</div>
                <div className="text-xs text-muted-foreground">
                  Inactive plans are hidden from the upgrade picker.
                </div>
              </div>
              <Switch
                checked={draft.is_active}
                onCheckedChange={(c) => set("is_active", c)}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
              <div>
                <div className="text-sm font-medium">Default for new hosts</div>
                <div className="text-xs text-muted-foreground">
                  Only one plan can hold this. Saving will demote the previous
                  default.
                </div>
              </div>
              <Switch
                checked={draft.is_default}
                onCheckedChange={(c) => set("is_default", c)}
                disabled={!draft.is_active}
              />
            </div>
          </div>
        </Section>
      </div>

      <DialogFooter className="border-t border-border bg-muted/30 px-6 py-3">
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={() => onSubmit(draft)} disabled={pending}>
          {pending ? "Saving…" : "Save plan"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ToggleChip({
  on,
  disabled,
  onChange,
}: {
  on: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-2 py-1 transition",
        on
          ? "border-emerald-500/30 bg-emerald-500/10"
          : "border-border bg-muted/40",
      )}
    >
      <Switch
        checked={on}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={on ? "Deactivate plan" : "Activate plan"}
      />
      <span
        className={cn(
          "text-[10px] font-semibold uppercase tracking-wide",
          on ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground",
        )}
      >
        {on ? "Active" : "Off"}
      </span>
    </div>
  );
}
