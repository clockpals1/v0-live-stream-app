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

  // Use admin client (service role) if available — bypasses RLS
  // Falls back to regular client if SERVICE_ROLE_KEY not set in this environment
  let db: Awaited<ReturnType<typeof createAdminClient>> | Awaited<ReturnType<typeof createClient>>;
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("no service role key");
    db = createAdminClient();
  } catch {
    db = supabase;
  }

  const { data: host } = await db
    .from("hosts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  let streams = null;
  if (host) {
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
  }

  return (
    <DashboardContent 
      user={user} 
      host={host} 
      streams={streams || []} 
    />
  );
}
