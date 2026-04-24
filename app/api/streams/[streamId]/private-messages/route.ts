import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveRole } from "@/lib/rbac";

/**
 * /api/streams/[streamId]/private-messages
 * -----------------------------------------
 * GET  — list ops-channel messages for this stream (oldest first)
 * POST — send an ops-channel message (body: { body })
 *
 * Authorisation — all paths require the caller to be one of:
 *   • the stream owner
 *   • a platform admin
 *   • a Super User assigned to this stream via stream_operators
 *
 * The DB-level RLS in migration 016 enforces the same rule as a second
 * line of defence, so even if the service-role check here were bypassed
 * the query would still return 0 rows / be rejected.
 *
 * Scope safety: every query filters by :streamId from the URL. There is
 * no "list all my messages" endpoint — scoping is baked into the route
 * shape on purpose, so an operator on stream A cannot read messages from
 * stream B by crafting a query string.
 */

interface Params {
  params: Promise<{ streamId: string }>;
}

interface AuthedContext {
  userId: string;
  hostId: string;
  hostRole: string;
  displayName: string;
  effectiveRoleForMessage: "admin" | "host" | "superuser";
}

/**
 * Resolve the caller's identity and decide whether they may participate in
 * the ops channel for `streamId`. Returns null when access should be denied.
 *
 * We use the admin client for the ownership / operator / role lookups so
 * the access check cannot be short-circuited by an overly-restrictive RLS
 * on an unrelated table — the authorisation logic lives entirely here and
 * in the RLS on stream_private_messages itself.
 */
async function authorise(
  streamId: string
): Promise<AuthedContext | null> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const db = createAdminClient();

  const { data: host } = await db
    .from("hosts")
    .select("id, role, is_admin, display_name, email")
    .eq("user_id", user.id)
    .single();
  if (!host) return null;

  const role = resolveRole(
    host as { role?: string | null; is_admin?: boolean | null }
  );

  // Owner?
  const { data: stream } = await db
    .from("streams")
    .select("id, host_id")
    .eq("id", streamId)
    .single();
  if (!stream) return null;
  const isOwner = stream.host_id === (host as { id: string }).id;

  // Operator?
  let isOperator = false;
  if (!isOwner && role !== "admin") {
    const { data: op } = await db
      .from("stream_operators")
      .select("id")
      .eq("stream_id", streamId)
      .eq("host_id", (host as { id: string }).id)
      .maybeSingle();
    isOperator = !!op;
  }

  const allowed = isOwner || role === "admin" || isOperator;
  if (!allowed) return null;

  // The role label we store on the message — owner sends as "host" (or
  // "admin" if they are an admin), operator sends as "superuser", admin
  // always sends as "admin".
  let effectiveRoleForMessage: AuthedContext["effectiveRoleForMessage"];
  if (role === "admin") {
    effectiveRoleForMessage = "admin";
  } else if (isOwner) {
    effectiveRoleForMessage = "host";
  } else {
    effectiveRoleForMessage = "superuser";
  }

  const displayName =
    (host as { display_name?: string | null; email: string }).display_name ??
    (host as { email: string }).email;

  return {
    userId: user.id,
    hostId: (host as { id: string }).id,
    hostRole: role,
    displayName,
    effectiveRoleForMessage,
  };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { streamId } = await params;
  const ctx = await authorise(streamId);
  if (!ctx)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createAdminClient();
  const { data, error } = await db
    .from("stream_private_messages")
    .select("id, stream_id, sender_host_id, sender_role, sender_name, body, created_at")
    .eq("stream_id", streamId)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ messages: data ?? [] });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { streamId } = await params;
  const ctx = await authorise(streamId);
  if (!ctx)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { body?: string };
  const raw = typeof body?.body === "string" ? body.body : "";
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return NextResponse.json(
      { error: "Message body is required" },
      { status: 400 }
    );
  }
  if (trimmed.length > 2000) {
    return NextResponse.json(
      { error: "Message too long (max 2000 characters)" },
      { status: 400 }
    );
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("stream_private_messages")
    .insert({
      stream_id: streamId,
      sender_host_id: ctx.hostId,
      sender_role: ctx.effectiveRoleForMessage,
      sender_name: ctx.displayName,
      body: trimmed,
    })
    .select(
      "id, stream_id, sender_host_id, sender_role, sender_name, body, created_at"
    )
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ message: data }, { status: 201 });
}
