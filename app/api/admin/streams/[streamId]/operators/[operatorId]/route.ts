import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * DELETE /api/admin/streams/:streamId/operators/:operatorId
 * — admin removes an operator assignment. The row's id is the stream_operators.id.
 */
export async function DELETE(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ streamId: string; operatorId: string }>;
  },
) {
  const { streamId, operatorId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me } = await supabase
    .from("hosts")
    .select("role, is_admin")
    .eq("user_id", user.id)
    .single();

  if (!me || (me.role !== "admin" && !me.is_admin)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("stream_operators")
    .delete()
    .eq("id", operatorId)
    .eq("stream_id", streamId); // belt + braces

  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json(
        { error: "stream_operators table not found — run migration 016." },
        { status: 501 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
