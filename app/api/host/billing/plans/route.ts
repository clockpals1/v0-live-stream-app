import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { listActivePlans } from "@/lib/billing/plans";

/**
 * GET /api/host/billing/plans
 *
 * Returns the active plans (ordered by sort_order asc) plus the
 * caller's current plan slug, so the upgrade UI can render a
 * "current plan" badge without a second request.
 *
 * RLS lets unauthenticated users read active plans too, but we return
 * `currentPlanSlug: null` for them. This is fine because the public
 * pricing page (if added later) needs the same data.
 */

export async function GET() {
  try {
    const supabase = await createServerClient();
    // Anonymous-safe read; the RLS policy "Anyone can read active plans"
    // makes this work without auth.
    const plans = await listActivePlans(supabase);

    let currentPlanSlug: string | null = null;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: host } = await supabase
        .from("hosts")
        .select("plan_slug, subscription_status, subscription_current_period_end, subscription_cancel_at_period_end")
        .eq("user_id", user.id)
        .maybeSingle();
      if (host) {
        currentPlanSlug = host.plan_slug ?? null;
        return NextResponse.json({
          plans,
          currentPlanSlug,
          subscription: {
            status: host.subscription_status ?? null,
            currentPeriodEnd: host.subscription_current_period_end ?? null,
            cancelAtPeriodEnd: host.subscription_cancel_at_period_end ?? false,
          },
        });
      }
    }

    return NextResponse.json({
      plans,
      currentPlanSlug,
      subscription: null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load plans";
    console.error("[host/billing/plans] GET failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
