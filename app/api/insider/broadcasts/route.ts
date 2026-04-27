import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/insider/broadcasts
 *
 * Returns the authenticated host's broadcast history, most recent first.
 * Uses admin client to read html_body + sensitive columns — the caller
 * is always the authenticated host (auth check below), never a viewer.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: host } = await supabase
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host) return NextResponse.json({ error: "Not a registered host" }, { status: 403 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("host_broadcasts")
    .select("id, subject, recipient_count, sent_count, failed_count, status, sent_at, created_at")
    .eq("host_id", host.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[insider/broadcasts] query failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ broadcasts: data ?? [] });
}
