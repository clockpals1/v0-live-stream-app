"use client";

/**
 * Stream-scoped private messaging.
 *
 * Visible only to (enforced by RLS via the can_access_stream_pm SQL helper):
 *   - the stream's owner
 *   - platform admins
 *   - assigned operators (stream_operators rows)
 *   - the assigned cohost (streams.assigned_host_id)
 *
 * Messages persist in public.stream_private_messages. Live delivery is done
 * via a Supabase Realtime broadcast channel keyed by stream_id so everyone
 * allowed on the channel sees new messages instantly without polling.
 *
 * NOT a public chat — viewers never see these and cannot subscribe.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Send, Lock, ShieldAlert } from "lucide-react";

interface PrivateMessage {
  id: string;
  stream_id: string;
  sender_id: string;
  sender_role: "admin" | "host" | "cohost" | "super_user";
  sender_name: string;
  message: string;
  created_at: string;
}

interface Host {
  id: string;
  display_name: string | null;
  email: string;
  role?: string | null;
}

interface Props {
  streamId: string;
  host: Host;
}

const ROLE_BADGES: Record<string, { label: string; className: string }> = {
  admin: { label: "Admin", className: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
  host: { label: "Host", className: "bg-blue-500/20 text-blue-300 border-blue-500/40" },
  cohost: { label: "Co-host", className: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40" },
  super_user: { label: "Super User", className: "bg-purple-500/20 text-purple-300 border-purple-500/40" },
};

export function PrivateMessagesPanel({ streamId, host }: Props) {
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const channelRef = useRef<any>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<PrivateMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  // Load history + subscribe to the private channel
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from("stream_private_messages")
        .select("*")
        .eq("stream_id", streamId)
        .order("created_at", { ascending: true })
        .limit(200);

      if (cancelled) return;

      if (error) {
        // 42P01 = relation does not exist — migration 016 hasn't run yet.
        if (error.code === "42P01") {
          setUnavailable(true);
          return;
        }
        console.error("[pm] load failed:", error);
        return;
      }
      setMessages((data as PrivateMessage[]) ?? []);
    };

    load();

    const channel = supabase
      .channel(`stream-pm-${streamId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "pm" }, ({ payload }: { payload: any }) => {
        const msg = payload as PrivateMessage;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      })
      .subscribe();

    channelRef.current = channel;
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [streamId, supabase]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  const send = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = newMessage.trim();
      if (!text || sending) return;

      setSending(true);
      try {
        const res = await fetch(`/api/stream-private-messages/${streamId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (res.status === 404 || res.status === 501) {
            setUnavailable(true);
            return;
          }
          toast.error(body.error || "Could not send message");
          return;
        }

        const created = (await res.json()) as PrivateMessage;
        setMessages((prev) => (prev.some((m) => m.id === created.id) ? prev : [...prev, created]));
        setNewMessage("");
        // Broadcast to others on the channel — sender already has it locally.
        channelRef.current?.send({ type: "broadcast", event: "pm", payload: created });
      } catch (err: any) {
        toast.error("Could not send: " + (err?.message ?? "unknown"));
      } finally {
        setSending(false);
      }
    },
    [newMessage, sending, streamId],
  );

  if (unavailable) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-8 text-center text-xs text-muted-foreground gap-2">
        <ShieldAlert className="w-5 h-5 text-amber-400" />
        <p>
          Private messaging table is not yet set up on the database.
          <br />
          Apply <code className="font-mono">016_super_user_role.sql</code> on Supabase.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1.5 px-1 pb-2 text-[11px] text-muted-foreground">
        <Lock className="w-3 h-3 shrink-0" />
        <span className="truncate">
          Private to admin, host, co-host, and stream operators.
        </span>
      </div>

      <ScrollArea className="flex-1 min-h-0 -mx-1 px-1 mb-2">
        <div className="flex flex-col gap-3 pr-1 pb-1">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-8 text-center">
              <Lock className="w-5 h-5 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">No private messages yet.</p>
              <p className="text-[10px] text-muted-foreground/70">
                Start the conversation below — only stream staff will see it.
              </p>
            </div>
          ) : (
            messages.map((m, idx) => {
              const isSelf = m.sender_id === host.id;
              const badge = ROLE_BADGES[m.sender_role] ?? ROLE_BADGES.host;
              const time = new Date(m.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              });
              const prev = messages[idx - 1];
              const sameAuthorCluster =
                prev && prev.sender_id === m.sender_id &&
                new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 2 * 60_000;

              const initial = (m.sender_name || "?").trim().charAt(0).toUpperCase();

              return (
                <div
                  key={m.id}
                  className={`flex gap-2 ${isSelf ? "flex-row-reverse" : "flex-row"} ${
                    sameAuthorCluster ? "-mt-1.5" : ""
                  }`}
                >
                  {!sameAuthorCluster ? (
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${
                        isSelf
                          ? "bg-primary/20 text-primary"
                          : m.sender_role === "admin"
                            ? "bg-amber-500/20 text-amber-300"
                            : m.sender_role === "super_user"
                              ? "bg-purple-500/20 text-purple-300"
                              : m.sender_role === "cohost"
                                ? "bg-cyan-500/20 text-cyan-300"
                                : "bg-blue-500/20 text-blue-300"
                      }`}
                    >
                      {initial}
                    </div>
                  ) : (
                    <div className="w-7 shrink-0" />
                  )}

                  <div className={`flex flex-col max-w-[78%] ${isSelf ? "items-end" : "items-start"}`}>
                    {!sameAuthorCluster && (
                      <div className={`flex items-center gap-1.5 mb-0.5 ${isSelf ? "flex-row-reverse" : ""}`}>
                        <span className="text-[11px] font-semibold text-foreground truncate max-w-[140px]">
                          {isSelf ? "You" : m.sender_name}
                        </span>
                        <Badge variant="outline" className={`h-4 text-[9px] px-1.5 ${badge.className}`}>
                          {badge.label}
                        </Badge>
                      </div>
                    )}
                    <div
                      className={`px-3 py-1.5 rounded-2xl text-[13px] leading-snug border [overflow-wrap:anywhere] ${
                        isSelf
                          ? "bg-primary/15 border-primary/25 text-foreground rounded-tr-sm"
                          : "bg-muted/40 border-border text-foreground rounded-tl-sm"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{m.message}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground/80 mt-0.5 px-1">{time}</span>
                  </div>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      <form onSubmit={send} className="flex gap-2">
        <Input
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value.slice(0, 2000))}
          placeholder="Private message to admin, host, co-host…"
          maxLength={2000}
          disabled={sending}
          className="text-sm"
        />
        <Button type="submit" size="sm" disabled={!newMessage.trim() || sending}>
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}
