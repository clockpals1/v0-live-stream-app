import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isNextControlFlowSignal } from "@/lib/next/control-flow";
import { ProjectWorkspace } from "@/components/ai/video/project-workspace";
import type { VideoProject } from "@/components/ai/video/project-workspace";

export const dynamic = "force-dynamic";

export default async function VideoProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  try {
    return await renderPage(id);
  } catch (err) {
    if (isNextControlFlowSignal(err)) throw err;
    const e = err as Error;
    console.error("[ai/video/[id]] error:", e?.message);
    return (
      <main className="mx-auto max-w-3xl px-5 py-14">
        <p className="text-sm text-muted-foreground">{e?.message || "Failed to load project."}</p>
      </main>
    );
  }
}

async function renderPage(id: string) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) redirect("/auth/login");

  const admin = createAdminClient();

  const { data: host } = await admin
    .from("hosts")
    .select("id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!host) redirect("/auth/login");

  const { data: project, error } = await admin
    .from("video_projects")
    .select("*")
    .eq("id", id)
    .eq("host_id", host.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!project) notFound();

  return <ProjectWorkspace project={project as VideoProject} />;
}
