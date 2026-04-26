import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getEffectivePlan } from "@/lib/billing/entitlements";

/**
 * GET /api/host/billing/subscription
 *
 * Returns the caller's plan + subscription state. Uses the user-scoped
 * Supabase client (RLS reads only the caller's host row), so this is
 * safe to call from any authed page.
 *
 * Response:
 *   {
 *     plan: { id, slug, name, price_cents, currency, billing_interval, features }
 *     subscription: {
 *       status: 'active' | 'trialing' | 'past_due' | 'canceled' | null,
 *       currentPeriodEnd: ISO string | null,
 *       cancelAtPeriodEnd: boolean,
 *       hasCustomer: boolean    // whether a stripe_customer_id exists
 *     } | null
 *   }
 *
 * `subscription` is null for hosts who have never paid. The host's
 * plan is still populated (free) so the dashboard always has data to
 * render.
 */

interface HostRow {
  plan_slug: string | null;
  stripe_customer_id: string | null;
  subscription_status: string | null;
  subscription_current_period_end: string | null;
  subscription_cancel_at_period_end: boolean | null;
}

export async function GET() {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }

    const { data: hostRow, error: hostErr } = await supabase
      .from("hosts")
      .select(
        "plan_slug, stripe_customer_id, subscription_status, subscription_current_period_end, subscription_cancel_at_period_end",
      )
      .eq("user_id", user.id)
      .maybeSingle();
    if (hostErr) {
      return NextResponse.json({ error: hostErr.message }, { status: 500 });
    }
    if (!hostRow) {
      return NextResponse.json({ error: "No host profile." }, { status: 404 });
    }
    const host = hostRow as HostRow;

    // Resolve via the entitlement layer so admin bypass + active
    // manual grants are reflected in the plan returned to the host.
    const eff = await getEffectivePlan(supabase, user.id);

    return NextResponse.json({
      plan: eff.plan,
      // Where the plan came from. UI uses this to badge "Granted",
      // "Platform admin", or hide the upgrade button as appropriate.
      source: eff.source,
      // Active grant metadata, when source === 'grant'. Lets the host
      // see who issued it and when it expires.
      grant: eff.grant
        ? {
            id: eff.grant.id,
            reason: eff.grant.reason,
            effectiveAt: eff.grant.effective_at,
            expiresAt: eff.grant.expires_at,
            grantedByEmail: eff.grant.granted_by_email,
          }
        : null,
      subscription: host.stripe_customer_id
        ? {
            status: host.subscription_status,
            currentPeriodEnd: host.subscription_current_period_end,
            cancelAtPeriodEnd: !!host.subscription_cancel_at_period_end,
            hasCustomer: true,
          }
        : null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load subscription.";
    console.error("[host/billing/subscription] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
