"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  Gift,
  Search,
  ShieldCheck,
  Sparkles,
  AlertTriangle,
  Loader2,
  Calendar,
  X,
  Plus,
  History,
} from "lucide-react";

/**
 * Admin → Billing → Manual plan grants
 *
 * Lets an admin pick a host, choose a target plan, and grant access
 * WITHOUT taking payment. The grant goes through
 * /api/admin/billing/grants which is itself gated by requireAdmin().
 *
 * The component is a single client island. The /admin/billing page
 * wraps it in its own section card with a heading. Visually we keep
 * it distinct from the Stripe-driven plan editor by using a sparkle/
 * gift accent — admins should immediately recognise this is an
 * override path, not the normal subscription flow.
 *
 * Three regions stacked vertically:
 *   1. Header + "Grant plan" CTA
 *   2. Searchable host list with current effective plan + grant chip
 *   3. Recent grant audit log (most-recent 20 actions across all hosts)
 */

interface HostRow {
  id: string;
  email: string;
  display_name: string | null;
  role: string | null;
  is_admin: boolean | null;
  plan_slug: string | null;
}

interface BillingPlan {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  price_cents: number;
  currency: string;
  billing_interval: string;
}

interface Grant {
  id: string;
  host_id: string;
  plan_slug: string;
  granted_by_email: string | null;
  reason: string | null;
  effective_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by_email: string | null;
  revoke_reason: string | null;
  created_at: string;
}

