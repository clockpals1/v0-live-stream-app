import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HostStreamInterface } from "@/components/host/stream-interface";
import { resolveRole, resolveStreamAccess } from "@/lib/rbac";
import { getEffectivePlan } from "@/lib/billing/entitlements";

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

  // Resolve the effective plan to gate the Branding deck.
  //
  // For owners / admins we use THEIR plan. For operators / cohosts we
  // resolve the OWNER'S plan instead — operators are managing someone
  // else's stream and should see the same locked / unlocked cards the
  // owner would, regardless of the operator's own subscription. That
  // way an admin operator on a Pro host's stream still gets all the
  // premium tools, and a Free-tier operator on a Free host's stream
  // doesn't get to flip on premium features the owner can't keep.
  let planTargetUserId = user.id;
  if (access === "operator" || access === "cohost") {
    const { data: owner } = await supabase
      .from("hosts")
      .select("user_id")
      .eq("id", stream.host_id)
      .single();
    if (owner?.user_id) planTargetUserId = owner.user_id as string;
  }
  const effective = await getEffectivePlan(supabase, planTargetUserId);

  return (
    <HostStreamInterface
      stream={stream}
      host={host}
      accessMode={access}
      effectivePlan={effective.plan}
    />
  );
}
