import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { MonetizeView } from "@/components/studio/monetize/monetize-view";

/**
 * Monetization Center — Phase 5 surface.
 *
 * SSR: resolves plan + subscription state + Stripe Connect status from
 * host_integrations (provider='stripe_connect') then renders the
 * client MonetizeView with initial data.
 */
export const dynamic = "force-dynamic";

export default async function MonetizePage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) redirect("/auth/login");

  const admin = createAdminClient();

  const { data: host } = await admin
    .from("hosts")
    .select(
      "id, plan_slug, stripe_customer_id, subscription_status, subscription_current_period_end, subscription_cancel_at_period_end",
    )
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!host) redirect("/auth/login");

  const eff = await getEffectivePlan(supabase, userData.user.id);

  // Stripe Connect status from host_integrations.
  const { data: connectRow } = await admin
    .from("host_integrations")
    .select("provider_account_id, metadata")
    .eq("host_id", (host as { id: string }).id)
    .eq("provider", "stripe_connect")
    .maybeSingle();
  const connectMeta = (connectRow?.metadata ?? {}) as Record<string, boolean>;

  const h = host as {
    id: string;
    plan_slug: string | null;
    stripe_customer_id: string | null;
    subscription_status: string | null;
    subscription_current_period_end: string | null;
    subscription_cancel_at_period_end: boolean | null;
  };

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Monetization Center</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Earnings, paywalls, premium replays — turn engagement into revenue.
        </p>
      </header>
      <MonetizeView
        planName={eff.plan?.name ?? "Free"}
        planSlug={eff.plan?.slug ?? h.plan_slug ?? "free"}
        planSource={eff.source}
        planFeatures={(eff.plan?.features as Record<string, boolean>) ?? {}}
        subscriptionStatus={h.subscription_status}
        currentPeriodEnd={h.subscription_current_period_end}
        cancelAtPeriodEnd={!!h.subscription_cancel_at_period_end}
        hasCustomer={!!h.stripe_customer_id}
        connectAccountId={connectRow?.provider_account_id ?? null}
        connectChargesEnabled={connectMeta.charges_enabled ?? false}
        connectPayoutsEnabled={connectMeta.payouts_enabled ?? false}
        connectDetailsSubmitted={connectMeta.details_submitted ?? false}
        isPlatformAdmin={eff.isPlatformAdmin}
      />
    </main>
  );
}
