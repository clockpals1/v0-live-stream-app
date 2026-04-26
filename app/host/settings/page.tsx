import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SettingsContent } from "@/components/host/settings-content";

/**
 * /host/settings — host preferences hub.
 *
 * Mirrors the auth + host-lookup pattern from /host/dashboard so the
 * page is a drop-in destination for hosts that have already proven
 * their identity at the dashboard. We don't auto-create the host row
 * here — settings are meaningless without one, so a missing row sends
 * the user back to /host/dashboard which knows how to bootstrap it.
 */
export default async function HostSettingsPage() {
  const supabase = await createClient();

  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    redirect("/auth/login");
  }
  if (!user) redirect("/auth/login");

  let db: ReturnType<typeof createAdminClient> | typeof supabase;
  try {
    db = createAdminClient();
  } catch {
    db = supabase;
  }

  const { data: host } = await db
    .from("hosts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!host) {
    // Bounce back to dashboard which has the bootstrap path; once a
    // host row exists, /host/settings will load on retry.
    redirect("/host/dashboard");
  }

  return <SettingsContent user={user} host={host} />;
}
