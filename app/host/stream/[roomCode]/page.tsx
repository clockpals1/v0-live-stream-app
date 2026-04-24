import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HostStreamInterface } from "@/components/host/stream-interface";
import { resolveRole, resolveStreamAccess } from "@/lib/rbac";

interface Props {
  params: Promise<{ roomCode: string }>;
}

export default async function HostStreamPage({ params }: Props) {
  const { roomCode } = await params;
  const supabase = await createClient();

  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    redirect("/auth/login");
  }

  if (!user) {
    redirect("/auth/login");
  }

  // Get host record
  const { data: host } = await supabase
    .from("hosts")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!host) {
    redirect("/host/dashboard");
  }

  // Lookup the stream first — no access filter at this step. We decide
  // access via the centralised resolver below so the rules live in one
  // place (owner / admin / operator / cohost / denied).
  const { data: stream } = await supabase
    .from("streams")
    .select("*")
    .eq("room_code", roomCode)
    .single();

  if (!stream) {
    redirect("/host/dashboard");
  }

  // Does this user hold a stream_operators row for this stream? RLS on
  // stream_operators allows operators to read their own assignments
  // (migration 015), so this query is self-filtering.
  const { data: operatorRow } = await supabase
    .from("stream_operators")
    .select("id")
    .eq("stream_id", stream.id)
    .eq("host_id", host.id)
    .maybeSingle();

  // Cohost assignment (legacy path) — `assigned_host_id` on the streams row.
  const isCohostAssigned =
    (stream as { assigned_host_id?: string }).assigned_host_id === host.id;

  const role = resolveRole(host);
  const access = resolveStreamAccess({
    role,
    isOwner: stream.host_id === host.id,
    isOperator: !!operatorRow,
    isCohost: isCohostAssigned,
  });

  if (access === "denied") {
    // No ownership, no operator assignment, no cohost assignment, not admin:
    // bounce to dashboard rather than leaking the existence of the stream.
    redirect("/host/dashboard");
  }

  return (
    <HostStreamInterface
      stream={stream}
      host={host}
      accessMode={access}
    />
  );
}
