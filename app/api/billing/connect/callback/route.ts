import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveStripe } from "@/lib/billing/stripe";

/**
 * GET /api/billing/connect/callback?account=acct_xxx
 *
 * Stripe redirects here after a host completes (or partially completes)
 * the Connect Express onboarding flow. We re-fetch the account to
 * capture the latest charges_enabled / payouts_enabled / requirements
 * state, persist it, then redirect back to the Monetization Center
 * with a status query parameter the UI can toast on.
 */
export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("account") ?? "";
  const appUrl = (process.env.APP_URL ?? "https://live.isunday.me").replace(/\/$/, "");
  const base = `${appUrl}/studio/monetize`;

  if (!accountId) {
    return NextResponse.redirect(`${base}?connect=error&reason=missing_account`);
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${appUrl}/auth/login`);
  }

  const admin = createAdminClient();

  // Verify ownership: the account must be on a connect integration for this host.
  const { data: host } = await admin
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host) {
    return NextResponse.redirect(`${base}?connect=error&reason=no_host`);
  }

  const { data: row } = await admin
    .from("host_integrations")
    .select("id, provider_account_id")
    .eq("host_id", host.id)
    .eq("provider", "stripe_connect")
    .maybeSingle();

  if (!row || row.provider_account_id !== accountId) {
    return NextResponse.redirect(`${base}?connect=error&reason=account_mismatch`);
  }

  // Re-fetch live state from Stripe.
  try {
    const { stripe } = await getActiveStripe(admin);
    const account = await stripe.accounts.retrieve(accountId);

    await admin
      .from("host_integrations")
      .update({
        metadata: {
          details_submitted: account.details_submitted,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
        },
        last_refreshed_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    const status = account.charges_enabled
      ? "connected"
      : account.details_submitted
        ? "pending"
        : "incomplete";

    return NextResponse.redirect(`${base}?connect=${status}`);
  } catch (e) {
    const reason = e instanceof Error ? e.message.slice(0, 100) : "stripe_error";
    console.error("[billing/connect/callback] failed:", reason);
    return NextResponse.redirect(
      `${base}?connect=error&reason=${encodeURIComponent(reason)}`,
    );
  }
}
