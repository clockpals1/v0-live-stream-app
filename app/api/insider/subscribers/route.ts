import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/insider/subscribers
 *
 * Returns the authenticated host's own subscriber list. Relies on the
 * `host_subscribers_select_own` RLS policy from migration 018, so no
 * service-role key is needed and a host can never accidentally read
 * another host's subscribers via this endpoint.
 *
 * Response shape:
 *   {
 *     hostId: string,
 *     totalActive: number,
 *     totalAll: number,
 *     subscribers: Array<{ id, email, source_room_code, is_active, created_at }>
 *   }
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: host } = await supabase
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!host) {
    return NextResponse.json({ error: "Not a registered host" }, { status: 403 });
  }

  // RLS limits results to this host's rows; we still pass the filter
  // explicitly so a future policy change can't accidentally widen access.
  const { data: subs, error } = await supabase
    .from("host_subscribers")
    .select("id, email, source_room_code, is_active, created_at, unsubscribed_at")
    .eq("host_id", host.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[insider/subscribers] query failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const subscribers = subs ?? [];
  const totalActive = subscribers.filter((s) => s.is_active).length;

  return NextResponse.json({
    hostId: host.id,
    totalActive,
    totalAll: subscribers.length,
    subscribers,
  });
}
