import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * DELETE /api/integrations/youtube
 *
 * Disconnects the host's YouTube integration. We remove the row
 * (drops the access + refresh tokens) and best-effort revoke the
 * grant on Google's side via their /revoke endpoint. If the revoke
 * fails (e.g. Google's API is down), we still delete the row — the
 * tokens are useless without our client secret anyway, and the host
 * has expressed intent to disconnect.
 *
 * To re-connect, the host can hit /api/integrations/youtube/connect
 * again. Because we always pass prompt=consent, Google will issue a
 * fresh refresh_token on the next consent.
 */
export async function DELETE() {
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
    return NextResponse.json({ error: "No host profile." }, { status: 404 });
  }

  const { data: row } = await admin
    .from("host_integrations")
    .select("id, access_token, refresh_token")
    .eq("host_id", host.id)
    .eq("provider", "youtube")
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ ok: true, alreadyDisconnected: true });
  }

  // Best-effort revoke. We use refresh_token if we have it (revokes
  // the whole grant), otherwise the access_token (revokes only that
  // token but is still effective for our purposes).
  const tokenToRevoke = row.refresh_token ?? row.access_token;
  if (tokenToRevoke) {
    try {
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(
          tokenToRevoke,
        )}`,
        { method: "POST" },
      );
    } catch (e) {
      console.warn("[youtube/disconnect] revoke failed (non-fatal):", e);
    }
  }

  const { error: delErr } = await admin
    .from("host_integrations")
    .delete()
    .eq("id", row.id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
