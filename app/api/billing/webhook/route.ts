import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getActiveStripe,
  verifyWebhookSignature,
  webhookSecretForActiveMode,
} from "@/lib/billing/stripe";
import { syncSubscriptionToHost, clearCustomerLinkage } from "@/lib/billing/sync";

/**
 * POST /api/billing/webhook
 *
 * Stripe -> us. Signature-verified, async-crypto (Workers-safe).
 *
 * Endpoints we handle:
 *   checkout.session.completed
 *     - First successful checkout for a customer. Pull the resulting
 *       subscription and sync it. We always re-fetch the sub from
 *       Stripe rather than trusting the event payload, because event
 *       ordering is best-effort.
 *
 *   customer.subscription.created
 *   customer.subscription.updated
 *   customer.subscription.deleted
 *   customer.subscription.paused
 *   customer.subscription.resumed
 *   customer.subscription.trial_will_end
 *     - Re-sync the host row.
 *
 *   invoice.payment_failed
 *     - Just log it. The matching subscription.updated event already
 *       sets status='past_due', which is what gates feature access.
 *
 *   customer.deleted
 *     - Clear stripe_* columns on the host (defensive cleanup).
 *
 * Returns: 200 on success or "ignored", 400 on signature failure,
 * 500 on internal error. Stripe retries 4xx/5xx with backoff.
 *
 * NOTE
 * ----
 * This route reads the raw request body via req.text() — required for
 * signature verification. Do NOT add a JSON body parser middleware in
 * front of it.
 */

// Force dynamic so Next doesn't try to cache.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // ─── 1. Read raw body ────────────────────────────────────────────
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (e) {
    console.error("[billing/webhook] failed to read request body:", e);
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const signature = req.headers.get("stripe-signature");

  // ─── 2. Resolve Stripe + webhook secret ──────────────────────────
  const admin = createAdminClient();
  let stripe: Stripe;
  let mode: "test" | "live";
  let secret: string | null;
  try {
    const bundle = await getActiveStripe(admin);
    stripe = bundle.stripe;
    mode = bundle.mode;
    secret = webhookSecretForActiveMode(bundle.config);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Stripe not configured.";
    // 503 here means Stripe will retry — fine, admin just hasn't saved
    // the webhook secret yet, the event will get redelivered.
    return NextResponse.json({ error: msg }, { status: 503 });
  }
  if (!secret) {
    console.error(
      `[billing/webhook] no webhook secret saved for ${mode} mode; ` +
        `cannot verify signature. Ignoring event.`,
    );
    // 503 so Stripe retries.
    return NextResponse.json(
      { error: "Webhook secret not configured." },
      { status: 503 },
    );
  }

  // ─── 3. Verify signature ─────────────────────────────────────────
  let event: Stripe.Event;
  try {
    event = await verifyWebhookSignature(stripe, rawBody, signature, secret);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Signature verification failed.";
    console.error("[billing/webhook] verifyWebhookSignature failed:", msg);
    // 400 — Stripe will NOT retry. That's correct: a signature failure
    // means the request is forged or the secret is wrong, both states
    // that retrying won't fix.
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // ─── 4. Dispatch ─────────────────────────────────────────────────
  try {
    await dispatchEvent(stripe, admin, event, mode);
    return NextResponse.json({ received: true, type: event.type });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Handler failed.";
    console.error(`[billing/webhook] handler failed for ${event.type}:`, msg);
    // 500 → Stripe retries. Idempotency is provided by syncSubscriptionToHost
    // which is a deterministic write keyed on the host row.
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function dispatchEvent(
  stripe: Stripe,
  admin: ReturnType<typeof createAdminClient>,
  event: Stripe.Event,
  mode: "test" | "live",
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const subId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      if (!subId) {
        console.warn(
          "[billing/webhook] checkout.session.completed without subscription id; ignoring.",
        );
        return;
      }
      const sub = await stripe.subscriptions.retrieve(subId);
      await syncSubscriptionToHost(admin, sub, mode);
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
    case "customer.subscription.trial_will_end": {
      const sub = event.data.object as Stripe.Subscription;
      // Always re-fetch to defeat race conditions on concurrent events.
      const fresh = await stripe.subscriptions.retrieve(sub.id);
      await syncSubscriptionToHost(admin, fresh, mode);
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      console.warn(
        `[billing/webhook] payment failed for customer=${invoice.customer} invoice=${invoice.id}`,
      );
      // No DB write — the paired subscription.updated event handles
      // status=past_due. Hosts will see it on their dashboard.
      return;
    }

    case "customer.deleted": {
      const customer = event.data.object as Stripe.Customer;
      await clearCustomerLinkage(admin, customer.id);
      return;
    }

    default:
      // Acknowledge unknown events so Stripe stops retrying.
      console.info(`[billing/webhook] ignoring unhandled event: ${event.type}`);
      return;
  }
}
