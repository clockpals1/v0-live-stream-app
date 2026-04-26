import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * DELETE /api/admin/billing/grants/[id]
 *   Body: { reason?: string }
 *
 * Soft-deletes (revokes) a grant. We never DELETE from the table —
 * the audit trail must remain. The row stays, but revoked_at,
 * revoked_by, revoked_by_email, and revoke_reason are populated;
 * from that moment forward the entitlement resolver no longer
 * considers this grant active.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing grant id." }, { status: 400 });
  }

  let body: { reason?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Body is optional for revoke; ignore parse errors and continue.
  }
  if (body.reason && body.reason.length > 500) {
    return NextResponse.json(
      { error: "Reason must be 500 characters or fewer." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Look up first so we can 404 vs 409 (already revoked).
  const { data: existing, error: lookupErr } = await admin
    .from("admin_plan_grants")
    .select("id, host_id, plan_slug, revoked_at")
    .eq("id", id)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Grant not found." }, { status: 404 });
  }
  if (existing.revoked_at) {
    return NextResponse.json(
      { error: "Grant is already revoked.", revokedAt: existing.revoked_at },
      { status: 409 },
    );
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updErr } = await admin
    .from("admin_plan_grants")
    .update({
      revoked_at: nowIso,
      revoked_by: auth.userId,
      revoked_by_email: auth.email || null,
      revoke_reason: body.reason?.trim() || null,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  console.info(
    `[admin-grant] ${auth.email || auth.userId} revoked grant ${id} (${existing.plan_slug}) for host ${existing.host_id}`,
  );

  return NextResponse.json({ ok: true, grant: updated });
}
