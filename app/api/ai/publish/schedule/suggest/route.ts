import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/ai/publish/schedule/suggest?platform=youtube
 *
 * Returns 5 recommended publish time slots for the next 7 days.
 *
 * Scoring logic (heuristic — improves as platform analytics arrive):
 *  1. Inspect host's stream history: weight hours/days when viewer_count peaked.
 *  2. Apply platform-specific best-practice windows as priors when stream
 *     data is sparse.
 *  3. Check existing publish_queue scheduled items and penalise slots that
 *     already have a post scheduled (avoid same-day stacking).
 *  4. Return top 5 slots sorted by score, one slot per day maximum.
 *
 * All times are UTC. The UI notes this clearly to the creator.
 */

type Platform = "youtube" | "instagram" | "tiktok" | "twitter" | "linkedin";

/** Platform best-practice hour windows (UTC) — used when stream data is sparse. */
const PLATFORM_WINDOWS: Record<Platform, Array<{ day: number; hours: number[] }>> = {
  youtube:   [{ day: 2, hours: [14, 15] }, { day: 3, hours: [14, 15] }, { day: 4, hours: [14, 16] }, { day: 6, hours: [10, 12] }, { day: 0, hours: [12, 14] }],
  instagram: [{ day: 1, hours: [11, 12] }, { day: 3, hours: [11, 13] }, { day: 5, hours: [11, 12] }, { day: 2, hours: [14, 16] }, { day: 0, hours: [10, 12] }],
  tiktok:    [{ day: 2, hours: [19, 21] }, { day: 4, hours: [19, 20] }, { day: 5, hours: [19, 21] }, { day: 1, hours: [9, 10] },  { day: 6, hours: [14, 16] }],
  twitter:   [{ day: 1, hours: [8, 9] },  { day: 2, hours: [8, 10] }, { day: 3, hours: [9, 10] },  { day: 4, hours: [8, 9] },  { day: 5, hours: [8, 10] }],
  linkedin:  [{ day: 2, hours: [8, 9] },  { day: 3, hours: [10, 11] }, { day: 4, hours: [9, 10] }, { day: 1, hours: [12, 13] }, { day: 5, hours: [8, 9] }],
};

function nextOccurrence(dayOfWeek: number, hour: number): Date {
  const now = new Date();
  const result = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0, 0));
  let daysUntil = dayOfWeek - now.getUTCDay();
  if (daysUntil < 0 || (daysUntil === 0 && result.getTime() <= now.getTime() + 2 * 60 * 60 * 1000)) {
    daysUntil += 7;
  }
  result.setUTCDate(result.getUTCDate() + daysUntil);
  return result;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: host } = await supabase
    .from("hosts").select("id").eq("user_id", user.id).single();
  if (!host) return NextResponse.json({ error: "Host not found" }, { status: 404 });

  const platform = (req.nextUrl.searchParams.get("platform") ?? "youtube") as Platform;
  const validPlatforms: Platform[] = ["youtube", "instagram", "tiktok", "twitter", "linkedin"];
  if (!validPlatforms.includes(platform)) {
    return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
  }

  // ─── 1. Stream history: aggregate viewer counts by weekday + hour ───
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: streams } = await supabase
    .from("streams")
    .select("created_at, viewer_count")
    .eq("host_id", host.id)
    .gte("created_at", since)
    .not("viewer_count", "is", null)
    .order("viewer_count", { ascending: false })
    .limit(50);

  // Build a map: { "day:hour" → total_viewers }
  const viewerMap: Record<string, number> = {};
  for (const s of streams ?? []) {
    const d = new Date(s.created_at);
    const key = `${d.getUTCDay()}:${d.getUTCHours()}`;
    viewerMap[key] = (viewerMap[key] ?? 0) + (s.viewer_count ?? 0);
  }
  const hasStreamData = Object.keys(viewerMap).length > 0;

  // ─── 2. Existing scheduled items (avoid same-day stacking) ──────────
  const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: scheduled } = await supabase
    .from("publish_queue")
    .select("scheduled_for, platform")
    .eq("host_id", host.id)
    .eq("status", "scheduled")
    .not("scheduled_for", "is", null)
    .lte("scheduled_for", sevenDaysLater);

  const scheduledDays = new Set<string>();
  for (const s of scheduled ?? []) {
    if (s.scheduled_for) {
      const d = new Date(s.scheduled_for);
      scheduledDays.add(`${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`);
    }
  }

  // ─── 3. Score candidate slots ────────────────────────────────────────
  const windows = PLATFORM_WINDOWS[platform] ?? PLATFORM_WINDOWS.youtube;
  const candidates: Array<{ time: Date; score: number; reason: string }> = [];

  for (const window of windows) {
    for (const hour of window.hours) {
      const time = nextOccurrence(window.day, hour);
      const dayKey = `${time.getUTCFullYear()}-${time.getUTCMonth()}-${time.getUTCDate()}`;
      const histKey = `${window.day}:${hour}`;
      const viewers = viewerMap[histKey] ?? 0;

      // Score: historical viewers (0-100 scale) + platform prior (base 50)
      // Penalise same-day slots (score -= 40)
      const historicalScore = hasStreamData ? Math.min(viewers / 10, 50) : 0;
      const priorScore = 50;
      const collisionPenalty = scheduledDays.has(dayKey) ? 40 : 0;
      const score = historicalScore + priorScore - collisionPenalty;

      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const reason = viewers > 0
        ? `Your streams on ${dayNames[window.day]} around ${hour}:00 UTC averaged strong viewership`
        : `${dayNames[window.day]} ${hour}:00 UTC is a recommended posting window for ${platform}`;

      candidates.push({ time, score, reason });
    }
  }

  // ─── 4. Top 5, one per calendar day max ─────────────────────────────
  candidates.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const suggestions = candidates
    .filter((c) => {
      const k = `${c.time.getUTCFullYear()}-${c.time.getUTCMonth()}-${c.time.getUTCDate()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 5)
    .map((c) => ({
      suggested_time: c.time.toISOString(),
      score: Math.round(c.score),
      reason: c.reason,
    }));

  return NextResponse.json({
    platform,
    suggestions,
    based_on_stream_data: hasStreamData,
    stream_count_analyzed: streams?.length ?? 0,
  });
}
