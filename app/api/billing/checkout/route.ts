import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveStripe, priceIdForActiveMode } from "@/lib/billing/stripe";
import {
  checkRateLimit,
  rateLimitHeaders,
  POLICY_HEAVY_WRITE,
} from "@/lib/security/rate-limit";

/**
 * POST /api/billing/checkout
 * Body: { planId: string }
 *
 * Returns: { url: string } — the Stripe Checkout URL the host should
 * be redirected to.
 *
 * Flow:
 *  1. Auth check (must be a signed-in host).
 *  2. Resolve the plan and its price id for the active Stripe mode.
 *     If the price id is missing, return 400 with an actionable error.
 *  3. Reuse the host's stripe_customer_id if one exists, otherwise
 *     create a customer with the host's email + a metadata.host_id link.
 *  4. Create a Checkout Session in subscription mode with success and
 *     cancel URLs that route back to /host/dashboard.
 */

export async function POST(req: NextRequest) {
  let body: { planId?: string };
  try {
    body = (await req.json()) as { planId?: string };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }
  const planId = body.planId?.trim();
  if (!planId) {
    return NextResponse.json(
      { error: "planId is required." },
      { status: 400 },
    );
  }

  // ─── auth ────────────────────────────────────────────────────────
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // Cap checkout-session creation per user. Each call hits Stripe's
  // API and may create a new Customer record; loops here are a fast
  // path to a Stripe rate-limit ban on the whole account.
  const rl = checkRateLimit(`user:${user.id}`, POLICY_HEAVY_WRITE);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many checkout attempts. Try again shortly.", code: "rate_limited" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  // ─── load host + plan + stripe ───────────────────────────────────
  const admin = createAdminClient();

  const { data: host, error: hostErr } = await admin
    .from("hosts")
    .select("id, email, display_name, stripe_customer_id, plan_slug")
    .eq("user_id", user.id)
    .maybeSingle();
  if (hostErr || !host) {
    return NextResponse.json(
      { error: "No host profile found for this user." },
      { status: 404 },
    );
  }

  const { data: plan, error: planErr } = await admin
    .from("billing_plans")
    .select("*")
    .eq("id", planId)
    .maybeSingle();
  if (planErr || !plan) {
    return NextResponse.json({ error: "Plan not found." }, { status: 404 });
  }
  if (!plan.is_active) {
    return NextResponse.json(
      { error: "This plan is not currently available." },
      { status: 400 },
    );
  }
  if (plan.slug === host.plan_slug) {
    return NextResponse.json(
      { error: "You are already on this plan." },
      { status: 400 },
    );
  }
  if (plan.price_cents === 0) {
    return NextResponse.json(
      {
        error:
          "Free plans don't go through Checkout. Use /api/billing/portal to switch.",
      },
      { status: 400 },
    );
  }

  let stripeBundle;
  try {
    stripeBundle = await getActiveStripe(admin);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Stripe not configured.";
    return NextResponse.json({ error: msg }, { status: 503 });
  }
  const { stripe, mode } = stripeBundle;

  const priceId = priceIdForActiveMode(plan, mode);
  if (!priceId) {
    return NextResponse.json(
      {
        error: `Plan "${plan.name}" has no Stripe price id for ${mode} mode. ` +
          `Ask an admin to add one in /admin/billing.`,
      },
      { status: 400 },
    );
  }

  // ─── ensure stripe customer ──────────────────────────────────────
  let customerId = host.stripe_customer_id;
  if (!customerId) {
    try {
      const customer = await stripe.customers.create({
        email: host.email ?? user.email ?? undefined,
        name: host.display_name ?? undefined,
        metadata: { host_id: host.id, user_id: user.id },
      });
      customerId = customer.id;
      const { error: linkErr } = await admin
        .from("hosts")
        .update({ stripe_customer_id: customerId })
        .eq("id", host.id);
      if (linkErr) {
        console.error(
          "[billing/checkout] failed to persist customer id:",
          linkErr.message,
        );
        // Continue anyway — the webhook will reconcile later.
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Stripe customer creation failed.";
      console.error("[billing/checkout] customer.create failed:", msg);
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  // ─── checkout session ────────────────────────────────────────────
  const appUrl = (process.env.APP_URL ?? "https://live.isunday.me").replace(
    /\/$/,
    "",
  );
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/host/dashboard?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/host/dashboard?billing=cancelled`,
      // Metadata helps webhook handlers correlate without round-tripping.
      metadata: {
        host_id: host.id,
        plan_slug: plan.slug,
        plan_id: plan.id,
      },
      subscription_data: {
        metadata: {
          host_id: host.id,
          plan_slug: plan.slug,
        },
      },
      // Allow Stripe to collect the customer's billing address (required
      // for tax in many regions and helpful for invoices).
      billing_address_collection: "auto",
      allow_promotion_codes: true,
    });
    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL.");
    }
    return NextResponse.json({ url: session.url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Checkout creation failed.";
    console.error("[billing/checkout] session.create failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
