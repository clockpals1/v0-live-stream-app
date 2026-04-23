import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DashboardContent } from "@/components/host/dashboard-content";

export default async function HostDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Use admin client (service role) so RLS never blocks the host lookup
  const adminClient = createAdminClient();

  const { data: host } = await adminClient
    .from("hosts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  // Get streams — admin client bypasses RLS here too for reliability
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
