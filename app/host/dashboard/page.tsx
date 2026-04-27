import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DashboardContent } from "@/components/host/dashboard-content";
import { ensureHostRow, getBootstrapAdminEmail } from "@/lib/host/bootstrap";
import { getEffectivePlan } from "@/lib/billing/entitlements";

/**
 * Host dashboard — entry point for the live surface.
 *
 * Three responsibilities:
 *   1. Auth gate (redirect to login if no session).
 *   2. Provision the host row if missing — shared with the studio
 *      layout via `ensureHostRow`. Two surfaces, ONE bootstrap path,
 *      so a host who lands on either side first gets identical state.
 *   3. Resolve effective plan + admin status (same path the studio
 *      uses), and load the host's streams for the dashboard UI.
 *
 * Admin bootstrap is opt-in via the HOST_BOOTSTRAP_ADMIN_EMAIL env
 * var. We no longer hard-code an address into the source. If the env
 * is unset, no auto-promotion happens and admins are minted via the
 * admin client by hand.
 */
export default async function HostDashboardPage() {
  const supabase = await createClient();

  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    redirect("/auth/login");
  }
  if (!user) redirect("/auth/login");

  // Prefer the service-role client when available (bypasses RLS,
  // cleaner error messages). Fall back to the user-scoped client —
  // migration 024 lets it self-insert anyway.
  let usingAdminClient = false;
  let db: ReturnType<typeof createAdminClient> | typeof supabase;
  try {
    db = createAdminClient();
    usingAdminClient = true;
  } catch {
    db = supabase;
  }

  // Shared bootstrap. The studio layout calls the same helper.
  let host = await ensureHostRow(db, user);

  // Optional admin bootstrap. Only flips is_admin if (a) we actually
  // have the service-role client (RLS would reject from the user
  // client) and (b) the configured bootstrap email matches.
  if (host && usingAdminClient) {
    const bootstrapEmail = getBootstrapAdminEmail();
    if (
      bootstrapEmail &&
      user.email?.toLowerCase() === bootstrapEmail &&
      !host.is_admin
    ) {
      try {
        await db.from("hosts").update({ is_admin: true }).eq("id", host.id);
        host = { ...host, is_admin: true };
      } catch (err) {
        console.warn("[host/dashboard] admin bootstrap failed:", err);
      }
    }
  }

  // Streams owned OR co-hosted by this host. The .or() variant covers
  // both relationships in a single query; we fall back to a simple
  // host_id filter when the column isn't present.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let streams: any[] | null = null;
  if (host) {
    try {
      const { data: fullData, error: fullErr } = await db
        .from("streams")
        .select("*")
        .or(`host_id.eq.${host.id},assigned_host_id.eq.${host.id}`)
        .order("created_at", { ascending: false });
      if (fullErr) {
        const { data: fallbackData } = await db
          .from("streams")
          .select("*")
          .eq("host_id", host.id)
          .order("created_at", { ascending: false });
        streams = fallbackData;
      } else {
        streams = fullData;
      }
    } catch {
      streams = [];
    }
  }

  // Effective plan — same resolver the studio layout uses, so the
  // host sees a consistent "Plan: X" label across both surfaces.
  const effective = host
    ? await getEffectivePlan(db, user.id)
    : null;

  // Operator-stream assignments — prefetched server-side so the
  // Super User banner and "Streams You Manage" section render on first
  // paint, not after a client-side async flash. The client-side
  // realtime subscription in DashboardContent will keep it live.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let initialOperatorStreams: any[] = [];
  if (host) {
    try {
      const { data: opData } = await db
        .from("stream_operators")
        .select("id, stream:streams(id, title, room_code, status)")
        .eq("host_id", host.id);
      initialOperatorStreams = ((opData as any[]) ?? []).filter(
        (r) => r.stream && r.stream.status !== "ended",
      );
    } catch {
      // stream_operators table may not exist yet — safe to start empty.
      initialOperatorStreams = [];
    }
  }

  return (
    <DashboardContent
      user={user}
      host={host}
      streams={streams || []}
      effectivePlan={effective}
      initialOperatorStreams={initialOperatorStreams}
    />
  );
}
