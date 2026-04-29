import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * DELETE /api/ai/assets/[id]
 * Archives (soft-deletes) a non-video AI generated asset.
 * Use DELETE /api/ai/video/[id] for video projects (it archives both project + asset).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();

  const { data: host } = await admin
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host) return NextResponse.json({ error: "Host not found." }, { status: 404 });

  const { data: asset } = await admin
    .from("ai_generated_assets")
    .select("id")
    .eq("id", id)
    .eq("host_id", host.id)
    .maybeSingle();
  if (!asset) return NextResponse.json({ error: "Asset not found." }, { status: 404 });

  const { error } = await admin
    .from("ai_generated_assets")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/ai/assets/[id]
 * Updates mutable fields on an asset. Currently supports: is_starred.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();

  const { data: host } = await admin
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host) return NextResponse.json({ error: "Host not found." }, { status: 404 });

  const { data: asset } = await admin
    .from("ai_generated_assets")
    .select("id")
    .eq("id", id)
    .eq("host_id", host.id)
    .maybeSingle();
  if (!asset) return NextResponse.json({ error: "Asset not found." }, { status: 404 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const ALLOWED = ["is_starred"];
  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED) {
    if (key in body) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  const { data: updated, error } = await admin
    .from("ai_generated_assets")
    .update(updates)
    .eq("id", id)
    .select("id, is_starred")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, asset: updated });
}
