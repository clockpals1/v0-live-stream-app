import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Stream-scoped private messages.
 *
 *   POST /api/streams/:streamId/private-messages
 *        body { message: string }
 *
 * Access control is enforced at the database level by the can_access_stream_pm
 * RLS helper (migration 016): only admin / owner / assigned operator / assigned
 * cohost can insert or read rows. This route only does shape validation +
 * resolves the sender's hosts.id + name so the client doesn't have to send
 * fields the server can derive.
 *
 * GET is not implemented here because the client fetches history directly
 * via Supabase (RLS-filtered).
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ streamId: string }> },
) {
  const { streamId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { message?: string } | null;
  const message = (body?.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });
  if (message.length > 2000) {
    return NextResponse.json({ error: "message too long (max 2000)" }, { status: 400 });
  }

  // Resolve sender host.id + display_name + role in one query.
  const { data: me } = await supabase
    .from("hosts")
    .select("id, display_name, email, role, is_admin")
    .eq("user_id", user.id)
    .single();
  if (!me) return NextResponse.json({ error: "host not found" }, { status: 404 });

  // Normalise role. Legacy rows may have is_admin=true but no role column set.
  const role =
    me.role === "admin" ||
    me.role === "host" ||
    me.role === "cohost" ||
    me.role === "super_user"
      ? me.role
      : me.is_admin
        ? "admin"
        : "host";

  const senderName = me.display_name || me.email || "Unknown";

  const { data, error } = await supabase
    .from("stream_private_messages")
    .insert({
      stream_id: streamId,
      sender_id: me.id,
      sender_role: role,
      sender_name: senderName,
      message,
    })
    .select("*")
    .single();

  if (error) {
    // RLS rejection (user isn't admin/owner/operator/cohost for this stream)
    if (error.code === "42501") {
      return NextResponse.json({ error: "not allowed for this stream" }, { status: 403 });
    }
    // Table missing — migration 016 not applied yet
    if (error.code === "42P01") {
      return NextResponse.json(
        { error: "stream_private_messages table not found — run migration 016." },
        { status: 501 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
