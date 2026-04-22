import { createClient } from "@/lib/supabase/server";
import { ViewerStreamInterface } from "@/components/viewer/stream-interface";
import { StreamNotFound } from "@/components/viewer/stream-not-found";

interface Props {
  params: Promise<{ roomCode: string }>;
}

export default async function WatchStreamPage({ params }: Props) {
  const { roomCode } = await params;
  const supabase = await createClient();

  // Get stream by room code
  const { data: stream } = await supabase
    .from("streams")
    .select(`
      *,
      hosts (
        display_name,
        email
      )
    `)
    .eq("room_code", roomCode)
    .single();

  if (!stream) {
    return <StreamNotFound roomCode={roomCode} />;
  }

  return (
    <ViewerStreamInterface
      stream={stream}
      hostName={stream.hosts?.display_name || "Host"}
    />
  );
}
