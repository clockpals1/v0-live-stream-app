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
    .from("hosts").select("id").eq("user_id", user.id).single();
  if (!host) return NextResponse.json({ error: "Host not found" }, { status: 404 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const PATCHABLE = ["title", "body", "platform_meta", "status", "scheduled_for",
    "platform_post_id", "platform_post_url", "last_error", "ai_suggested_time", "ai_suggestion_reason"] as const;
  type PatchKey = typeof PATCHABLE[number];
  const update: Partial<Record<PatchKey, unknown>> = {};
  for (const key of PATCHABLE) {
    if (key in body) update[key] = body[key];
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data: item, error } = await supabase
    .from("publish_queue")
    .update(update)
    .eq("id", id)
    .eq("host_id", host.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  return NextResponse.json({ item });
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
    .from("hosts").select("id").eq("user_id", user.id).single();
  if (!host) return NextResponse.json({ error: "Host not found" }, { status: 404 });

  const { error } = await supabase
    .from("publish_queue")
    .delete()
    .eq("id", id)
    .eq("host_id", host.id)
    .in("status", ["draft", "approved", "failed"]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
