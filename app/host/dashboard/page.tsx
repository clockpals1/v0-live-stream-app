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

  // Get user's streams
  const { data: streams } = await supabase
    .from("streams")
    .select("*")
    .eq("host_id", host?.id)
    .order("created_at", { ascending: false });

  return (
    <DashboardContent 
      user={user} 
      host={host} 
      streams={streams || []} 
    />
  );
}
