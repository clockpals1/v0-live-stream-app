"use client";

import { useEffect, useState, useTransition } from "react";
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
import { Plus, Pencil, Trash2, Star, StarOff } from "lucide-react";
import { FEATURE_KEYS, type BillingPlan, type FeatureKey } from "@/lib/billing/plans";

/**
 * Admin plans editor.
 *
 * Lists every plan, supports create / edit / activate-toggle / set-default /
 * delete. The free plan has its delete + default-toggle paths disabled
 * because the API would 400 on those anyway and showing them would
 * confuse the admin.
 */

const FEATURE_LABELS: Record<FeatureKey, { label: string; help: string }> = {
  insider_circle: {
    label: "Insider Circle",
    help: "Collect subscribers and send rich-HTML broadcast emails.",
  },
  cloud_archive: {
    label: "Cloud archive (R2)",
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
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Plans</CardTitle>
            <CardDescription>
              Manage subscription tiers, pricing, and feature access. Create
              the matching products in Stripe first, then paste the
              <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">price_</code>
              ids below.
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
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading plans…</div>
        ) : plans.length === 0 ? (
          <div className="text-sm text-muted-foreground">No plans yet.</div>
        ) : (
          plans.map((plan) => (
            <div
              key={plan.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-muted/30 p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{plan.name}</span>
                  <Badge variant="secondary" className="font-mono text-xs">
                    {plan.slug}
                  </Badge>
                  {plan.is_default && (
                    <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300">
                      Default
                    </Badge>
                  )}
                  {!plan.is_active && (
                    <Badge variant="outline" className="text-muted-foreground">
                      Inactive
                    </Badge>
                  )}
                </div>
                {plan.description && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {plan.description}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {priceLabel(plan)}
                  </span>
                  {FEATURE_KEYS.map((k) =>
                    plan.features?.[k] ? (
                      <Badge key={k} variant="outline" className="text-xs">
                        {FEATURE_LABELS[k].label}
                      </Badge>
                    ) : null,
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Switch
                  checked={plan.is_active}
                  onCheckedChange={() => handleToggleActive(plan)}
                  disabled={pending}
                  aria-label={plan.is_active ? "Deactivate" : "Activate"}
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
                    <Button variant="ghost" size="icon">
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
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          Pricing is in cents (e.g. 1900 = $19.00). Stripe price ids are
          optional in Phase 1; you'll wire them when payments go live.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-1">
          <Label htmlFor="plan-name">Display name</Label>
          <Input
            id="plan-name"
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Pro"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-1">
          <Label htmlFor="plan-slug">URL slug</Label>
          <Input
            id="plan-slug"
            value={draft.slug}
            onChange={(e) => set("slug", e.target.value.toLowerCase())}
            placeholder="pro"
            disabled={!isCreate}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="plan-desc">Description</Label>
          <Textarea
            id="plan-desc"
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="One short sentence describing what this plan unlocks."
            rows={2}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="plan-price">Price (cents)</Label>
          <Input
            id="plan-price"
            type="number"
            min={0}
            step={1}
            value={draft.price_cents}
            onChange={(e) => set("price_cents", parseInt(e.target.value || "0", 10))}
          />
          <p className="text-xs text-muted-foreground">
            ${(draft.price_cents / 100).toFixed(2)}{" "}
            {draft.currency.toUpperCase()}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="plan-currency">Currency</Label>
          <Input
            id="plan-currency"
            value={draft.currency}
            onChange={(e) => set("currency", e.target.value.toLowerCase().slice(0, 3))}
            placeholder="usd"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="plan-interval">Billing interval</Label>
          <Select
            value={draft.billing_interval}
            onValueChange={(v) => set("billing_interval", v as PlanDraft["billing_interval"])}
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
        <div className="space-y-1.5">
          <Label htmlFor="plan-sort">Sort order</Label>
          <Input
            id="plan-sort"
            type="number"
            value={draft.sort_order}
            onChange={(e) => set("sort_order", parseInt(e.target.value || "0", 10))}
          />
          <p className="text-xs text-muted-foreground">Ascending. Lower shows first.</p>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label className="text-sm">Features</Label>
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
            {FEATURE_KEYS.map((k) => (
              <div key={k} className="flex items-start justify-between gap-3">
                <div>
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
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-sm">Stripe price IDs (optional in Phase 1)</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="plan-stripe-test" className="text-xs text-muted-foreground">
                Test
              </Label>
              <Input
                id="plan-stripe-test"
                value={draft.stripe_price_id_test}
                onChange={(e) => set("stripe_price_id_test", e.target.value)}
                placeholder="price_…"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="plan-stripe-live" className="text-xs text-muted-foreground">
                Live
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
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-3 sm:col-span-2">
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
        <div className="flex items-center justify-between rounded-lg border border-border p-3 sm:col-span-2">
          <div>
            <div className="text-sm font-medium">Default for new hosts</div>
            <div className="text-xs text-muted-foreground">
              Only one plan can hold this. Saving will demote the previous
              default automatically.
            </div>
          </div>
          <Switch
            checked={draft.is_default}
            onCheckedChange={(c) => set("is_default", c)}
            disabled={!draft.is_active}
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={() => onSubmit(draft)} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
