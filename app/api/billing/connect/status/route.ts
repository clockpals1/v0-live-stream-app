import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveStripe } from "@/lib/billing/stripe";

/**
 * GET /api/billing/connect/status
 *
 * Returns the host's Stripe Connect account status, re-fetching live
 * state from Stripe when an account_id is on record so charges_enabled
 * and payouts_enabled are always fresh.
 *
 * The Connect account ID is stored in host_integrations with
 * provider='stripe_connect', consistent with YouTube / other integrations.
 *
 * Response shape:
 *   {
 *     connected: boolean,
 *     accountId: string | null,
 *     detailsSubmitted: boolean,
 *     chargesEnabled: boolean,
 *     payoutsEnabled: boolean,
 *     requirements: string[],
 *     dashboardUrl: string | null,
 *   }
 */
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();
  const { data: host } = await admin
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host) return NextResponse.json({ error: "No host profile." }, { status: 404 });

  const { data: row } = await admin
    .from("host_integrations")
    .select("provider_account_id, metadata, connected_at")
    .eq("host_id", host.id)
    .eq("provider", "stripe_connect")
    .maybeSingle();

  if (!row?.provider_account_id) {
    return NextResponse.json({
      connected: false,
      accountId: null,
      detailsSubmitted: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      requirements: [],
      dashboardUrl: null,
    });
  }

  const accountId = row.provider_account_id;

  // Re-fetch live state from Stripe so caps/requirements are always current.
  try {
    const { stripe } = await getActiveStripe(admin);
    const account = await stripe.accounts.retrieve(accountId);

    const meta = {
      details_submitted: account.details_submitted,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
    };
    const requirements = [
      ...(account.requirements?.currently_due ?? []),
    ];

    // Persist fresh state back so the page SSR doesn't need to call this.
    await admin
      .from("host_integrations")
      .update({ metadata: meta, last_refreshed_at: new Date().toISOString() })
      .eq("host_id", host.id)
      .eq("provider", "stripe_connect");

    return NextResponse.json({
      connected: true,
      accountId,
      detailsSubmitted: account.details_submitted,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      requirements,
      dashboardUrl: `https://dashboard.stripe.com/connect/accounts/${accountId}`,
    });
  } catch (e) {
    // Stripe not configured or account deleted — fall back to stored metadata.
    const meta = (row.metadata ?? {}) as Record<string, boolean>;
    return NextResponse.json({
      connected: true,
      accountId,
      detailsSubmitted: meta.details_submitted ?? false,
      chargesEnabled: meta.charges_enabled ?? false,
      payoutsEnabled: meta.payouts_enabled ?? false,
      requirements: [],
      dashboardUrl: null,
      _stale: true,
      _error: e instanceof Error ? e.message : "Stripe unavailable.",
    });
  }
}
