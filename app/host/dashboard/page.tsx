import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardContent } from "@/components/host/dashboard-content";

export default async function HostDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Check if user is a registered host
  const { data: host } = await supabase
    .from("hosts")
    .select("*")
    .eq("user_id", user.id)
    .single();

  // Get streams where this host is owner OR assigned broadcaster
  // Fall back to simple host_id query if assigned_host_id column not yet migrated
  let streams = null;
  if (host) {
    const { data: fullData, error: fullErr } = await supabase
      .from("streams")
      .select("*")
      .or(`host_id.eq.${host.id},assigned_host_id.eq.${host.id}`)
      .order("created_at", { ascending: false });

    if (fullErr) {
      const { data: fallbackData } = await supabase
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
