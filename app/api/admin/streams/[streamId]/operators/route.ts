import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Endpoints for managing per-stream Super-User / operator assignments.
 *
 *   GET  /api/admin/streams/:streamId/operators
 *        — list { id, host_id, created_at, host: {...} } for this stream
 *
 *   POST /api/admin/streams/:streamId/operators
 *        body { hostId: string }
 *        — assign the given host as an operator on this stream
 *
 * Authorization: the caller must be either
 *   (a) a platform admin (hosts.role === 'admin' OR hosts.is_admin),  OR
 *   (b) the owner of the target stream (streams.host_id === caller.hosts.id).
 *
 * Migration 017 widens the stream_operators RLS policy accordingly, so this
 * API is defence-in-depth — RLS will also reject mismatched writes.
 */

async function requireAdminOrStreamOwner(_req: NextRequest, streamId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const { data: me } = await supabase
    .from("hosts")
    .select("id, role, is_admin")
    .eq("user_id", user.id)
    .single();

  if (!me) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  const isAdmin = me.role === "admin" || me.is_admin === true;
  if (isAdmin) return { supabase, me, isAdmin: true };

  // Fall back: is this caller the owner of the target stream?
  const { data: stream } = await supabase
    .from("streams")
    .select("host_id")
    .eq("id", streamId)
    .single();

  if (stream && stream.host_id === me.id) {
    return { supabase, me, isAdmin: false };
  }

  return {
    error: NextResponse.json(
      { error: "only the stream owner or an admin can manage operators for this stream" },
      { status: 403 },
    ),
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ streamId: string }> },
) {
  const { streamId } = await params;
  const auth = await requireAdminOrStreamOwner(req, streamId);
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
  const auth = await requireAdminOrStreamOwner(req, streamId);
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
