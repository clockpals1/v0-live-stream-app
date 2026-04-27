import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: host } = await supabase
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!host) return NextResponse.json({ error: "Host not found" }, { status: 404 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const update: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") update.enabled = body.enabled;
  if (typeof body.label === "string" && body.label.trim()) update.label = body.label.trim();
  if (body.config && typeof body.config === "object") update.config = body.config;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data: rule, error: patchErr } = await supabase
    .from("ai_automation_rules")
    .update(update)
    .eq("id", id)
    .eq("host_id", host.id)
    .select()
    .single();

  if (patchErr) return NextResponse.json({ error: patchErr.message }, { status: 500 });
  if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  return NextResponse.json({ rule });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: host } = await supabase
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!host) return NextResponse.json({ error: "Host not found" }, { status: 404 });

  const { error: delErr } = await supabase
    .from("ai_automation_rules")
    .delete()
    .eq("id", id)
    .eq("host_id", host.id);

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
