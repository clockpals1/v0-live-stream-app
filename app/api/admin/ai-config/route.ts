import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAiConfig, redactAiConfig, type AiConfigPatch } from "@/lib/ai/config";

/**
 * GET  /api/admin/ai-config   — load redacted config for the admin panel
 * PATCH /api/admin/ai-config  — update one or more fields
 *
 * Mirrors /api/admin/billing/config exactly:
 *   - Auth via Supabase session; caller must be admin.
 *   - Reads/writes via admin client (bypasses RLS).
 *   - Empty-string values are converted to NULL (key clear).
 *   - Response always returns the redacted config so the UI
 *     can re-sync in a single round-trip.
 */

async function assertAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: host } = await supabase
    .from("hosts")
    .select("role, is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host || (host.role !== "admin" && !host.is_admin)) return null;
  return user;
}

export async function GET() {
  const user = await assertAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const admin = createAdminClient();
  const cfg = await getAiConfig(admin);
  if (!cfg) {
    return NextResponse.json(
      { error: "ai_config table not found. Apply migration 033 in the Supabase SQL editor." },
      { status: 404 },
    );
  }
  return NextResponse.json({ config: redactAiConfig(cfg) });
}

export async function PATCH(req: NextRequest) {
  const user = await assertAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  let patch: AiConfigPatch;
  try {
    patch = (await req.json()) as AiConfigPatch;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Sanitise: empty strings → null (clears the key in the DB).
  const sanitised: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === "string") {
      sanitised[k] = v.trim() === "" ? null : v.trim();
    } else {
      sanitised[k] = v;
    }
  }

  // Block updating id or updated_at from the client.
  delete sanitised.id;
  delete sanitised.updated_at;

  if (Object.keys(sanitised).length === 0) {
    return NextResponse.json({ error: "No fields to update." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error: updateErr } = await admin
    .from("ai_config")
    .update(sanitised)
    .eq("id", 1);

  if (updateErr) {
    console.error("[api/admin/ai-config] update failed:", updateErr.message);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const updated = await getAiConfig(admin);
  if (!updated) return NextResponse.json({ error: "Failed to re-load config." }, { status: 500 });

  return NextResponse.json({ config: redactAiConfig(updated) });
}
