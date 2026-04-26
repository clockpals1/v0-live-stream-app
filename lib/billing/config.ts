/**
 * Billing — runtime config (Stripe mode + keys).
 *
 * The singleton row at billing_config(id=1) holds Stripe API keys for
 * BOTH test and live mode and a `stripe_mode` discriminator that says
 * which set is active.
 *
 * Keys are stored in the database (admin RLS only) so they can be
 * rotated from the dashboard without a redeploy. Reading them is
 * always done through `getBillingConfig()` so we have one place to add
 * caching, redaction, or audit logging later.
 *
 * NO Stripe SDK call happens here. This module is pure config; Phase 2
 * adds `lib/billing/stripe.ts` which depends on this.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type StripeMode = "test" | "live";

export interface BillingConfig {
  stripe_mode: StripeMode;
  stripe_test_secret_key: string | null;
  stripe_test_publishable_key: string | null;
  stripe_test_webhook_secret: string | null;
  stripe_live_secret_key: string | null;
  stripe_live_publishable_key: string | null;
  stripe_live_webhook_secret: string | null;
  default_plan_slug: string;
  updated_at: string;
}

/**
 * Resolved key bundle for the active mode. `secret` may still be null
 * if the admin hasn't entered the keys yet — callers must check.
 */
export interface ActiveStripeKeys {
  mode: StripeMode;
  secret: string | null;
  publishable: string | null;
  webhookSecret: string | null;
}

/**
 * Load the singleton config row. Caller MUST use an admin/service-role
 * Supabase client — the RLS policy denies non-admin reads.
 */
export async function getBillingConfig(
  supabase: SupabaseClient,
): Promise<BillingConfig> {
  const { data, error } = await supabase
    .from("billing_config")
    .select("*")
    .eq("id", 1)
    .single();
  if (error) throw new Error(`Failed to load billing_config: ${error.message}`);
  return data as BillingConfig;
}

/**
 * Pull the active Stripe key bundle out of a config row.
 *
 * The active set is determined by `stripe_mode`. This is the ONLY
 * place that maps mode → keys, so any future addition (e.g. per-region
 * keys) only needs to be added here.
 */
export function activeKeys(config: BillingConfig): ActiveStripeKeys {
  if (config.stripe_mode === "live") {
    return {
      mode: "live",
      secret: config.stripe_live_secret_key,
      publishable: config.stripe_live_publishable_key,
      webhookSecret: config.stripe_live_webhook_secret,
    };
  }
  return {
    mode: "test",
    secret: config.stripe_test_secret_key,
    publishable: config.stripe_test_publishable_key,
    webhookSecret: config.stripe_test_webhook_secret,
  };
}

/**
 * True iff the active mode has at minimum a secret key entered. The
 * checkout endpoint short-circuits with a 503 when this is false so
 * hosts see "billing not configured" instead of an SDK exception.
 */
export function isStripeConfigured(config: BillingConfig): boolean {
  return Boolean(activeKeys(config).secret);
}

/**
 * Redact secret values before sending the config to a client. The
 * admin dashboard renders masked placeholders for already-saved keys
 * (`sk_test_…XXXX`) so the admin can see at a glance which slots are
 * filled without exposing the value to anyone watching their screen.
 */
export interface RedactedBillingConfig {
  stripe_mode: StripeMode;
  default_plan_slug: string;
  updated_at: string;
  stripe_test_secret_key_set: boolean;
  stripe_test_publishable_key_set: boolean;
  stripe_test_webhook_secret_set: boolean;
  stripe_live_secret_key_set: boolean;
  stripe_live_publishable_key_set: boolean;
  stripe_live_webhook_secret_set: boolean;
  /** Last 4 chars of the secret keys, for the masked placeholder. */
  stripe_test_secret_key_tail: string | null;
  stripe_live_secret_key_tail: string | null;
}

export function redactConfig(config: BillingConfig): RedactedBillingConfig {
  const tail = (s: string | null) =>
    s && s.length > 4 ? s.slice(-4) : null;
  return {
    stripe_mode: config.stripe_mode,
    default_plan_slug: config.default_plan_slug,
    updated_at: config.updated_at,
    stripe_test_secret_key_set: !!config.stripe_test_secret_key,
    stripe_test_publishable_key_set: !!config.stripe_test_publishable_key,
    stripe_test_webhook_secret_set: !!config.stripe_test_webhook_secret,
    stripe_live_secret_key_set: !!config.stripe_live_secret_key,
    stripe_live_publishable_key_set: !!config.stripe_live_publishable_key,
    stripe_live_webhook_secret_set: !!config.stripe_live_webhook_secret,
    stripe_test_secret_key_tail: tail(config.stripe_test_secret_key),
    stripe_live_secret_key_tail: tail(config.stripe_live_secret_key),
  };
}

/**
 * Patch shape accepted by /api/admin/billing/config. Every field is
 * optional; only present fields get written. An empty string clears a
 * key, which the route handler converts to NULL in the DB.
 */
export interface BillingConfigPatch {
  stripe_mode?: StripeMode;
  default_plan_slug?: string;
  stripe_test_secret_key?: string | null;
  stripe_test_publishable_key?: string | null;
  stripe_test_webhook_secret?: string | null;
  stripe_live_secret_key?: string | null;
  stripe_live_publishable_key?: string | null;
  stripe_live_webhook_secret?: string | null;
}