export function GrantsSection() {
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogHost, setDialogHost] = useState<HostRow | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const [hostsRes, plansRes, grantsRes] = await Promise.all([
        fetch("/api/admin/hosts", { cache: "no-store" }),
        fetch("/api/admin/billing/plans", { cache: "no-store" }),
        fetch("/api/admin/billing/grants?limit=50", { cache: "no-store" }),
      ]);
      const [hostsJson, plansJson, grantsJson] = await Promise.all([
        hostsRes.json(),
        plansRes.json(),
        grantsRes.json(),
      ]);
      if (!hostsRes.ok) throw new Error(hostsJson.error ?? "Failed to load hosts.");
      if (!plansRes.ok) throw new Error(plansJson.error ?? "Failed to load plans.");
      if (!grantsRes.ok) throw new Error(grantsJson.error ?? "Failed to load grants.");
      setHosts(hostsJson.hosts ?? []);
      setPlans(plansJson.plans ?? []);
      setGrants(grantsJson.grants ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load grants data.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  // Map of host_id → most-recent ACTIVE grant for chip rendering.
  const activeGrantByHost = useMemo(() => {
    const m = new Map<string, Grant>();
    const now = Date.now();
    for (const g of grants) {
      if (g.revoked_at) continue;
      if (new Date(g.effective_at).getTime() > now) continue;
      if (g.expires_at && new Date(g.expires_at).getTime() <= now) continue;
      // grants is ordered created_at DESC so the first match is newest.
      if (!m.has(g.host_id)) m.set(g.host_id, g);
    }
    return m;
  }, [grants]);

  // Index plans by slug for quick name lookup.
  const planBySlug = useMemo(() => {
    const m = new Map<string, BillingPlan>();
    for (const p of plans) m.set(p.slug, p);
    return m;
  }, [plans]);

  const filteredHosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter(
      (h) =>
        h.email.toLowerCase().includes(q) ||
        (h.display_name ?? "").toLowerCase().includes(q) ||
        (h.plan_slug ?? "").toLowerCase().includes(q),
    );
  }, [hosts, search]);

  async function revokeGrant(grant: Grant, reason: string) {
    try {
      const res = await fetch(`/api/admin/billing/grants/${grant.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Revoke failed.");
      toast.success("Grant revoked.");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Revoke failed.");
    }
  }

  return (
    <div className="space-y-4">
      {/* ─── Distinct accent so admins know this isn't a paid path ─── */}
      <Card className="border-violet-500/30 bg-gradient-to-br from-violet-500/[0.04] to-fuchsia-500/[0.04]">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Gift className="h-4 w-4 text-violet-500" />
                Manual plan grants
                <Badge
                  variant="outline"
                  className="ml-1 border-violet-500/40 bg-violet-500/10 text-[10px] font-medium uppercase tracking-wide text-violet-700 dark:text-violet-300"
                >
                  Override
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1">
                Grant a paid plan without taking payment. Admins, comp
                accounts, support escalations. Bypasses Stripe.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* ─── Search + count ─── */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by email, name, or plan…"
                className="pl-8"
              />
            </div>
            <Badge variant="outline" className="text-muted-foreground">
              {filteredHosts.length} of {hosts.length}
            </Badge>
          </div>

          {/* ─── Host list ─── */}
          <div className="overflow-hidden rounded-lg border border-border bg-background">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading hosts…
              </div>
            ) : filteredHosts.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                No hosts match your search.
              </div>
            ) : (
              <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">
                {filteredHosts.map((h) => {
                  const grant = activeGrantByHost.get(h.id);
                  const isPlatformAdmin =
                    h.role === "admin" || h.is_admin === true;
                  const underlyingPlanName =
                    planBySlug.get(h.plan_slug ?? "")?.name ?? h.plan_slug ?? "free";
                  const grantedPlanName = grant
                    ? planBySlug.get(grant.plan_slug)?.name ?? grant.plan_slug
                    : null;
                  return (
                    <li
                      key={h.id}
                      className="flex flex-wrap items-center gap-3 px-4 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">
                            {h.display_name || h.email}
                          </span>
                          {isPlatformAdmin && (
                            <Badge className="h-5 border-0 bg-primary/15 text-[10px] text-primary">
                              <ShieldCheck className="mr-0.5 h-2.5 w-2.5" />
                              Admin
                            </Badge>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {h.email}
                        </div>
                      </div>

                      {/* Effective plan — admin > grant > underlying */}
                      <div className="hidden text-right sm:block">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Effective plan
                        </div>
                        <div className="text-sm font-medium">
                          {isPlatformAdmin ? (
                            <span className="text-primary">All access</span>
                          ) : grant ? (
                            <span className="text-violet-700 dark:text-violet-300">
                              {grantedPlanName}
                              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                                granted
                              </span>
                            </span>
                          ) : (
                            <span>{underlyingPlanName}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {grant ? (
                          <RevokeButton
                            grant={grant}
                            onRevoke={(reason) => revokeGrant(grant, reason)}
                          />
                        ) : null}
                        <Button
                          variant={grant ? "ghost" : "outline"}
                          size="sm"
                          onClick={() => setDialogHost(h)}
                          disabled={isPlatformAdmin}
                          title={
                            isPlatformAdmin
                              ? "Admins already have all access; no grant needed."
                              : "Grant a plan to this host"
                          }
                        >
                          {grant ? (
                            <>Change</>
                          ) : (
                            <>
                              <Plus className="mr-1 h-3 w-3" />
                              Grant
                            </>
                          )}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── Audit log ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Recent grant activity
          </CardTitle>
          <CardDescription>
            Last 50 grants and revocations across all hosts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {grants.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
              No grants yet.
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {grants.slice(0, 20).map((g) => {
                const host = hosts.find((h) => h.id === g.host_id);
                const planName =
                  planBySlug.get(g.plan_slug)?.name ?? g.plan_slug;
                return (
                  <li
                    key={g.id}
                    className="flex flex-wrap items-baseline gap-2 px-3 py-2 text-xs"
                  >
                    <span
                      className={
                        g.revoked_at
                          ? "rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-700 dark:text-rose-300"
                          : "rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
                      }
                    >
                      {g.revoked_at ? "Revoked" : "Granted"}
                    </span>
                    <span className="font-medium">{planName}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="font-medium">
                      {host?.email ?? g.host_id.slice(0, 8)}
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      by{" "}
                      {g.revoked_at
                        ? g.revoked_by_email ?? "admin"
                        : g.granted_by_email ?? "admin"}
                      {" · "}
                      {new Date(
                        g.revoked_at ?? g.created_at,
                      ).toLocaleString()}
                    </span>
                    {(g.reason || g.revoke_reason) && (
                      <div className="mt-0.5 w-full pl-1 text-[11px] italic text-muted-foreground">
                        “{g.revoked_at ? g.revoke_reason : g.reason}”
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ─── Grant dialog ─── */}
      {dialogHost && (
        <GrantDialog
          host={dialogHost}
          plans={plans.filter((p) => p.is_active && p.slug !== "free")}
          existingGrant={activeGrantByHost.get(dialogHost.id) ?? null}
          onClose={() => setDialogHost(null)}
          onSaved={() => {
            setDialogHost(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Grant dialog
// ────────────────────────────────────────────────────────────────────

function GrantDialog({
  host,
  plans,
  existingGrant,
  onClose,
  onSaved,
}: {
  host: HostRow;
  plans: BillingPlan[];
  existingGrant: Grant | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [planSlug, setPlanSlug] = useState<string>(
    existingGrant?.plan_slug ?? plans[0]?.slug ?? "",
  );
  const [effectiveAt, setEffectiveAt] = useState<string>(
    new Date().toISOString().slice(0, 16),
  );
  const [expiresAt, setExpiresAt] = useState<string>(""); // empty = never
  const [reason, setReason] = useState<string>("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!planSlug) {
      toast.error("Pick a plan first.");
      return;
    }
    setSaving(true);
    try {
      // Replacing an existing grant: revoke first, then grant.
      // Done in two requests so the audit trail records both rows.
      if (existingGrant) {
        const res = await fetch(
          `/api/admin/billing/grants/${existingGrant.id}`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              reason: `Replaced by new grant on ${new Date().toLocaleDateString()}`,
            }),
          },
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Revoke step failed.");
      }

      const res = await fetch("/api/admin/billing/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostId: host.id,
          planSlug,
          effectiveAt: new Date(effectiveAt).toISOString(),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          reason: reason.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Grant failed.");
      toast.success(`Granted ${json.plan?.name ?? planSlug} to ${host.email}.`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Grant failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" />
            {existingGrant ? "Change grant" : "Grant a plan"}
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{host.email}</span>{" "}
            will get the selected plan at no charge. They can still keep an
            existing Stripe subscription — the grant simply takes precedence
            while it's active.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Current effective plan summary */}
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
            <div className="text-muted-foreground">Currently on</div>
            <div className="mt-0.5 font-medium">
              {existingGrant
                ? `Granted: ${existingGrant.plan_slug}`
                : `Stripe / default: ${host.plan_slug ?? "free"}`}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="grant-plan">Target plan</Label>
            <Select value={planSlug} onValueChange={setPlanSlug}>
              <SelectTrigger id="grant-plan">
                <SelectValue placeholder="Pick a plan" />
              </SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    {p.name} — ${(p.price_cents / 100).toFixed(2)}/{p.billing_interval}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {plans.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No active paid plans found. Create one above first.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="grant-effective" className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Effective
              </Label>
              <Input
                id="grant-effective"
                type="datetime-local"
                value={effectiveAt}
                onChange={(e) => setEffectiveAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grant-expires" className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Expires <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="grant-expires"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                placeholder="Never"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="grant-reason">Internal note <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea
              id="grant-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Comp for community moderator, BFCM promo, etc."
            />
            <p className="text-[11px] text-muted-foreground">
              Visible only to admins in the audit log.
            </p>
          </div>

          <Alert className="border-violet-500/30 bg-violet-500/5">
            <Sparkles className="h-3.5 w-3.5 text-violet-500" />
            <AlertDescription className="text-xs">
              This bypasses Stripe payment. The host will see the upgrade
              immediately. Revoke at any time to return them to their normal
              billing state.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={saving || !planSlug}
            className="bg-violet-600 text-white hover:bg-violet-700"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Granting…
              </>
            ) : (
              <>
                <Gift className="mr-2 h-4 w-4" />
                {existingGrant ? "Replace grant" : "Grant plan"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────
// Revoke confirmation
// ────────────────────────────────────────────────────────────────────

function RevokeButton({
  grant,
  onRevoke,
}: {
  grant: Grant;
  onRevoke: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          title="Revoke this grant"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Revoke grant?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The host will return to their Stripe-driven (or default) plan
            immediately. Existing recordings/uploads are not affected. The
            row is kept in the audit log; it cannot be un-revoked.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="revoke-reason" className="text-xs">
            Reason (optional)
          </Label>
          <Textarea
            id="revoke-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="e.g. Trial ended; comp expired."
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onRevoke(reason)}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Revoke grant
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
