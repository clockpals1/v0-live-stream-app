import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CohostStreamInterface } from "@/components/host/cohost-stream-interface";

interface Props {
  params: Promise<{ roomCode: string; participantId: string }>;
}

export default async function CohostStreamPage({ params }: Props) {
  const { roomCode, participantId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // Get the host record for the logged-in user
  const { data: host } = await supabase
    .from("hosts")
    .select("id, display_name, email")
    .eq("user_id", user.id)
    .single();

  if (!host) redirect("/host/dashboard");

  // Fetch the participant slot — must belong to this host
  const { data: participant } = await supabase
    .from("stream_participants")
    .select("*")
    .eq("id", participantId)
    .eq("host_id", host.id)
    .single();

  if (!participant) redirect("/host/dashboard");

  // Fetch the stream
  const { data: stream } = await supabase
    .from("streams")
    .select("id, room_code, title, status")
    .eq("room_code", roomCode)
    .eq("id", participant.stream_id)
    .single();

  if (!stream) redirect("/host/dashboard");

  return (
    <CohostStreamInterface
      participant={participant}
      stream={stream}
      displayName={host.display_name || host.email}
    />
  );
}
