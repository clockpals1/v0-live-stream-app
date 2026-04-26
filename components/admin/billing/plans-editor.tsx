"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Plus, Pencil, Trash2, Star, StarOff, Sparkles } from "lucide-react";
import { FEATURE_KEYS, type BillingPlan, type FeatureKey } from "@/lib/billing/plans";

/**
 * Admin plans editor.
 *
 * UI structure
 * - Outer Card lists plans as rows with summary chips and quick actions.
 * - Edit/create dialog groups fields into clear sections (Identity,
 *   Pricing, Features, Stripe, Visibility) so the form scans top-to-bottom
 *   without visual ambiguity.
 *
 * The free plan has its delete + default-toggle paths disabled because
 * the API would 400 on those anyway.
 */

const FEATURE_LABELS: Record<FeatureKey, { label: string; help: string }> = {
  insider_circle: {
    label: "Insider Circle",
    help: "Collect subscribers and send rich-HTML broadcast emails.",
  },
  cloud_archive: {
    label: "Cloud archive",
    help: "Save ended streams to Cloudflare R2 storage.",
  },
  youtube_upload: {
    label: "YouTube upload",
    help: "Upload ended streams to the host's connected YouTube channel.",
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
          if (!planId) {
            body.slug = draft.slug;
          }
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
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-4">
        <div>
          <CardTitle className="text-base">Plans</CardTitle>
          <CardDescription className="mt-1">
            Subscription tiers, pricing, and feature access. Create matching
            products in Stripe first, then paste the
            <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">price_</code>
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

      <CardContent className="space-y-2">
        {loading ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Loading plans…
          </div>
        ) : plans.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No plans yet. Click <span className="font-medium text-foreground">New plan</span> to add one.
          </div>
        ) : (
          plans.map((plan) => (
            <div
              key={plan.id}
              className="group flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition hover:border-primary/40"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{plan.name}</span>
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {plan.slug}
                  </Badge>
                  {plan.is_default && (
                    <Badge className="gap-1 bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300">
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
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {plan.description}
                  </p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-semibold text-foreground">
                    {priceLabel(plan)}
                  </span>
                  <span className="text-muted-foreground/70">·</span>
                  {FEATURE_KEYS.filter((k) => plan.features?.[k]).length === 0 ? (
                    <span className="text-muted-foreground">No features enabled</span>
                  ) : (
                    FEATURE_KEYS.filter((k) => plan.features?.[k]).map((k) => (
                      <Badge key={k} variant="outline" className="font-normal">
                        <Sparkles className="mr-1 h-2.5 w-2.5" />
                        {FEATURE_LABELS[k].label}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1">
                  <Switch
                    checked={plan.is_active}
                    onCheckedChange={() => handleToggleActive(plan)}
                    disabled={pending}
                    aria-label={plan.is_active ? "Deactivate plan" : "Activate plan"}
                  />
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {plan.is_active ? "On" : "Off"}
                  </span>
                </div>
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
                >
                  {plan.is_default ? (
                    <Star className="h-4 w-4 fill-current text-amber-500" />
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
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header className="space-y-0.5">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </header>
      <div className="space-y-3">{children}</div>
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

  return (
    <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden p-0">
      <DialogHeader className="space-y-1 border-b border-border px-6 py-4">
        <DialogTitle className="text-base">{title}</DialogTitle>
        <DialogDescription className="text-xs">
          Pricing is in cents (e.g. 1900 = $19.00). Stripe price IDs are
          optional in Phase 1; you'll wire them when payments go live.
        </DialogDescription>
      </DialogHeader>

      <div className="max-h-[calc(90vh-9rem)] space-y-7 overflow-y-auto px-6 py-5">
        {/* IDENTITY ─────────────────────────────────────────────────── */}
        <Section
          title="Identity"
          description="The user-facing name and the URL slug."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="plan-name">Display name</Label>
              <Input
                id="plan-name"
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Pro"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-slug">Slug</Label>
              <Input
                id="plan-slug"
                value={draft.slug}
                onChange={(e) => set("slug", e.target.value.toLowerCase())}
                placeholder="pro"
                disabled={!isCreate}
                className="font-mono"
              />
              {!isCreate ? (
                <p className="text-[11px] text-muted-foreground">
                  Slugs cannot be changed after creation.
                </p>
              ) : null}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-desc">Description</Label>
            <Textarea
              id="plan-desc"
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="One short sentence describing what this plan unlocks."
              rows={2}
            />
          </div>
        </Section>

        {/* PRICING ──────────────────────────────────────────────────── */}
        <Section
          title="Pricing"
          description="Set the price your hosts will pay through Stripe."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="plan-price">Price (cents)</Label>
              <Input
                id="plan-price"
                type="number"
                min={0}
                step={1}
                value={draft.price_cents}
                onChange={(e) => set("price_cents", parseInt(e.target.value || "0", 10))}
              />
              <p className="text-[11px] text-muted-foreground">
                ${(draft.price_cents / 100).toFixed(2)} {draft.currency.toUpperCase()}
              </p>
            </div>
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="plan-currency">Currency</Label>
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
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="plan-interval">Billing interval</Label>
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
          <div className="space-y-1.5">
            <Label htmlFor="plan-sort">Sort order</Label>
            <Input
              id="plan-sort"
              type="number"
              value={draft.sort_order}
              onChange={(e) =>
                set("sort_order", parseInt(e.target.value || "0", 10))
              }
              className="max-w-[8rem]"
            />
            <p className="text-[11px] text-muted-foreground">
              Ascending. Lower numbers show first in the upgrade picker.
            </p>
          </div>
        </Section>

        {/* FEATURES ─────────────────────────────────────────────────── */}
        <Section
          title="Features"
          description="What this plan unlocks. Off by default — flip on what's included."
        >
          <div className="divide-y divide-border rounded-lg border border-border">
            {FEATURE_KEYS.map((k) => (
              <div
                key={k}
                className="flex items-center justify-between gap-4 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {FEATURE_LABELS[k].label}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {FEATURE_LABELS[k].help}
                  </div>
                </div>
                <Switch
                  checked={!!draft.features[k]}
                  onCheckedChange={(c) =>
                    set("features", { ...draft.features, [k]: c })
                  }
                />
              </div>
            ))}
          </div>
        </Section>

        {/* STRIPE ────────────────────────────────────────────────────── */}
        <Section
          title="Stripe price IDs"
          description="Optional in Phase 1. Required once payments are turned on."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="plan-stripe-test" className="text-xs uppercase tracking-wide text-muted-foreground">
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
            <div className="space-y-1.5">
              <Label htmlFor="plan-stripe-live" className="text-xs uppercase tracking-wide text-muted-foreground">
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
        >
          <div className="divide-y divide-border rounded-lg border border-border">
            <div className="flex items-center justify-between gap-4 px-3 py-2.5">
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
            <div className="flex items-center justify-between gap-4 px-3 py-2.5">
              <div>
                <div className="text-sm font-medium">Default for new hosts</div>
                <div className="text-xs text-muted-foreground">
                  Only one plan can hold this. Saving will demote the previous default.
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
