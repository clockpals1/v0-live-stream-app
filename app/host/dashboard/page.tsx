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

  const adminClient = createAdminClient();

  // Use service-role client so RLS never blocks the host lookup
  let { data: host } = await adminClient
    .from("hosts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  // Auto-create the host record for the admin user if it's missing
  // (handles migration failures or first-time setup)
  if (!host && user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    const { data: created } = await adminClient
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
      // Mark as admin (column added in migration 006 — safe to attempt)
      await adminClient
        .from("hosts")
        .update({ is_admin: true } as any)
        .eq("id", created.id);

      host = { ...created, is_admin: true };
    }
  }

  // Get streams where this host is owner OR assigned broadcaster
  let streams = null;
  if (host) {
    const { data: fullData, error: fullErr } = await adminClient
      .from("streams")
      .select("*")
      .or(`host_id.eq.${host.id},assigned_host_id.eq.${host.id}`)
      .order("created_at", { ascending: false });

    if (fullErr) {
      const { data: fallbackData } = await adminClient
        .from("streams")
        .select("*")
        .eq("host_id", host.id)
        .order("created_at", { ascending: false });
      streams = fallbackData;
    } else {
      streams = fullData;
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
