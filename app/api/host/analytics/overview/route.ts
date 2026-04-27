import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/host/analytics/overview
 *
 * Aggregates stream, replay, chat, and subscriber data for the
 * authenticated host. Used by the Studio Insights page and the host
 * dashboard quick-stats row.
 *
 * Response shape:
 *   {
 *     streams: { total, liveMinutes, peakConcurrent, avgViewers, totalViewerSessions }
 *     chat: { total, avgPerStream }
 *     replays: { total, totalViews, totalLikes, totalComments }
 *     subscribers: { active, total }
 *
 *     // Time-series for charts (ordered oldest → newest)
 *     viewersByStream: Array<{ title, viewers, durationMins, date }>   // last 10
 *     subscriberGrowth: Array<{ week, newCount, cumulative }>           // last 12 wks
 *     topReplays: Array<{ title, views, likes, comments }>              // top 5
 *     chatByStream: Array<{ title, messages }>                          // last 10
 *   }
 */

interface StreamRow {
  id: string;
  title: string;
  status: string;
  viewer_count: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

interface ReplayPubRow {
  id: string;
  title: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  published_at: string | null;
}

interface SubRow {
  created_at: string;
  is_active: boolean;
}

function durationMins(s: StreamRow): number {
  if (!s.started_at || !s.ended_at) return 0;
  return Math.round(
    (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000,
  );
}

// Build last N ISO week labels (Mon-Sun) ending today.
function lastNWeekLabels(n: number): string[] {
  const weeks: string[] = [];
  const now = new Date();
  // Snap to Monday of current week
  const dayOfWeek = (now.getDay() + 6) % 7; // 0=Mon
  const monday = new Date(now);
  monday.setDate(monday.getDate() - dayOfWeek);
  monday.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(monday);
    d.setDate(d.getDate() - i * 7);
    weeks.push(d.toISOString().slice(0, 10));
  }
  return weeks;
}

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();

