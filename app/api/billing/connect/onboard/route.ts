import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveStripe } from "@/lib/billing/stripe";
import { isEntitled } from "@/lib/billing/entitlements";

/**
 * POST /api/billing/connect/onboard
 *
 * Creates (or refreshes) a Stripe Express Connect account for the host
 * and returns a one-time account-link URL for the onboarding flow.
 *
 * Flow:
 *   1. If host already has a Connect account, skip creation.
 *   2. Otherwise create a new Express account (type='express',
 *      country determined by billing address or defaults to 'US').
 *   3. Persist the account id in host_integrations (provider='stripe_connect').
 *   4. Create an account link of type 'account_onboarding'.
 *   5. Return { url } — host is redirected there by the client.
 *
 * Gate: requires monetization_basic feature.
 */
export async function POST() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // Plan gate — monetization must be enabled.
  const entitled = await isEntitled(supabase, user.id, "monetization_basic").catch(() => false);
  if (!entitled) {
    return NextResponse.json(
      { error: "Monetization is not included in your plan.", code: "feature_not_in_plan" },
      { status: 402 },
    );
  }

  const admin = createAdminClient();
  const { data: host } = await admin
    .from("hosts")
    .select("id, email, display_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host) return NextResponse.json({ error: "No host profile." }, { status: 404 });

  let stripeBundle;
  try {
    stripeBundle = await getActiveStripe(admin);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Stripe not configured.";
    return NextResponse.json({ error: msg }, { status: 503 });
  }
  const { stripe } = stripeBundle;

  const appUrl = (process.env.APP_URL ?? "https://live.isunday.me").replace(/\/$/, "");

  // Check for an existing Connect account.
  const { data: existing } = await admin
    .from("host_integrations")
    .select("provider_account_id")
    .eq("host_id", host.id)
    .eq("provider", "stripe_connect")
    .maybeSingle();

  let accountId = existing?.provider_account_id ?? null;

  if (!accountId) {
    try {
      const account = await stripe.accounts.create({
        type: "express",
        email: (host as { email?: string }).email ?? user.email ?? undefined,
        metadata: {
          host_id: host.id,
          user_id: user.id,
        },
        settings: {
          payouts: { schedule: { interval: "manual" } },
        },
      });
      accountId = account.id;

      await admin.from("host_integrations").upsert(
        {
          host_id: host.id,
          provider: "stripe_connect",
          provider_account_id: accountId,
          provider_account_name: (host as { display_name?: string }).display_name ?? null,
          provider_account_avatar_url: null,
          access_token: null,
          refresh_token: null,
          token_expires_at: null,
          scopes: [],
          metadata: { details_submitted: false, charges_enabled: false, payouts_enabled: false },
          connected_at: new Date().toISOString(),
          last_refreshed_at: new Date().toISOString(),
        },
        { onConflict: "host_id,provider" },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not create Connect account.";
      console.error("[billing/connect/onboard] account.create failed:", msg);
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  // Generate a fresh account link (these are single-use and expire quickly).
  try {
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl}/api/billing/connect/onboard`,
      return_url: `${appUrl}/api/billing/connect/callback?account=${accountId}`,
      type: "account_onboarding",
    });
    return NextResponse.json({ url: link.url, accountId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not create onboarding link.";
    console.error("[billing/connect/onboard] accountLinks.create failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
