import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/require-admin";
import { FEATURE_KEYS } from "@/lib/billing/plans";

/**
 * PATCH /api/admin/billing/plans/[id]   — partial update
 * DELETE /api/admin/billing/plans/[id]  — hard delete (only if no host
 *                                         is on the plan; otherwise 409)
 *
 * The "free" plan is protected: it cannot be deleted, and is_default
 * cannot be set to false unless another plan is being promoted to
 * default in the same request. The route enforces both.
 */

interface PatchPlanBody {
  name?: string;
  description?: string | null;
  price_cents?: number;
  currency?: string;
  billing_interval?: "month" | "year" | "one_time";
  is_active?: boolean;
  is_default?: boolean;
  sort_order?: number;
  features?: Record<string, boolean | number | null>;
  stripe_price_id_test?: string | null;
  stripe_price_id_live?: string | null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing plan id." }, { status: 400 });
  }

  let body: PatchPlanBody;
  try {
    body = (await req.json()) as PatchPlanBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();

    const { data: existing, error: lookupErr } = await admin
      .from("billing_plans")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (lookupErr) throw new Error(lookupErr.message);
    if (!existing) {
      return NextResponse.json({ error: "Plan not found." }, { status: 404 });
    }

    // ─── build patch object ──────────────────────────────────────────
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.price_cents !== undefined) {
      if (
        !Number.isInteger(body.price_cents) ||
        body.price_cents < 0
      ) {
        return NextResponse.json(
          { error: "price_cents must be a non-negative integer." },
          { status: 400 },
        );
      }
      patch.price_cents = body.price_cents;
    }
    if (body.currency !== undefined) patch.currency = body.currency;
    if (body.billing_interval !== undefined) {
      if (!["month", "year", "one_time"].includes(body.billing_interval)) {
        return NextResponse.json(
          { error: "Invalid billing_interval." },
          { status: 400 },
        );
      }
      patch.billing_interval = body.billing_interval;
    }
    if (body.is_active !== undefined) patch.is_active = body.is_active;
    if (body.sort_order !== undefined) patch.sort_order = body.sort_order;
    if (body.stripe_price_id_test !== undefined)
      patch.stripe_price_id_test = body.stripe_price_id_test;
    if (body.stripe_price_id_live !== undefined)
      patch.stripe_price_id_live = body.stripe_price_id_live;

    if (body.features !== undefined) {
      const safe: Record<string, boolean | number | null> = {};
      for (const k of Object.keys(body.features)) {
        if ((FEATURE_KEYS as readonly string[]).includes(k) || k.startsWith("max_")) {
          safe[k] = body.features[k] as boolean | number | null;
        }
      }
      patch.features = safe;
    }

    // ─── default-plan transitions ───────────────────────────────────
    if (body.is_default === true) {
      // Demote whoever currently holds the default flag.
      await admin
        .from("billing_plans")
        .update({ is_default: false })
        .eq("is_default", true)
        .neq("id", id);
      patch.is_default = true;
    } else if (body.is_default === false && existing.is_default) {
      return NextResponse.json(
        {
          error:
            "Cannot remove default flag without promoting another plan. " +
            "Set is_default=true on a different plan first.",
        },
        { status: 400 },
      );
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No fields to update." },
        { status: 400 },
      );
    }

    const { data, error } = await admin
      .from("billing_plans")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ plan: data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update plan";
    console.error("[admin/billing/plans/:id] PATCH failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { id } = await params;

  try {
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("billing_plans")
      .select("id, slug, is_default")
      .eq("id", id)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Plan not found." }, { status: 404 });
    }
    if (existing.slug === "free") {
      return NextResponse.json(
        { error: "The free plan cannot be deleted." },
        { status: 400 },
      );
    }
    if (existing.is_default) {
      return NextResponse.json(
        {
          error:
            "Cannot delete the default plan. Promote a different plan to default first.",
        },
        { status: 400 },
      );
    }
    // Refuse to delete a plan with active subscribers — those hosts
    // would be left with a dangling FK if we cascaded, and silently
    // moving them to free would surprise the admin.
    const { count } = await admin
      .from("hosts")
      .select("id", { count: "exact", head: true })
      .eq("plan_slug", existing.slug);
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete: ${count} host(s) are on this plan. ` +
            `Move them to a different plan first or deactivate this plan instead.`,
        },
        { status: 409 },
      );
    }

    const { error } = await admin
      .from("billing_plans")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to delete plan";
    console.error("[admin/billing/plans/:id] DELETE failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
