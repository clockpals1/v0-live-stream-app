import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const VALID_CATEGORIES = [
  "subscriber",
  "payment",
  "stream",
  "archive",
  "cohost",
  "replay",
  "general",
] as const;

type Category = (typeof VALID_CATEGORIES)[number];

export type NotificationPrefs = Record<Category, boolean>;

/**
 * Default preferences — every category is on unless explicitly disabled.
 */
export const DEFAULT_PREFS: NotificationPrefs = {
  subscriber: true,
  payment: true,
  stream: true,
  archive: true,
  cohost: true,
  replay: true,
  general: true,
};

function resolvePrefs(raw: Record<string, unknown> | null): NotificationPrefs {
  const merged: NotificationPrefs = { ...DEFAULT_PREFS };
  if (raw && typeof raw === "object") {
    for (const cat of VALID_CATEGORIES) {
      if (typeof raw[cat] === "boolean") {
        merged[cat] = raw[cat] as boolean;
      }
    }
  }
  return merged;
}

/**
 * GET /api/host/notification-prefs
 * Returns the host's notification preferences (merged with defaults).
 */
export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();
  const { data: host } = await admin
    .from("hosts")
    .select("notification_prefs")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!host)
    return NextResponse.json({ error: "Host not found." }, { status: 404 });

  return NextResponse.json({
    prefs: resolvePrefs(host.notification_prefs as Record<string, unknown> | null),
  });
}

/**
 * PATCH /api/host/notification-prefs
 * Body: Partial<NotificationPrefs>
 *
 * Merges the supplied keys into the existing prefs JSONB column.
 */
export async function PATCH(req: NextRequest) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: Partial<Record<string, boolean>>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: host } = await admin
    .from("hosts")
    .select("id, notification_prefs")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!host)
    return NextResponse.json({ error: "Host not found." }, { status: 404 });

  const current = resolvePrefs(host.notification_prefs as Record<string, unknown> | null);

  for (const cat of VALID_CATEGORIES) {
    if (typeof body[cat] === "boolean") {
      current[cat] = body[cat] as boolean;
    }
  }

  const { error } = await admin
    .from("hosts")
    .update({ notification_prefs: current })
    .eq("id", host.id);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, prefs: current });
}
