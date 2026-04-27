import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const VALID_PLATFORMS = ["youtube", "instagram", "tiktok", "twitter", "linkedin"] as const;
const VALID_STATUSES = ["draft", "approved", "scheduled", "publishing", "published", "failed"] as const;

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: host } = await supabase
    .from("hosts").select("id").eq("user_id", user.id).single();
  if (!host) return NextResponse.json({ error: "Host not found" }, { status: 404 });

  const status = req.nextUrl.searchParams.get("status");
  const platform = req.nextUrl.searchParams.get("platform");

  let query = supabase
    .from("publish_queue")
    .select(
      "id, title, body, platform, platform_meta, status, scheduled_for, published_at, " +
      "platform_post_id, platform_post_url, attempt_count, last_error, last_attempt_at, " +
      "ai_suggested_time, ai_suggestion_reason, asset_id, archive_id, created_at, updated_at"
    )
    .eq("host_id", host.id)
    .order("created_at", { ascending: false });

  if (status && VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    query = query.eq("status", status);
  }
  if (platform && VALID_PLATFORMS.includes(platform as typeof VALID_PLATFORMS[number])) {
    query = query.eq("platform", platform);
  }

  const { data: items, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: items ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: host } = await supabase
    .from("hosts").select("id").eq("user_id", user.id).single();
  if (!host) return NextResponse.json({ error: "Host not found" }, { status: 404 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const { title, platform, platform_meta, scheduled_for, asset_id, archive_id, body: itemBody } =
    body as {
      title?: string;
      platform?: string;
      platform_meta?: Record<string, unknown>;
      scheduled_for?: string;
      asset_id?: string;
      archive_id?: string;
      body?: string;
    };

  if (!title?.trim()) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (!platform || !VALID_PLATFORMS.includes(platform as typeof VALID_PLATFORMS[number])) {
    return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
  }

  const status = scheduled_for ? "scheduled" : "draft";

  const { data: item, error: insertErr } = await supabase
    .from("publish_queue")
    .insert({
      host_id: host.id,
      title: title.trim(),
      body: itemBody ?? null,
      platform,
      platform_meta: platform_meta ?? {},
      status,
      scheduled_for: scheduled_for ?? null,
      asset_id: asset_id ?? null,
      archive_id: archive_id ?? null,
    })
    .select()
    .single();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  return NextResponse.json({ item }, { status: 201 });
}
