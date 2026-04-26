import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBillingConfig, redactConfig } from "@/lib/billing/config";
import { listAllPlans } from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";
import { Radio, ArrowLeft, CreditCard, ShieldCheck, Layers, Users, Gift } from "lucide-react";
import { ModeBanner } from "@/components/admin/billing/mode-banner";
import { StripeConfigPanel } from "@/components/admin/billing/stripe-config";
import { PlansEditor } from "@/components/admin/billing/plans-editor";
import { GrantsSection } from "@/components/admin/billing/grants-section";

/**
 * /admin/billing — admin Billing dashboard.
 *
 * Server component: gates on admin role, then loads the redacted
 * billing_config + plans summary server-side so the dashboard hydrates
 * without flicker. Children components handle their own writes.
 */

export default async function AdminBillingPage() {
  const supabase = await createClient();

  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    redirect("/auth/login");
  }
  if (!user) redirect("/auth/login");

  const { data: host } = await supabase
    .from("hosts")
    .select("*")
    .eq("user_id", user.id)
    .single();
  const isAdmin =
    !!host && (host.role === "admin" || host.is_admin === true);
  if (!isAdmin) redirect("/host/dashboard");

  // Server-side load. Falls through gracefully if migration 019 is missing.
  let initialConfig;
  let planCount = 0;
  let activePlanCount = 0;
  let defaultPlanName: string | null = null;
  let hostsOnPaidPlans = 0;
  try {
    const admin = createAdminClient();
    const cfg = await getBillingConfig(admin);
    initialConfig = redactConfig(cfg);
    const plans = await listAllPlans(admin);
    planCount = plans.length;
    activePlanCount = plans.filter((p) => p.is_active).length;
    defaultPlanName = plans.find((p) => p.is_default)?.name ?? null;
    // Count hosts on a non-free plan as a quick reach indicator.
    const { count } = await admin
      .from("hosts")
      .select("id", { count: "exact", head: true })
      .neq("plan_slug", "free");
    hostsOnPaidPlans = count ?? 0;
  } catch (e) {
    initialConfig = null;
    console.error("[admin/billing] page load failed:", e);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Radio className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground">Isunday Stream Live</span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <ShieldCheck className="h-4 w-4" />
              Admin
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin">
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                User management
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl space-y-6 px-4 py-8">
        {/* Page header */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link href="/admin" className="hover:text-foreground">
              Admin
            </Link>
            <span>/</span>
            <span className="text-foreground">Billing</span>
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <CreditCard className="h-5 w-5" />
            Billing
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage subscription plans, Stripe credentials, and the active
            payment environment.
          </p>
        </div>

        {/* Quick-stats row */}
        {initialConfig ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              icon={<Layers className="h-3.5 w-3.5" />}
              label="Active plans"
              value={`${activePlanCount} / ${planCount}`}
              hint={defaultPlanName ? `Default: ${defaultPlanName}` : "No default plan"}
            />
            <StatCard
              icon={<Users className="h-3.5 w-3.5" />}
              label="Hosts on paid plans"
              value={String(hostsOnPaidPlans)}
              hint="Excludes hosts on the free plan"
            />
            <StatCard
              icon={<CreditCard className="h-3.5 w-3.5" />}
              label="Payment mode"
              value={initialConfig.stripe_mode === "live" ? "LIVE" : "TEST"}
              hint={
                initialConfig.stripe_mode === "live"
                  ? "Real charges enabled"
                  : "Test cards only"
              }
              accent={initialConfig.stripe_mode === "live" ? "live" : "test"}
            />
          </div>
        ) : null}

        {initialConfig ? (
          <ModeBanner mode={initialConfig.stripe_mode} />
        ) : null}

        {/* Plans — pricing, features, visibility. Heading sits above the
            existing PlansEditor card to reinforce the section split when
            the user scrolls past the stats row. */}
        <section className="space-y-3 pt-2">
          <SectionHeading
            icon={<Layers className="h-4 w-4" />}
            title="Plans"
            description="Pricing tiers and feature flags shown to hosts."
          />
          <PlansEditor />
        </section>

        {initialConfig ? (
          <section className="space-y-3 pt-2">
            <SectionHeading
              icon={<ShieldCheck className="h-4 w-4" />}
              title="Stripe credentials"
              description="API keys, webhook secret, and active environment."
            />
            <StripeConfigPanel initial={initialConfig} />
          </section>
        ) : (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            Billing configuration row is missing from the database. Apply
            migration <code>019_billing_plans.sql</code> in the Supabase SQL
            editor, then refresh this page.
          </div>
        )}

        {/* Manual grants — admin override path. Visually accented in
            violet so admins can't confuse it with the regular paid
            upgrade flow above. Requires migration 022 to be applied;
            falls through gracefully (empty list) if not. */}
        <section className="space-y-3 pt-2">
          <SectionHeading
            icon={<Gift className="h-4 w-4" />}
            title="Manual plan grants"
            description="Override path — grant a paid plan to a host without taking payment. Audited."
          />
          <GrantsSection />
        </section>
      </main>
    </div>
  );
}

function SectionHeading({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3 border-b border-border pb-2">
      <div>
        <div className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          {icon}
          {title}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  accent?: "test" | "live";
}) {
  const accentClass =
    accent === "live"
      ? "text-emerald-600 dark:text-emerald-400"
      : accent === "test"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`mt-1.5 text-2xl font-semibold tracking-tight ${accentClass}`}>
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}
