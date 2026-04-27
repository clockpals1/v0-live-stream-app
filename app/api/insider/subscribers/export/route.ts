import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/insider/subscribers/export
 *
 * Streams a CSV of the authenticated host's full subscriber list.
 * Includes active and unsubscribed rows so hosts have a complete picture
 * for compliance purposes.
 *
 * Columns: email, status, joined_at, unsubscribed_at, source_stream
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: host } = await supabase
    .from("hosts")
    .select("id, display_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host) return NextResponse.json({ error: "Not a registered host" }, { status: 403 });

  const { data: subs, error } = await supabase
    .from("host_subscribers")
    .select("email, is_active, created_at, unsubscribed_at, source_room_code")
    .eq("host_id", host.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[insider/export] query failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = subs ?? [];

  // Build CSV in memory — subscriber lists are typically < 100k rows.
  const header = "email,status,joined_at,unsubscribed_at,source_stream\r\n";
  const body = rows
    .map((r) => {
      const csvCell = (v: string | null | undefined) =>
        v == null ? "" : `"${String(v).replace(/"/g, '""')}"`;
      const status = r.is_active ? "active" : "unsubscribed";
      return [
        csvCell(r.email),
        csvCell(status),
        csvCell(r.created_at),
        csvCell(r.unsubscribed_at),
        csvCell(r.source_room_code),
      ].join(",");
    })
    .join("\r\n");

  const csv = header + body;
  const slug = (host as { display_name?: string }).display_name?.replace(/\s+/g, "_") ?? "host";
  const filename = `insider-circle-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
