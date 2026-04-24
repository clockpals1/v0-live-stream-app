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

  const { data: host } = await supabase
    .from("hosts")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!host) {
    redirect("/host/dashboard");
  }

  // Lookup the stream by room code only — no access filter here. Access is
  // decided below by resolveStreamAccess() so all the rules live in one place.
  // RLS on streams will still prevent rows the user has no policy match for
  // from being returned (operator / owner / admin / cohost), but we want the
  // single source of truth to be our resolveStreamAccess() logic on the row
  // we DO get.
  const { data: stream } = await supabase
    .from("streams")
    .select("*")
    .eq("room_code", roomCode)
    .single();

  if (!stream) {
    redirect("/host/dashboard");
  }

  // Is this host listed as an operator for this stream?
  // stream_operators RLS (migration 016) allows the row to be seen when
  // host_id matches the requester, so this query is self-filtering.
  let isOperator = false;
  try {
    const { data: operatorRow } = await supabase
      .from("stream_operators")
      .select("id")
      .eq("stream_id", stream.id)
      .eq("host_id", host.id)
      .maybeSingle();
    isOperator = !!operatorRow;
  } catch {
    // Table may not exist yet if migration 016 hasn't run — treat as "not operator".
    isOperator = false;
  }

  const role = resolveRole(host);
  const access = resolveStreamAccess({
    role,
    isOwner: stream.host_id === host.id,
    isOperator,
    isCohost: (stream as { assigned_host_id?: string | null }).assigned_host_id === host.id,
  });

  if (access === "denied") {
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
