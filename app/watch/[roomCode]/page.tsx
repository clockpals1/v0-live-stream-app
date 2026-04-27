import { createClient } from "@/lib/supabase/server";
import { ViewerStreamInterface } from "@/components/viewer/stream-interface";
import { StreamNotFound } from "@/components/viewer/stream-not-found";

interface Props {
  params: Promise<{ roomCode: string }>;
}

export default async function WatchStreamPage({ params }: Props) {
  const { roomCode } = await params;
  const supabase = await createClient();

  // Fetch stream without hosts join — anon viewers can't access hosts table via RLS
  // Joining hosts would cause an implicit inner join that filters out the stream row
  const { data: stream } = await supabase
    .from("streams")
    .select("*")
    .eq("room_code", roomCode)
    .single();

  if (!stream) {
    return <StreamNotFound roomCode={roomCode} />;
  }

  // Separately fetch host display name (server has service role via cookie if host is viewing,
  // otherwise falls back gracefully to empty)
  let hostName = "Host";
  if (stream.host_id) {
    const { data: hostData } = await supabase
      .from("hosts")
      .select("display_name, email")
      .eq("id", stream.host_id)
      .single();
    if (hostData) {
      hostName = hostData.display_name || hostData.email || "Host";
    }
  }

  return (
    <ViewerStreamInterface
      stream={stream}
      hostName={hostName}
    />
  );
}

// Note: stream.branding is selected by `select *` above and reaches
// ViewerStreamInterface via the stream prop. The viewer reads
// branding.watchPageTheme + branding.accentColor at the root and
// applies them via a CSS variable + data-brand-theme attribute.
