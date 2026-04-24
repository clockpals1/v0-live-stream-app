import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Admin-only endpoints for managing per-stream Super-User assignments.
 *
 *   GET  /api/admin/streams/:streamId/operators
 *        — list { id, host_id, created_at, host: {...} } for this stream
 *
 *   POST /api/admin/streams/:streamId/operators
 *        body { hostId: string }
 *        — assign the given host as an operator on this stream
 *
 * Admin authorization is enforced by querying hosts.role === 'admin' for the
 * authenticated user. RLS on stream_operators also restricts writes to admins,
 * so this is defence in depth, not the sole check.
 */

async function requireAdmin(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  const { data: me } = await supabase
    .from("hosts")
    .select("id, role, is_admin")
    .eq("user_id", user.id)
    .single();

  if (!me || (me.role !== "admin" && !me.is_admin)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { supabase, me };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ streamId: string }> },
) {
  const { streamId } = await params;
  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;
  const { supabase } = auth;

  const { data, error } = await supabase
    .from("stream_operators")
    .select(
      "id, host_id, created_at, host:hosts!stream_operators_host_id_fkey(id, display_name, email, role)",
    )
    .eq("stream_id", streamId)
    .order("created_at", { ascending: true });

  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json(
        { error: "stream_operators table not found — run migration 016." },
        { status: 501 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ operators: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ streamId: string }> },
) {
  const { streamId } = await params;
  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;
  const { supabase, me } = auth;

  const body = (await req.json().catch(() => null)) as { hostId?: string } | null;
  const hostId = body?.hostId;
  if (!hostId) {
    return NextResponse.json({ error: "hostId required" }, { status: 400 });
  }

  // Verify target host exists. Do NOT restrict by role — admin may want to
  // assign a user with role='host' as an operator on a specific stream.
  const { data: target } = await supabase
    .from("hosts")
    .select("id, display_name, email, role")
    .eq("id", hostId)
    .single();
  if (!target) {
    return NextResponse.json({ error: "host not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("stream_operators")
    .insert({ stream_id: streamId, host_id: hostId, created_by: me.id })
    .select(
      "id, host_id, created_at, host:hosts!stream_operators_host_id_fkey(id, display_name, email, role)",
    )
    .single();

  if (error) {
    // Unique-violation = already assigned
    if (error.code === "23505") {
      return NextResponse.json({ error: "already assigned" }, { status: 409 });
    }
    if (error.code === "42P01") {
      return NextResponse.json(
        { error: "stream_operators table not found — run migration 016." },
        { status: 501 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ operator: data }, { status: 201 });
}
