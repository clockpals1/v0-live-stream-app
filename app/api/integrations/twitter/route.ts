import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTwitterConfig } from "@/lib/integrations/twitter";

/** DELETE /api/integrations/twitter — disconnects the host's Twitter/X account. */
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
    .eq("host_id", host.id).eq("provider", "twitter").maybeSingle();
  if (!row) return NextResponse.json({ ok: true, alreadyDisconnected: true });

  // Best-effort revoke via Twitter OAuth2 revoke endpoint
  if (row.access_token) {
    try {
      const cfg = getTwitterConfig();
      const basicAuth = btoa(`${cfg.clientId}:${cfg.clientSecret}`);
      await fetch("https://api.twitter.com/2/oauth2/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({ token: row.access_token, token_type_hint: "access_token" }),
      });
    } catch (e) {
      console.warn("[twitter/disconnect] revoke failed (non-fatal):", e);
    }
  }

  const { error: delErr } = await admin
    .from("host_integrations").delete().eq("id", row.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
