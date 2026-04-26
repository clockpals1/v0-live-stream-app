import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveStripe } from "@/lib/billing/stripe";

/**
 * POST /api/billing/portal
 * Body: none
 *
 * Returns: { url: string } — a one-shot Stripe Customer Portal URL.
 *
 * The portal is Stripe's hosted self-service surface for billing:
 * cancel, update card, change plan, view invoices. Hosts hit this
 * instead of building those screens ourselves.
 *
 * 404 if the host has no stripe_customer_id (i.e. has never paid).
 */

export async function POST() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: host, error: hostErr } = await admin
    .from("hosts")
    .select("id, stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (hostErr || !host) {
    return NextResponse.json(
      { error: "No host profile found." },
      { status: 404 },
    );
  }
  if (!host.stripe_customer_id) {
    return NextResponse.json(
      {
        error:
          "You don't have a billing account yet. Subscribe to a plan first.",
      },
      { status: 404 },
    );
  }

  let stripeBundle;
  try {
    stripeBundle = await getActiveStripe(admin);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Stripe not configured.";
    return NextResponse.json({ error: msg }, { status: 503 });
  }
  const { stripe } = stripeBundle;

  const appUrl = (process.env.APP_URL ?? "https://live.isunday.me").replace(
    /\/$/,
    "",
  );
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: host.stripe_customer_id,
      return_url: `${appUrl}/host/dashboard?billing=returned`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Portal session failed.";
    console.error("[billing/portal] session.create failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
