/**
 * Billing — plan & feature lookup.
 *
 * Single source of truth for "what is this host allowed to do?". Every
 * feature gate (cloud archive, YouTube upload, Insider Circle broadcast,
 * etc.) flows through `featureEnabled(plan, "key")`. This means a new
 * paid feature only needs (a) a key added to FEATURE_KEYS below and (b)
 * an admin toggle in the plan editor — no migration, no code rollout.
 *
 * Phase 1 ships a single shipped feature key, "insider_circle", because
 * Insider Circle was just released. Phase 2/3 add cloud_archive and
 * youtube_upload alongside the actual implementations.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The full set of capability keys the platform recognises. Adding a new
 * key here is the FIRST step before wiring up the feature: every plan's
 * `features` JSON in the DB will be inspected against this list.
 */
export const FEATURE_KEYS = [
  "insider_circle",
  "cloud_archive",
  "youtube_upload",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export interface BillingPlan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  billing_interval: "month" | "year" | "one_time";
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
  features: Partial<Record<FeatureKey, boolean | number | null>> & Record<string, unknown>;
  stripe_price_id_test: string | null;
  stripe_price_id_live: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Returns true iff the plan has the given feature enabled.
 *
 * Semantics:
 *   - missing key in plan.features  → false (default-deny)
 *   - explicit `true`               → enabled
 *   - explicit `false`              → disabled
 *   - explicit number / null        → enabled (numeric values represent
 *                                     quotas, e.g. max_subscribers; the
 *                                     caller should also read the value)
 *
 * This default-deny posture means a freshly-created plan with `{}` for
 * features cannot accidentally unlock paid capabilities.
 */
export function featureEnabled(
  plan: Pick<BillingPlan, "features"> | null | undefined,
  key: FeatureKey | string,
): boolean {
  if (!plan) return false;
  const v = plan.features?.[key as FeatureKey];
  if (v === undefined) return false;
  if (v === false) return false;
  return true;
}

/**
 * Look up an arbitrary numeric quota from a plan, with a fallback when
 * the plan didn't specify one. Use this for things like
 * `featureQuota(plan, "max_subscribers", null)` where null means
 * unlimited.
 */
export function featureQuota(
  plan: Pick<BillingPlan, "features"> | null | undefined,
  key: string,
  fallback: number | null,
): number | null {
  if (!plan) return fallback;
  const v = plan.features?.[key as FeatureKey];
  if (typeof v === "number") return v;
  if (v === null) return null;
  return fallback;
}

/**
 * Load the currently-active plan for a host by their user id. Uses the
 * provided Supabase client (caller chooses anon-RLS vs service-role).
 *
 * Returns null if the host row doesn't exist or no plan is assigned —
 * callers should treat null the same as the free plan with no extras.
 */
export async function getPlanForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<BillingPlan | null> {
  const { data: host, error: hostErr } = await supabase
    .from("hosts")
    .select("plan_slug")
    .eq("user_id", userId)
    .maybeSingle();
  if (hostErr || !host?.plan_slug) return null;

  const { data: plan, error: planErr } = await supabase
    .from("billing_plans")
    .select("*")
    .eq("slug", host.plan_slug)
    .maybeSingle();
  if (planErr || !plan) return null;
  return plan as BillingPlan;
}

/**
 * List every plan (active + inactive). Admin-only callers should use
 * the admin client; the upgrade-UI version is `listActivePlans`.
 */
export async function listAllPlans(
  supabase: SupabaseClient,
): Promise<BillingPlan[]> {
  const { data, error } = await supabase
    .from("billing_plans")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as BillingPlan[]) ?? [];
}

/**
 * Active plans only, for the host-facing upgrade picker.
 */
export async function listActivePlans(
  supabase: SupabaseClient,
): Promise<BillingPlan[]> {
  const { data, error } = await supabase
    .from("billing_plans")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as BillingPlan[]) ?? [];
}
