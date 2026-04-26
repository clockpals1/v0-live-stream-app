import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

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

    const slug = host.plan_slug ?? "free";
    const { data: plan } = await supabase
      .from("billing_plans")
      .select(
        "id, slug, name, description, price_cents, currency, billing_interval, features",
      )
      .eq("slug", slug)
      .maybeSingle();

    return NextResponse.json({
      plan,
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
