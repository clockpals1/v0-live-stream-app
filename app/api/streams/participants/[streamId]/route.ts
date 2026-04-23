import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface Params {
  params: Promise<{ streamId: string }>;
}

// GET /api/streams/participants/[streamId] — list all co-hosts for this stream
export async function GET(_req: NextRequest, { params }: Params) {
  const { streamId } = await params;

  let db;
  try {
    db = createAdminClient();
  } catch {
    db = await createClient();
  }

  const { data, error } = await db
    .from("stream_participants")
    .select("*, host:hosts(id, display_name, email)")
    .eq("stream_id", streamId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ participants: data ?? [] });
}

// POST /api/streams/participants/[streamId] — add a co-host to this stream
export async function POST(req: NextRequest, { params }: Params) {
  const { streamId } = await params;

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch {
    adminClient = await createClient();
  }

  const supabase = await createClient();

  // Get logged-in user
  let user: any = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Get the current user's host record
  const { data: callerHost } = await adminClient
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!callerHost) return NextResponse.json({ error: "Host record not found" }, { status: 403 });

  // Verify the stream belongs to this host
  const { data: stream } = await adminClient
    .from("streams")
    .select("id, host_id")
    .eq("id", streamId)
    .single();

  if (!stream) return NextResponse.json({ error: "Stream not found" }, { status: 404 });
  if (stream.host_id !== callerHost.id) {
    return NextResponse.json({ error: "Only the stream owner can add co-hosts" }, { status: 403 });
  }

  const body = await req.json();
  const { host_id, slot_label } = body as { host_id: string; slot_label?: string };
  if (!host_id) return NextResponse.json({ error: "host_id is required" }, { status: 400 });

  const { data: participant, error } = await adminClient
    .from("stream_participants")
    .insert({ stream_id: streamId, host_id, slot_label: slot_label || "Camera" })
    .select("*, host:hosts(id, display_name, email)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ participant }, { status: 201 });
}