  const { data: host } = await admin
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host) return NextResponse.json({ error: "No host profile." }, { status: 404 });

  const hostId = (host as { id: string }).id;

  // ── Parallel fetches ─────────────────────────────────────────────────

  const [streamsRes, pubsRes, subsRes] = await Promise.all([
    admin
      .from("streams")
      .select("id, title, status, viewer_count, started_at, ended_at, created_at")
      .eq("host_id", hostId)
      .order("created_at", { ascending: false })
      .limit(200),
    (async () => {
      try {
        return await admin
          .from("replay_publications")
          .select("id, title, view_count, like_count, comment_count, published_at")
          .eq("host_id", hostId)
          .eq("is_published", true)
          .order("view_count", { ascending: false })
          .limit(50);
      } catch {
        return { data: [] as ReplayPubRow[], error: null };
      }
    })(),
    (async () => {
      try {
        return await admin
          .from("host_subscribers")
          .select("created_at, is_active")
          .eq("host_id", hostId)
          .order("created_at", { ascending: true })
          .limit(5000);
      } catch {
        return { data: [] as SubRow[], error: null };
      }
    })(),
  ]);

  const streams: StreamRow[] = (streamsRes.data ?? []) as StreamRow[];
  const pubs: ReplayPubRow[] = (pubsRes.data ?? []) as ReplayPubRow[];
  const subs: SubRow[] = (subsRes.data ?? []) as SubRow[];

  // ── Stream metrics ───────────────────────────────────────────────────

  const endedStreams = streams.filter(
    (s) => s.status === "ended" && s.started_at && s.ended_at,
  );
  const peakConcurrent = streams.reduce(
    (m, s) => Math.max(m, s.viewer_count ?? 0),
    0,
  );
  const totalViewerSessions = streams.reduce(
    (sum, s) => sum + (s.viewer_count ?? 0),
    0,
  );
  const liveMinutes = endedStreams.reduce((sum, s) => sum + durationMins(s), 0);
  const avgViewers =
    streams.length > 0 ? Math.round(totalViewerSessions / streams.length) : 0;

  // ── Chat messages for each stream ────────────────────────────────────
  // Count only for last 10 ended streams to avoid huge fan-outs.

  const recentStreamIds = streams
    .filter((s) => s.status === "ended")
    .slice(0, 10)
    .map((s) => s.id);

  interface ChatCountRow {
    stream_id: string;
    count: number;
  }
  let chatCounts: ChatCountRow[] = [];
  if (recentStreamIds.length > 0) {
    try {
      // PostgREST doesn't support GROUP BY directly, so we count per stream.
      const { data: chatData } = await admin
        .from("chat_messages")
        .select("stream_id")
        .in("stream_id", recentStreamIds);
      if (chatData) {
        const tally: Record<string, number> = {};
        for (const row of chatData as { stream_id: string }[]) {
          tally[row.stream_id] = (tally[row.stream_id] ?? 0) + 1;
        }
        chatCounts = Object.entries(tally).map(([stream_id, count]) => ({
          stream_id,
          count,
        }));
      }
    } catch {
      // chat_messages table may not be accessible — safe to skip
    }
  }
  const totalChatMessages = chatCounts.reduce((s, r) => s + r.count, 0);
  const avgChatPerStream =
    chatCounts.length > 0 ? Math.round(totalChatMessages / chatCounts.length) : 0;

  // ── Replay metrics ───────────────────────────────────────────────────

  const totalReplayViews = pubs.reduce((s, p) => s + (p.view_count ?? 0), 0);
  const totalReplayLikes = pubs.reduce((s, p) => s + (p.like_count ?? 0), 0);
  const totalReplayComments = pubs.reduce((s, p) => s + (p.comment_count ?? 0), 0);

  // ── Subscriber growth (last 12 weeks) ────────────────────────────────

  const weekLabels = lastNWeekLabels(12);
  const subsGrowth = weekLabels.map((weekStart, i) => {
    const weekEnd = weekLabels[i + 1] ?? new Date().toISOString().slice(0, 10);
    const newThisWeek = subs.filter(
      (s) => s.created_at >= weekStart && s.created_at < weekEnd,
    ).length;
    const cumulativeUp = subs.filter((s) => s.created_at < weekEnd).length;
    return {
      week: weekStart,
      newCount: newThisWeek,
      cumulative: cumulativeUp,
    };
  });

  // ── viewers-by-stream series (last 10 ended) ─────────────────────────

  const viewersByStream = streams
    .filter((s) => s.status === "ended")
    .slice(0, 10)
    .reverse()
    .map((s) => ({
      title:
        s.title.length > 22 ? s.title.slice(0, 22) + "…" : s.title,
      viewers: s.viewer_count ?? 0,
      durationMins: durationMins(s),
      date: s.created_at.slice(0, 10),
    }));

  // ── chat by stream ────────────────────────────────────────────────────

  const chatByStream = recentStreamIds
    .map((id) => {
      const s = streams.find((x) => x.id === id);
      const c = chatCounts.find((r) => r.stream_id === id);
      return {
        title: s
          ? s.title.length > 22
            ? s.title.slice(0, 22) + "…"
            : s.title
          : id,
        messages: c?.count ?? 0,
      };
    })
    .reverse();

  // ── top replays ───────────────────────────────────────────────────────

  const topReplays = pubs.slice(0, 5).map((p) => ({
    title: p.title.length > 26 ? p.title.slice(0, 26) + "…" : p.title,
    views: p.view_count ?? 0,
    likes: p.like_count ?? 0,
    comments: p.comment_count ?? 0,
  }));

  return NextResponse.json({
    streams: {
      total: streams.length,
      liveMinutes,
      peakConcurrent,
      avgViewers,
      totalViewerSessions,
    },
    chat: { total: totalChatMessages, avgPerStream: avgChatPerStream },
    replays: {
      total: pubs.length,
      totalViews: totalReplayViews,
      totalLikes: totalReplayLikes,
      totalComments: totalReplayComments,
    },
    subscribers: {
      active: subs.filter((s) => s.is_active).length,
      total: subs.length,
    },
    viewersByStream,
    subscriberGrowth: subsGrowth,
    topReplays,
    chatByStream,
  });
}
