/**
 * Billing — sync Stripe state to the `hosts` row.
 *
 * One function, one job: given a Stripe Subscription, write its current
 * state to the host row identified by `stripe_customer_id`. Every
 * webhook event handler reduces to "fetch the latest sub from Stripe,
 * call this." We never trust event payloads to be the freshest copy of
 * truth — Stripe documents that webhook ordering is best-effort, so we
 * always pull the latest sub server-side before persisting.
 *
 * The hosts table holds the denormalised state that the rest of the
 * app gates features on:
 *   plan_slug                          — derived from the active price id
 *   stripe_customer_id                 — set on first checkout
 *   stripe_subscription_id             — current sub (may be null after cancel)
 *   subscription_status                — Stripe status, mirrored
 *   subscription_current_period_end    — for "renews on" / "ends on" UI
 *   subscription_cancel_at_period_end  — true => grace period until end
 */

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SyncResult {
  hostId: string;
  planSlug: string;
  status: string | null;
}

/**
 * Reconcile a Stripe Subscription into the matching host row.
 *
 * Resolution rules:
 *   - Find the host via `stripe_customer_id = sub.customer`.
 *   - The plan is determined by mapping the sub's first item's
 *     price_id against billing_plans.stripe_price_id_test/live.
 *   - If the sub is canceled and grace period has ended, drop the
 *     host back to the default plan (slug='free' unless the admin
 *     changed billing_config.default_plan_slug).
 */
export async function syncSubscriptionToHost(
  admin: SupabaseClient,
  sub: Stripe.Subscription,
  mode: "test" | "live",
): Promise<SyncResult | null> {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  // 1. Locate the host by customer id.
  const { data: host, error: hostErr } = await admin
    .from("hosts")
    .select("id, plan_slug, user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (hostErr) {
    console.error(
      `[billing/sync] host lookup failed for customer=${customerId}:`,
      hostErr.message,
    );
    return null;
  }
  if (!host) {
    // Customer exists in Stripe but isn't linked to any host — most
    // commonly because checkout completed but the post-checkout webhook
    // hasn't run yet (or ran out of order). Caller can decide whether
    // to retry; we just no-op here to avoid creating orphan rows.
    console.warn(
      `[billing/sync] no host with stripe_customer_id=${customerId}; ignoring event.`,
    );
    return null;
  }

  // 2. Resolve the price id → plan slug. Sub items always have at
  //    least one entry in normal subscription flows.
  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? null;
  let planSlug: string | null = null;
  if (priceId) {
    const col =
      mode === "live" ? "stripe_price_id_live" : "stripe_price_id_test";
    const { data: plan } = await admin
      .from("billing_plans")
      .select("slug")
      .eq(col, priceId)
      .maybeSingle();
    if (plan) planSlug = plan.slug;
  }

  // 3. Decide what plan the host should be on now.
  const isTerminal =
    sub.status === "canceled" ||
    sub.status === "incomplete_expired" ||
    sub.status === "unpaid";

  let nextPlanSlug = host.plan_slug ?? "free";
  if (planSlug && !isTerminal) {
    nextPlanSlug = planSlug;
  } else if (isTerminal) {
    // Drop to the configured default plan.
    const { data: cfg } = await admin
      .from("billing_config")
      .select("default_plan_slug")
      .eq("id", 1)
      .single();
    nextPlanSlug = cfg?.default_plan_slug ?? "free";
  }

  // 4. Persist.
  const periodEndUnix =
    // Stripe returns these on items in some API versions, on the sub
    // itself in others. Be defensive across both shapes.
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    item?.current_period_end ??
    null;

  const { error: updateErr } = await admin
    .from("hosts")
    .update({
      plan_slug: nextPlanSlug,
      stripe_subscription_id: isTerminal ? null : sub.id,
      subscription_status: sub.status,
      subscription_current_period_end: periodEndUnix
        ? new Date(periodEndUnix * 1000).toISOString()
        : null,
      subscription_cancel_at_period_end: !!sub.cancel_at_period_end,
    })
    .eq("id", host.id);

  if (updateErr) {
    console.error(
      `[billing/sync] host update failed for host=${host.id}:`,
      updateErr.message,
    );
    return null;
  }

  return {
    hostId: host.id,
    planSlug: nextPlanSlug,
    status: sub.status,
  };
}

/**
 * For an ad-hoc `customer.deleted` event: clear the linkage but DO NOT
 * downgrade automatically — it's safer to require a deliberate cancel.
 */
export async function clearCustomerLinkage(
  admin: SupabaseClient,
  customerId: string,
): Promise<void> {
  const { error } = await admin
    .from("hosts")
    .update({
      stripe_customer_id: null,
      stripe_subscription_id: null,
      subscription_status: null,
      subscription_current_period_end: null,
      subscription_cancel_at_period_end: false,
    })
    .eq("stripe_customer_id", customerId);
  if (error) {
    console.error(
      `[billing/sync] clearCustomerLinkage failed for ${customerId}:`,
      error.message,
    );
  }
}
