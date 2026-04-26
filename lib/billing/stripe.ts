/**
 * Billing — Stripe SDK wrapper.
 *
 * Single entry point for every server-side Stripe call. Handles:
 *  - Lazy SDK construction (one client per process per mode)
 *  - Mode-aware key resolution from billing_config
 *  - Cloudflare Workers compatibility flags
 *
 * RUNTIME NOTE
 * ------------
 * Stripe's Node SDK ships a `httpClient: 'fetch'` option that swaps the
 * default Node http transport for the platform `fetch`. Workers has
 * `fetch` natively but no `http` module, so the fetch transport is the
 * only one that works there. We always pass it explicitly so behaviour
 * is identical in dev (Node) and prod (Workers).
 *
 * Stripe's webhook signature verification has two flavours:
 *   - constructEvent       — uses Node `crypto`. Doesn't work on Workers.
 *   - constructEventAsync  — uses Web Crypto. Works everywhere.
 * Webhook handlers MUST use the async variant.
 */

import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getBillingConfig,
  activeKeys,
  type BillingConfig,
  type StripeMode,
} from "./config";

/**
 * Pinned Stripe API version. Updating this is a deliberate act —
 * webhook event shapes can change, so we want one place to bump it.
 */
const API_VERSION = "2025-09-30.clover" as const;

let _cached:
  | { mode: StripeMode; secret: string; client: Stripe }
  | null = null;

/**
 * Build (or return a cached) Stripe client for the given mode + secret.
 * The cache is keyed on (mode, secret) so rotating a key invalidates
 * the cached client on the next call.
 */
function buildClient(mode: StripeMode, secret: string): Stripe {
  if (_cached && _cached.mode === mode && _cached.secret === secret) {
    return _cached.client;
  }
  const client = new Stripe(secret, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiVersion: API_VERSION as any,
    httpClient: Stripe.createFetchHttpClient(),
    // Identify the platform in Stripe's logs so support can find us.
    appInfo: {
      name: "isunday-live-stream",
      version: "1.0.0",
    },
    // Disable Stripe's built-in network retries on Workers — the
    // platform already has aggressive request timeouts.
    maxNetworkRetries: 0,
    timeout: 30_000,
  });
  _cached = { mode, secret, client };
  return client;
}

/**
 * Get a Stripe client configured for the active mode in billing_config.
 * Throws if the active mode has no secret key (callers should
 * pre-check via `isStripeConfigured` and respond with 503).
 */
export async function getActiveStripe(
  supabase: SupabaseClient,
): Promise<{ stripe: Stripe; mode: StripeMode; config: BillingConfig }> {
  const config = await getBillingConfig(supabase);
  const keys = activeKeys(config);
  if (!keys.secret) {
    throw new Error(
      `Stripe is not configured for ${keys.mode} mode. ` +
        `Add a secret key in /admin/billing first.`,
    );
  }
  return {
    stripe: buildClient(keys.mode, keys.secret),
    mode: keys.mode,
    config,
  };
}

/**
 * Get the price-id stored on a plan for the active mode.
 * Returns null if the admin hasn't pasted one yet — checkout callers
 * should respond with a friendly "this plan isn't payable yet" error.
 */
export function priceIdForActiveMode(
  plan: {
    stripe_price_id_test: string | null;
    stripe_price_id_live: string | null;
  },
  mode: StripeMode,
): string | null {
  return mode === "live"
    ? plan.stripe_price_id_live
    : plan.stripe_price_id_test;
}

/**
 * Get the webhook secret for the active mode.
 */
export function webhookSecretForActiveMode(
  config: BillingConfig,
): string | null {
  return config.stripe_mode === "live"
    ? config.stripe_live_webhook_secret
    : config.stripe_test_webhook_secret;
}

/**
 * Verify a Stripe webhook signature using Web Crypto. Use this
 * exclusively in webhook routes — `constructEvent` (sync) doesn't
 * work on Cloudflare Workers.
 */
export async function verifyWebhookSignature(
  stripe: Stripe,
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<Stripe.Event> {
  if (!signatureHeader) {
    throw new Error("Missing stripe-signature header.");
  }
  return stripe.webhooks.constructEventAsync(
    rawBody,
    signatureHeader,
    secret,
  );
}
