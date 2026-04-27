import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/discover
 *
 * Public (no auth required) discovery endpoint.
 * Returns four datasets:
 *
 *   live       — streams currently live or waiting to start
 *   upcoming   — scheduled streams in the future (next 7 days)
 *   replays    — published replay_publications (most recent first)
 *   subscribed — streams from hosts the viewer has previously watched,
 *                identified by a comma-separated list of host IDs passed
 *                in the ?following= query param. Completely optional;
 *                omitted/empty means no subscribed section is returned.
 *
 * All four queries hit RLS-permitted public policies — no service role needed:
 *   streams:              "Everyone can view active/scheduled streams"
 *   replay_publications:  "Public can view published replays"
 *   hosts:                "Anyone can view host public info"
 *   stream_archives:      public SELECT on archives backing published replays (026)
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(req.url);
  const followingParam = searchParams.get("following") ?? "";
  const followingIds = followingParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // ── Live streams ─────────────────────────────────────────────────────────
  const { data: liveStreams } = await supabase
    .from("streams")
    .select(
      "id, room_code, title, status, viewer_count, started_at, scheduled_at, host_id"
    )
    .in("status", ["live", "waiting"])
    .order("viewer_count", { ascending: false })
    .limit(12);

  // ── Upcoming scheduled streams (next 7 days) ─────────────────────────────
  const now = new Date().toISOString();
  const in7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: upcomingStreams } = await supabase
    .from("streams")
    .select(
      "id, room_code, title, status, scheduled_at, description, host_id"
    )
    .eq("status", "scheduled")
    .gt("scheduled_at", now)
    .lt("scheduled_at", in7)
    .order("scheduled_at", { ascending: true })
    .limit(8);

  // ── Published replays ─────────────────────────────────────────────────────
  const { data: replayRows } = await supabase
    .from("replay_publications")
    .select(
      "id, slug, title, description, thumbnail_url, published_at, view_count, like_count, host_id, archive_id"
    )
    .eq("is_published", true)
    .order("published_at", { ascending: false })
    .limit(12);

  // ── Subscribed feeds (optional — only when ?following= is provided) ───────
  let subscribedStreams: typeof liveStreams = [];
  if (followingIds.length > 0) {
    const { data: subData } = await supabase
      .from("streams")
      .select(
        "id, room_code, title, status, viewer_count, started_at, scheduled_at, host_id"
      )
      .in("host_id", followingIds)
      .in("status", ["live", "waiting", "scheduled"])
      .order("created_at", { ascending: false })
      .limit(8);
    subscribedStreams = subData ?? [];
  }

  // ── Resolve host display names for all referenced host IDs ───────────────
  const allHostIds = Array.from(
    new Set([
      ...(liveStreams ?? []).map((s) => s.host_id),
      ...(upcomingStreams ?? []).map((s) => s.host_id),
      ...(replayRows ?? []).map((r) => r.host_id),
      ...subscribedStreams.map((s) => s.host_id),
    ].filter(Boolean))
  );

  const hosts: Record<string, { display_name: string | null; email: string }> = {};
  if (allHostIds.length > 0) {
    const { data: hostRows } = await supabase
      .from("hosts")
      .select("id, display_name, email")
      .in("id", allHostIds);
    for (const h of hostRows ?? []) {
      hosts[h.id] = { display_name: h.display_name, email: h.email };
    }
  }

  return NextResponse.json({
    live: liveStreams ?? [],
    upcoming: upcomingStreams ?? [],
    replays: replayRows ?? [],
    subscribed: subscribedStreams,
    hosts,
  });
}
