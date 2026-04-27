import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/host/notifications
 *
 * Returns the 40 most-recent notifications for the authenticated host
 * plus an unread_count.
 */
export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: host } = await admin
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!host) {
    return NextResponse.json({ error: "Host not found." }, { status: 404 });
  }

  const { data: notifications, error } = await admin
    .from("host_notifications")
    .select("id, type, category, title, body, link, read, created_at")
    .eq("host_id", host.id)
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const unread_count = (notifications ?? []).filter((n) => !n.read).length;

  return NextResponse.json({ notifications: notifications ?? [], unread_count });
}
