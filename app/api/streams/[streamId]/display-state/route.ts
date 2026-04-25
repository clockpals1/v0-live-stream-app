import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/streams/[streamId]/display-state
 *
 * Single source of truth for persisting the host-controlled display layers
 * — overlay (text + image), ticker (scrolling crawl), and slideshow — onto
 * the streams row. The host and operator UIs both call this endpoint so
 * mid-stream joiners and refreshing viewers always rehydrate the latest
 * state from /watch/[roomCode] regardless of which clientID issued the
 * change.
 *
 * Why a server endpoint instead of letting clients UPDATE the row directly?
 *   - Bypasses any RLS / column-grant edge case (we run with the admin
 *     client). Clients had been doing direct supabase.update() but those
 *     calls were `console.error`-only on failure, so any silent permission
 *     blip turned into the bug "broadcast worked, refresh lost the state".
 *   - One auth check, one update, one shape — easier to evolve.
 *   - Lets us return a structured error the UI can toast on, instead of
 *     swallowing failures.
 *
 * Authorization:
 *   - admin (hosts.role='admin' OR hosts.is_admin)
 *   - stream owner (streams.host_id === caller.hosts.id)
 *   - assigned operator (stream_operators row matches caller.hosts.id)
 *
 * Anything else gets 403.
 *
 * Body shape (all keys optional — only the supplied groups are written):
 *   {
 *     overlay?:   { active, message, background: "dark"|"light"|"branded", imageUrl },
 *     ticker?:    { active, message, speed: "slow"|"normal"|"fast", style: "default"|"urgent"|"info" },
 *     slideshow?: { active, currentUrl, currentCaption },
 *   }
 */

type OverlayInput = {
  active?: boolean;
  message?: string;
  background?: "dark" | "light" | "branded";
  imageUrl?: string;
};
type TickerInput = {
  active?: boolean;
  message?: string;
  speed?: "slow" | "normal" | "fast";
  style?: "default" | "urgent" | "info";
};
type SlideshowInput = {
  active?: boolean;
  currentUrl?: string;
  currentCaption?: string;
};

const VALID_BG = new Set(["dark", "light", "branded"]);
const VALID_SPEED = new Set(["slow", "normal", "fast"]);
const VALID_STYLE = new Set(["default", "urgent", "info"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ streamId: string }> },
) {
  const { streamId } = await params;

  // ── auth ──────────────────────────────────────────────────────────────
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: me } = await supabase
    .from("hosts")
    .select("id, role, is_admin")
    .eq("user_id", user.id)
    .single();
  if (!me) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const isAdmin = me.role === "admin" || me.is_admin === true;

  let allowed = isAdmin;
  if (!allowed) {
    const { data: stream } = await supabase
      .from("streams")
      .select("host_id")
      .eq("id", streamId)
      .single();
    if (stream && stream.host_id === me.id) allowed = true;
  }
  if (!allowed) {
    // Last try: assigned operator on this stream.
    const { data: op } = await supabase
      .from("stream_operators")
      .select("id")
      .eq("stream_id", streamId)
      .eq("host_id", me.id)
      .maybeSingle();
    if (op) allowed = true;
  }
  if (!allowed) {
    return NextResponse.json(
      { error: "only the stream owner, an assigned operator, or an admin can update display state" },
      { status: 403 },
    );
  }

  // ── parse body ────────────────────────────────────────────────────────
  const body = (await req.json().catch(() => null)) as
    | { overlay?: OverlayInput; ticker?: TickerInput; slideshow?: SlideshowInput }
    | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Build the column patch by carefully picking only valid fields.
  const patch: Record<string, unknown> = {};

  if (body.overlay && typeof body.overlay === "object") {
    const o = body.overlay;
    if (typeof o.active === "boolean") patch.overlay_active = o.active;
    if (typeof o.message === "string")
      patch.overlay_message = o.message.slice(0, 120);
    if (typeof o.background === "string" && VALID_BG.has(o.background))
      patch.overlay_background = o.background;
    if (typeof o.imageUrl === "string")
      patch.overlay_image_url = o.imageUrl.slice(0, 1000);
  }

  if (body.ticker && typeof body.ticker === "object") {
    const t = body.ticker;
    if (typeof t.active === "boolean") patch.ticker_active = t.active;
    if (typeof t.message === "string")
      patch.ticker_message = t.message.slice(0, 280);
    if (typeof t.speed === "string" && VALID_SPEED.has(t.speed))
      patch.ticker_speed = t.speed;
    if (typeof t.style === "string" && VALID_STYLE.has(t.style))
      patch.ticker_style = t.style;
  }

  if (body.slideshow && typeof body.slideshow === "object") {
    const s = body.slideshow;
    if (typeof s.active === "boolean") patch.slideshow_active = s.active;
    if (typeof s.currentUrl === "string")
      patch.slideshow_current_url = s.currentUrl.slice(0, 1000);
    if (typeof s.currentCaption === "string")
      patch.slideshow_current_caption = s.currentCaption.slice(0, 280);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, applied: 0 });
  }

  // ── persist via admin client ──────────────────────────────────────────
  // Service role bypasses RLS and any column-level grant surprises. The auth
  // check above already established the caller is admin / owner / operator.
  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("streams")
    .update(patch)
    .eq("id", streamId);

  if (error) {
    console.error("[display-state] persist failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, applied: Object.keys(patch).length });
}
