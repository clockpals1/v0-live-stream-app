import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * /api/admin/streams/[streamId]/operators
 * ---------------------------------------
 * Admin-only surface for assigning Super Users (operators) to a specific
 * stream. Operator status is PER-STREAM — a host may be an operator on
 * stream A and not on stream B. This is the same pattern co-host
 * assignments use (stream_participants) but for non-broadcasting operators.
 *
 * GET    — list operators currently assigned to this stream
 * POST   — assign a new operator (body: { host_id })
 * DELETE — unassign an operator (body: { host_id })
 *
 * Authorisation:
 *   Only platform admins may call any of these. The DB-level policies in
 *   migration 015 enforce the same rule; we still check here so the route
 *   returns a clean 403 on unauthenticated hits rather than relying on RLS
 *   to raise a cryptic error.
 *
 * Notes:
 *   - A host assigned as an operator is free to have any role except that
 *     broadcasting capability is orthogonal. We recommend the UI only offer
 *     hosts whose role is "superuser"; however the API does not enforce that
 *     so an admin could, in principle, also assign themselves as an operator.
 *     That's harmless because admins already have global operate rights.
 *   - Deletion is by (stream_id, host_id) — the UNIQUE constraint in
 *     migration 015 ensures one row per pair.
 */

interface Params {
  params: Promise<{ streamId: string }>;
}

async function getAdminUser() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: host } = await supabase
    .from("hosts")
    .select("id, role, is_admin")
    .eq("user_id", user.id)
    .single();
  if (!host) return null;
  const isAdmin =
    (host as { role?: string; is_admin?: boolean }).role === "admin" ||
    (host as { is_admin?: boolean }).is_admin === true;
  return isAdmin ? { user, host } : null;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const authed = await getAdminUser();
  if (!authed)
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { streamId } = await params;
  const db = createAdminClient();

  const { data, error } = await db
    .from("stream_operators")
    .select("id, assigned_at, host:hosts(id, display_name, email, role)")
    .eq("stream_id", streamId)
    .order("assigned_at", { ascending: true });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ operators: data ?? [] });
}

export async function POST(req: NextRequest, { params }: Params) {
  const authed = await getAdminUser();
  if (!authed)
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { streamId } = await params;
  const body = (await req.json()) as { host_id?: string };
  const hostId = body?.host_id;
  if (!hostId) {
    return NextResponse.json({ error: "host_id is required" }, { status: 400 });
  }

  const db = createAdminClient();

  // Make sure the stream actually exists — avoids FK-violation surprises.
  const { data: stream } = await db
    .from("streams")
    .select("id")
    .eq("id", streamId)
    .single();
  if (!stream)
    return NextResponse.json({ error: "Stream not found" }, { status: 404 });

  // Sanity-check the target host exists. We do NOT require role=superuser
  // here — admins can also be explicit operators if ever useful — but we
  // do reject assigning a cohost (they broadcast only) as a cleanliness
  // signal so the UI doesn't offer nonsense assignments.
  const { data: target } = await db
    .from("hosts")
    .select("id, role")
    .eq("id", hostId)
    .single();
  if (!target)
    return NextResponse.json({ error: "Host not found" }, { status: 404 });
  if ((target as { role?: string }).role === "cohost") {
    return NextResponse.json(
      { error: "Co-host accounts cannot be assigned as operators." },
      { status: 400 }
    );
  }

  const { data, error } = await db
    .from("stream_operators")
    .insert({
      stream_id: streamId,
      host_id: hostId,
      assigned_by: authed.host.id,
    })
    .select("id, assigned_at, host:hosts(id, display_name, email, role)")
    .single();

  if (error) {
    // 23505 = unique_violation — the pair is already assigned.
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "That operator is already assigned to this stream." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ operator: data }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const authed = await getAdminUser();
  if (!authed)
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { streamId } = await params;

  // Accept host_id via body OR via ?host_id= query param so the UI can use
  // whichever is convenient (some fetch() paths can't send bodies on DELETE).
  let hostId: string | undefined;
  try {
    const body = await req.json();
    hostId = body?.host_id;
  } catch {
    /* no body is fine — try query */
  }
  if (!hostId) {
    hostId = req.nextUrl.searchParams.get("host_id") ?? undefined;
  }
  if (!hostId) {
    return NextResponse.json({ error: "host_id is required" }, { status: 400 });
  }

  const db = createAdminClient();
  const { error } = await db
    .from("stream_operators")
    .delete()
    .eq("stream_id", streamId)
    .eq("host_id", hostId);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
