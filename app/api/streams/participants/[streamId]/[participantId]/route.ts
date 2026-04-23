import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface Params {
  params: Promise<{ streamId: string; participantId: string }>;
}

// PATCH /api/streams/participants/[streamId]/[participantId] — update label or status
export async function PATCH(req: NextRequest, { params }: Params) {
  const { streamId, participantId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch {
    adminClient = supabase;
  }

  const body = await req.json();

  const { data, error } = await adminClient
    .from("stream_participants")
    .update(body)
    .eq("id", participantId)
    .eq("stream_id", streamId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ participant: data });
}

// DELETE /api/streams/participants/[streamId]/[participantId] — remove co-host
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { streamId, participantId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch {
    adminClient = supabase;
  }

  // If this participant was the active one, clear active_participant_id first
  await adminClient
    .from("streams")
    .update({ active_participant_id: null })
    .eq("id", streamId)
    .eq("active_participant_id", participantId);

  const { error } = await adminClient
    .from("stream_participants")
    .delete()
    .eq("id", participantId)
    .eq("stream_id", streamId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
