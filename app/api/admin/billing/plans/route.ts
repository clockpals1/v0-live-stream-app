import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/require-admin";
import { listAllPlans, FEATURE_KEYS } from "@/lib/billing/plans";

/**
 * GET /api/admin/billing/plans
 * List every plan, active or not.
 *
 * POST /api/admin/billing/plans
 * Create a new plan. Body shape mirrors lib/billing/plans.ts BillingPlan
 * minus DB-managed fields. Slug must be unique and URL-safe.
 */

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const admin = createAdminClient();
    const plans = await listAllPlans(admin);
    return NextResponse.json({ plans });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to list plans";
    console.error("[admin/billing/plans] GET failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

interface CreatePlanBody {
  slug: string;
  name: string;
  description?: string | null;
  price_cents: number;
  currency?: string;
  billing_interval?: "month" | "year" | "one_time";
  is_active?: boolean;
  is_default?: boolean;
  sort_order?: number;
  features?: Record<string, boolean | number | null>;
  stripe_price_id_test?: string | null;
  stripe_price_id_live?: string | null;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: CreatePlanBody;
  try {
    body = (await req.json()) as CreatePlanBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // ─── validation ──────────────────────────────────────────────────
  if (!body.slug || !SLUG_RE.test(body.slug)) {
    return NextResponse.json(
      {
        error:
          "slug must be lowercase letters, digits, or hyphens (2–32 chars).",
      },
      { status: 400 },
    );
  }
  if (!body.name || body.name.length > 80) {
    return NextResponse.json(
      { error: "name is required (≤80 chars)." },
      { status: 400 },
    );
  }
  if (
    typeof body.price_cents !== "number" ||
    !Number.isInteger(body.price_cents) ||
    body.price_cents < 0
  ) {
    return NextResponse.json(
      { error: "price_cents must be a non-negative integer." },
      { status: 400 },
    );
  }
  if (
    body.billing_interval &&
    !["month", "year", "one_time"].includes(body.billing_interval)
  ) {
    return NextResponse.json(
      { error: "billing_interval must be month, year, or one_time." },
      { status: 400 },
    );
  }
  // Strip unknown feature keys so admins can't smuggle arbitrary keys
  // into plan rows; the canonical list lives in lib/billing/plans.ts.
  const safeFeatures: Record<string, boolean | number | null> = {};
  if (body.features && typeof body.features === "object") {
    for (const k of Object.keys(body.features)) {
      if ((FEATURE_KEYS as readonly string[]).includes(k) || k.startsWith("max_")) {
        safeFeatures[k] = body.features[k] as boolean | number | null;
      }
    }
  }

  try {
    const admin = createAdminClient();

    // If the new plan claims is_default, clear the flag on whoever has
    // it now. Doing this in two queries inside a try/catch is fine
    // because the partial unique index blocks dupes anyway.
    if (body.is_default) {
      await admin
        .from("billing_plans")
        .update({ is_default: false })
        .eq("is_default", true);
    }

    const { data, error } = await admin
      .from("billing_plans")
      .insert({
        slug: body.slug,
        name: body.name,
        description: body.description ?? null,
        price_cents: body.price_cents,
        currency: body.currency ?? "usd",
        billing_interval: body.billing_interval ?? "month",
        is_active: body.is_active ?? true,
        is_default: body.is_default ?? false,
        sort_order: body.sort_order ?? 0,
        features: safeFeatures,
        stripe_price_id_test: body.stripe_price_id_test ?? null,
        stripe_price_id_live: body.stripe_price_id_live ?? null,
      })
      .select()
      .single();

    if (error) {
      // 23505 = unique_violation in Postgres. Surface a friendly message.
      if (error.code === "23505") {
        return NextResponse.json(
          { error: `A plan with slug "${body.slug}" already exists.` },
          { status: 409 },
        );
      }
      throw new Error(error.message);
    }

    return NextResponse.json({ plan: data }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create plan";
    console.error("[admin/billing/plans] POST failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
