import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DashboardContent } from "@/components/host/dashboard-content";

// Admin email that is always allowed — bootstrap for initial setup
const ADMIN_EMAIL = "sunday@isunday.me";

export default async function HostDashboardPage() {
  const supabase = await createClient();

  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    redirect("/auth/login");
  }

  if (!user) {
    redirect("/auth/login");
  }

  // Try to use the service-role admin client (bypasses RLS, can auto-create record).
  // If SUPABASE_SERVICE_ROLE_KEY is missing, createAdminClient() throws synchronously —
  // we catch that and fall back to the regular anon client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let host: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let streams: any[] | null = null;

  let db: ReturnType<typeof createAdminClient> | Awaited<ReturnType<typeof createClient>>;
  let usingAdminClient = false;

  try {
    db = createAdminClient();
    usingAdminClient = true;
  } catch {
    db = supabase;
  }

  const { data: hostData } = await db
    .from("hosts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  host = hostData;

  // Auto-create the host record on first dashboard visit.
  //
  // Why server-side here (not a Supabase trigger): a Postgres trigger on
  // auth.users would need elevated privileges to write to public.hosts and
  // also wouldn't have access to the user's chosen display_name from
  // user_metadata in a clean way. Doing it here keeps the rule trivially
  // visible alongside the dashboard guard.
  //
  // Every authenticated user who reaches this page is a confirmed host
  // (Supabase enforces email confirmation before getUser() returns a
  // session). They land on plan_slug='free' via the column default; the
  // migration-019 trigger then resolves billing_config.default_plan_slug.
  // ADMIN_EMAIL additionally gets is_admin=true.
  if (!host && user.email) {
    try {
      const isAdmin =
        user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
      // Self-insert is allowed by the migration-024 RLS policy
      // (auth.uid() = user_id), so we can create the row through
      // either the admin client (bypasses RLS) or the regular client.
      const { data: created } = await db
        .from("hosts")
        .insert({
          user_id: user.id,
          email: user.email,
          display_name:
            (user.user_metadata?.display_name as string) ||
            user.email.split("@")[0],
        })
        .select()
        .single();

      if (created) {
        // is_admin can ONLY be set via service role — RLS update policy
        // is just `auth.uid() = user_id`, but the column has no
        // dedicated check on is_admin and we don't want users to be
        // able to escalate. Skip if no admin client is available.
        if (isAdmin && usingAdminClient) {
          await db
            .from("hosts")
            .update({ is_admin: true } as any)
            .eq("id", (created as any).id);
          host = { ...created, is_admin: true };
        } else {
          host = created;
        }
      }
    } catch (err) {
      // Auto-create failed (e.g., race with another tab inserting the same
      // user_id, or RLS surprise). Re-fetch once before falling through to
      // the access-required UI — the row may now exist.
      console.error("[host/dashboard] auto-create failed:", err);
      const { data: retry } = await db
        .from("hosts")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (retry) host = retry;
    }
  }

  // Get streams
  if (host) {
    try {
      const { data: fullData, error: fullErr } = await db
        .from("streams")
        .select("*")
        .or(`host_id.eq.${(host as any).id},assigned_host_id.eq.${(host as any).id}`)
        .order("created_at", { ascending: false });

      if (fullErr) {
        const { data: fallbackData } = await db
          .from("streams")
          .select("*")
          .eq("host_id", (host as any).id)
          .order("created_at", { ascending: false });
        streams = fallbackData;
      } else {
        streams = fullData;
      }
    } catch {
      streams = [];
    }
  }

  return (
    <DashboardContent
      user={user}
      host={host}
      streams={streams || []}
    />
  );
}
