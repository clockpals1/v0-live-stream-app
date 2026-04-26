import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  getBillingConfig,
  redactConfig,
  type BillingConfigPatch,
} from "@/lib/billing/config";

/**
 * GET /api/admin/billing/config
 * Returns a REDACTED view: which key slots are filled, the last 4
 * chars of secret keys, and the active mode + default plan slug. The
 * raw secret values are never sent to a client.
 *
 * PATCH /api/admin/billing/config
 * Apply partial changes. An empty string clears a field. Unknown keys
 * are dropped silently.
 */

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const admin = createAdminClient();
    const config = await getBillingConfig(admin);
    return NextResponse.json({ config: redactConfig(config) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load config";
    console.error("[admin/billing/config] GET failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

const ALLOWED_KEYS: (keyof BillingConfigPatch)[] = [
  "stripe_mode",
  "default_plan_slug",
  "stripe_test_secret_key",
  "stripe_test_publishable_key",
  "stripe_test_webhook_secret",
  "stripe_live_secret_key",
  "stripe_live_publishable_key",
  "stripe_live_webhook_secret",
];

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: BillingConfigPatch;
  try {
    body = (await req.json()) as BillingConfigPatch;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // ─── build sanitised patch ─────────────────────────────────────────
  const patch: Record<string, string | null> = {};
  for (const key of ALLOWED_KEYS) {
    if (key in body) {
      const v = body[key];
      // Empty string → NULL (clear the slot). Whitespace stays as-is
      // because some Stripe keys may have unusual chars but trimmed
      // leading/trailing whitespace from a paste is the typical mistake.
      if (v === "" || v === null) {
        patch[key] = null;
      } else if (typeof v === "string") {
        patch[key] = v.trim();
      }
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No fields to update." },
      { status: 400 },
    );
  }

  // Validate stripe_mode if present.
  if (
    "stripe_mode" in patch &&
    patch.stripe_mode !== "test" &&
    patch.stripe_mode !== "live"
  ) {
    return NextResponse.json(
      { error: "stripe_mode must be 'test' or 'live'." },
      { status: 400 },
    );
  }

  try {
    const admin = createAdminClient();

    // If switching to a mode whose secret key is empty, refuse — better
    // to surface the misconfiguration here than wait for the first
    // checkout call to 503.
    if ("stripe_mode" in patch) {
      const current = await getBillingConfig(admin);
      const targetMode = patch.stripe_mode as "test" | "live";
      const targetKey =
        targetMode === "live"
          ? (patch.stripe_live_secret_key ??
              current.stripe_live_secret_key)
          : (patch.stripe_test_secret_key ??
              current.stripe_test_secret_key);
      if (!targetKey) {
        return NextResponse.json(
          {
            error: `Cannot switch to ${targetMode} mode: the ${targetMode} secret key is empty. Save the key first, then change the mode.`,
          },
          { status: 400 },
        );
      }
    }

    // If changing default_plan_slug, verify the slug exists & is active.
    if ("default_plan_slug" in patch && patch.default_plan_slug) {
      const { data: plan } = await admin
        .from("billing_plans")
        .select("slug, is_active")
        .eq("slug", patch.default_plan_slug)
        .maybeSingle();
      if (!plan) {
        return NextResponse.json(
          { error: `Unknown plan slug "${patch.default_plan_slug}".` },
          { status: 400 },
        );
      }
      if (!plan.is_active) {
        return NextResponse.json(
          { error: `Plan "${patch.default_plan_slug}" is not active.` },
          { status: 400 },
        );
      }
    }

    const { data, error } = await admin
      .from("billing_config")
      .update(patch)
      .eq("id", 1)
      .select()
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({
      config: redactConfig(data as Parameters<typeof redactConfig>[0]),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update config";
    console.error("[admin/billing/config] PATCH failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
