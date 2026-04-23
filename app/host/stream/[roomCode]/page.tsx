import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HostStreamInterface } from "@/components/host/stream-interface";

interface Props {
  params: Promise<{ roomCode: string }>;
}

export default async function HostStreamPage({ params }: Props) {
  const { roomCode } = await params;
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

  // Get host record
  const { data: host } = await supabase
    .from("hosts")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!host) {
    redirect("/host/dashboard");
  }

  // Get stream — allow both the owner AND the assigned host to access
  const { data: stream } = await supabase
    .from("streams")
    .select("*")
    .eq("room_code", roomCode)
    .or(`host_id.eq.${host.id},assigned_host_id.eq.${host.id}`)
    .single();

  if (!stream) {
    redirect("/host/dashboard");
  }

  return (
    <HostStreamInterface
      stream={stream}
      host={host}
    />
  );
}
