import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** DELETE /api/integrations/tiktok — disconnects the host's TikTok account. */
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();
  const { data: host } = await admin
    .from("hosts").select("id").eq("user_id", user.id).maybeSingle();
  if (!host) return NextResponse.json({ error: "No host profile." }, { status: 404 });

  const { data: row } = await admin
    .from("host_integrations").select("id, access_token")
    .eq("host_id", host.id).eq("provider", "tiktok").maybeSingle();
  if (!row) return NextResponse.json({ ok: true, alreadyDisconnected: true });

  // Best-effort revoke TikTok token
  if (row.access_token) {
    try {
      await fetch("https://open.tiktokapis.com/v2/oauth/revoke/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: row.access_token }),
      });
    } catch (e) {
      console.warn("[tiktok/disconnect] revoke failed (non-fatal):", e);
    }
  }

  const { error: delErr } = await admin
    .from("host_integrations").delete().eq("id", row.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
