import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DashboardContent } from "@/components/host/dashboard-content";

// Admin email that is always allowed — bootstrap for initial setup
const ADMIN_EMAIL = "sunday@isunday.me";

export default async function HostDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

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

  // Auto-create the host record for the admin user if it's missing
  if (!host && usingAdminClient && user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    try {
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
        await db
          .from("hosts")
          .update({ is_admin: true } as any)
          .eq("id", (created as any).id);
        host = { ...created, is_admin: true };
      }
    } catch {
      // Auto-create failed — host stays null, user sees access-required UI
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
