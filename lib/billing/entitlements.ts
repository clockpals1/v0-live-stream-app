/**
 * Billing — entitlement resolver.
 *
 * `getEffectivePlan()` is the SINGLE function every feature gate
 * should call to ask "what is this user allowed to do?". It composes
 * three independent inputs in a strict precedence order, then returns
 * a single resolved plan object plus enough metadata for the UI to
 * render a clear status pill:
 *
 *   1. ADMIN BYPASS         — hosts.role = 'admin' OR is_admin = true
 *                              → synthetic "platform" plan with every
 *                                feature flag enabled. Admins always
 *                                have access to everything; they never
 *                                need to subscribe.
 *
 *   2. ACTIVE ADMIN GRANT   — most-recent active row in
 *                              admin_plan_grants for this host
 *                              → use that plan_slug.
 *
 *   3. STRIPE / DEFAULT     — fall back to hosts.plan_slug, the
 *                              Stripe-driven (or default-on-signup)
 *                              source of truth.
 *
 * The resolver is intentionally separate from `lib/billing/plans.ts`
 * (which still owns the FEATURE_KEYS catalog and `featureEnabled`)
 * so the manual-grant mechanism can be added or removed in isolation
 * without touching plan/feature semantics.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingPlan, FeatureKey } from "./plans";
import { FEATURE_KEYS, featureEnabled } from "./plans";

export type EntitlementSource = "admin" | "grant" | "stripe" | "default";

export interface ActiveGrant {
  id: string;
  plan_slug: string;
  reason: string | null;
  effective_at: string;
  expires_at: string | null;
  granted_by_email: string | null;
}

export interface EffectivePlan {
  /** The plan whose features should gate access. */
  plan: BillingPlan | null;
  /** Where the plan came from. Useful in UI badges. */
  source: EntitlementSource;
  /** True iff source === 'admin'. */
  isPlatformAdmin: boolean;
  /** Active grant row, if source === 'grant'. */
  grant: ActiveGrant | null;
  /** The host's underlying plan_slug (the Stripe-driven one). */
  underlyingPlanSlug: string | null;
}

/**
 * Synthetic plan returned for admins. Every known feature key is
 * flipped on so any existing or future feature gate auto-allows.
 */
function makeAdminPlan(): BillingPlan {
  const features: Record<string, boolean> = {};
  for (const k of FEATURE_KEYS) features[k] = true;
  return {
    id: "__admin__",
    slug: "__admin__",
    name: "Platform admin",
    description: "Bypasses all entitlement checks.",
    price_cents: 0,
    currency: "usd",
    billing_interval: "month",
    is_active: true,
    is_default: false,
    sort_order: -1,
    features,
    stripe_price_id_test: null,
    stripe_price_id_live: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
}

/**
 * Look up the most-recent active grant for a host. "Active" means:
 *   - revoked_at IS NULL
 *   - effective_at <= now()
 *   - expires_at IS NULL OR expires_at > now()
 *
 * Sorted by effective_at DESC so the newest grant wins if (somehow)
 * multiple are active. Returns null when there are none.
 *
 * Falls through to null on any error (e.g. table doesn't exist yet
 * because migration 022 hasn't been applied) so the resolver remains
 * forward-compatible during partial rollouts.
 */
async function getActiveGrant(
  supabase: SupabaseClient,
  hostId: string,
): Promise<ActiveGrant | null> {
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("admin_plan_grants")
      .select(
        "id, plan_slug, reason, effective_at, expires_at, granted_by_email",
      )
      .eq("host_id", hostId)
      .is("revoked_at", null)
      .lte("effective_at", nowIso)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("effective_at", { ascending: false })
      .limit(1);
    if (error) {
      // Table missing or any other error — treat as "no grant".
      return null;
    }
    return (data?.[0] as ActiveGrant) ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve a host's effective plan. The supplied `supabase` client is
 * used as-is — pass the service-role admin client when calling from a
 * trusted server route, or the user-scoped client when you want RLS
 * to enforce read scope.
 */
export async function getEffectivePlan(
  supabase: SupabaseClient,
  userId: string,
): Promise<EffectivePlan> {
  // 1. Look up the host row. We need its id (for the grant lookup) +
  //    role/is_admin (for the admin bypass) + plan_slug (for the fallback).
  const { data: host } = await supabase
    .from("hosts")
    .select("id, plan_slug, role, is_admin")
    .eq("user_id", userId)
    .maybeSingle();

  // No host row → no entitlements; mirrors getPlanForUser semantics.
  if (!host) {
    return {
      plan: null,
      source: "default",
      isPlatformAdmin: false,
      grant: null,
      underlyingPlanSlug: null,
    };
  }

  // 2. Admin bypass. Either a role of 'admin' or the legacy boolean
  //    column (some deployments only have one).
  const isPlatformAdmin =
    (host as { role?: string | null }).role === "admin" ||
    (host as { is_admin?: boolean | null }).is_admin === true;
  if (isPlatformAdmin) {
    return {
      plan: makeAdminPlan(),
      source: "admin",
      isPlatformAdmin: true,
      grant: null,
      underlyingPlanSlug: (host as { plan_slug?: string | null }).plan_slug ?? null,
    };
  }

  // 3. Active manual grant.
  const grant = await getActiveGrant(supabase, (host as { id: string }).id);
  if (grant) {
    const plan = await loadPlanBySlug(supabase, grant.plan_slug);
    if (plan) {
      return {
        plan,
        source: "grant",
        isPlatformAdmin: false,
        grant,
        underlyingPlanSlug: (host as { plan_slug?: string | null }).plan_slug ?? null,
      };
    }
    // Grant exists but plan was deleted — fall through to plan_slug.
  }

  // 4. Stripe-driven plan_slug (or the default-on-signup slug).
  const underlying = (host as { plan_slug?: string | null }).plan_slug ?? null;
  if (!underlying) {
    return {
      plan: null,
      source: "default",
      isPlatformAdmin: false,
      grant: null,
      underlyingPlanSlug: null,
    };
  }
  const plan = await loadPlanBySlug(supabase, underlying);
  return {
    plan,
    // We can't tell from here whether plan_slug came from a Stripe
    // webhook or the default-on-signup path; both are "Stripe-driven"
    // for entitlement purposes. The /admin/billing UI fetches the
    // host's stripe_subscription_status separately if it needs to
    // distinguish.
    source: plan?.is_default ? "default" : "stripe",
    isPlatformAdmin: false,
    grant: null,
    underlyingPlanSlug: underlying,
  };
}

async function loadPlanBySlug(
  supabase: SupabaseClient,
  slug: string,
): Promise<BillingPlan | null> {
  const { data } = await supabase
    .from("billing_plans")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return (data as BillingPlan) ?? null;
}

/**
 * Convenience wrapper — drop-in replacement for the older
 * `featureEnabled(getPlanForUser(...))` chain. Resolves the effective
 * plan and applies the gate in one call.
 *
 *     if (await isEntitled(supabase, userId, "youtube_upload")) { … }
 *
 * Admins always get true; revoked grants always get false; everything
 * else flows through the FEATURE_KEYS catalog as before.
 */
export async function isEntitled(
  supabase: SupabaseClient,
  userId: string,
  feature: FeatureKey | string,
): Promise<boolean> {
  const eff = await getEffectivePlan(supabase, userId);
  if (eff.isPlatformAdmin) return true;
  return featureEnabled(eff.plan, feature);
}
