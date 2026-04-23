import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface Params {
  params: Promise<{ streamId: string }>;
}

// PATCH /api/streams/participants/switch/[streamId]
// Body: { participantId: string | null }  — null = switch back to main host
export async function PATCH(req: NextRequest, { params }: Params) {
  const { streamId } = await params;

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch {
    adminClient = await createClient();
  }

  const supabase = await createClient();

  let user: any = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify caller is the stream owner
  const { data: callerHost } = await adminClient
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!callerHost) return NextResponse.json({ error: "Host record not found" }, { status: 403 });

  const { data: stream } = await adminClient
    .from("streams")
    .select("id, host_id")
    .eq("id", streamId)
    .single();

  if (!stream) return NextResponse.json({ error: "Stream not found" }, { status: 404 });
  if (stream.host_id !== callerHost.id) {
    return NextResponse.json({ error: "Only the stream owner can switch cameras" }, { status: 403 });
  }

  const body = await req.json();
  const { participantId } = body as { participantId: string | null };

  const { error } = await adminClient
    .from("streams")
    .update({ active_participant_id: participantId ?? null })
    .eq("id", streamId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, activeParticipantId: participantId ?? null });
}
