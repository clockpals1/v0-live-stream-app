"use client";

/**
 * PrivateOpsChat
 * --------------
 * Stream-scoped ops-channel chat between the stream owner, platform admins,
 * and Super Users assigned to this stream. Reuses the same realtime pattern
 * as the viewer chat (Supabase Broadcast on a channel keyed by the
 * stream id) plus API-backed DB persistence so history survives refreshes.
 *
 * Security boundary:
 *   - Reads: authorised server-side by GET /api/streams/[streamId]/private-messages
 *     and enforced by RLS on stream_private_messages (migration 016).
 *   - Writes: authorised the same way by POST to the same endpoint.
 *   - Realtime broadcast: used ONLY for low-latency delivery of the newly
 *     inserted row. The row itself is always persisted via POST first, so
 *     nothing reaches the channel that wasn't already authorised server-side.
 *
 * Scope safety: this component NEVER reads or writes outside the supplied
 * streamId — every request is built from the prop and every channel name
 * is also keyed to that streamId. There is no path to cross-stream data.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, ShieldCheck, User, Users } from "lucide-react";
import { toast } from "sonner";

export interface PrivateMessage {
  id: string;
  stream_id: string;
  sender_host_id: string;
  sender_role: "admin" | "host" | "superuser";
  sender_name: string;
  body: string;
  created_at: string;
}

interface Props {
  streamId: string;
  /** Current user's host id — used to right-align their own messages. */
  currentHostId: string;
  /** Role label so the composer knows whether to hide itself (never for ops). */
  canSend: boolean;
}

const ROLE_ICONS = {
  admin: ShieldCheck,
  host: User,
  superuser: Users,
} as const;

const ROLE_BADGE_CLASS = {
  admin: "bg-primary/10 text-primary border-primary/20",
  host: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  superuser: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
} as const;

const ROLE_LABEL_SHORT = {
  admin: "Admin",
  host: "Host",
  superuser: "Super",
} as const;

export function PrivateOpsChat({ streamId, currentHostId, canSend }: Props) {
  const [messages, setMessages] = useState<PrivateMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  // ── Load history ─────────────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/streams/${streamId}/private-messages`, {
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status !== 403) {
          // 403 is expected when the caller lost access mid-session — don't
          // spam a toast; just render the empty state.
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          console.warn("[ops-chat] load failed:", json.error ?? res.status);
        }
        setMessages([]);
        return;
      }
      const json = (await res.json()) as { messages?: PrivateMessage[] };
      setMessages(json.messages ?? []);
    } finally {
      setLoading(false);
    }
  }, [streamId]);

  useEffect(() => {
    setLoading(true);
    loadHistory();
  }, [loadHistory]);

  // ── Realtime subscribe — channel keyed to this stream only. ─────────────
  useEffect(() => {
    const channel = supabase.channel(`ops-chat-${streamId}`, {
      config: { broadcast: { self: false } },
    });
    channel
      .on(
        "broadcast",
        { event: "ops-message" },
        ({ payload }: { payload: unknown }) => {
          const msg = payload as PrivateMessage;
          if (!msg || msg.stream_id !== streamId) return;
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [streamId, supabase]);

  // Auto-scroll to newest message. block:nearest prevents the whole page
  // from scrolling on mobile (same fix used in viewer chat).
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages.length]);

  // ── Send ─────────────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/streams/${streamId}/private-messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        message?: PrivateMessage;
        error?: string;
      };
      if (!res.ok || !json.message) {
        toast.error(json.error ?? "Could not send message");
        return;
      }
      // Optimistically append locally — we set self:false on the broadcast
      // so we won't receive our own message back through the channel.
      setMessages((prev) => {
        if (prev.some((m) => m.id === json.message!.id)) return prev;
        return [...prev, json.message!];
      });
      // Fan out to other ops participants via Broadcast for zero-lag delivery.
      const channel = supabase.channel(`ops-chat-${streamId}`);
      channel.send({
        type: "broadcast",
        event: "ops-message",
        payload: json.message,
      });
      supabase.removeChannel(channel);
      setDraft("");
    } finally {
      setSending(false);
    }
  }, [draft, sending, streamId, supabase]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const formattedMessages = useMemo(
    () =>
      messages.map((m) => ({
        ...m,
        when: new Date(m.created_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        mine: m.sender_host_id === currentHostId,
      })),
    [messages, currentHostId]
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header / legend */}
      <div className="px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5 text-indigo-500" />
          <span>
            Ops channel — visible only to the stream owner, admins, and assigned
            Super Users.
          </span>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 flex flex-col gap-2">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              <span className="text-sm">Loading…</span>
            </div>
          ) : formattedMessages.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">
              No ops messages yet. Messages are private to stream operators.
            </div>
          ) : (
            formattedMessages.map((m) => {
              const Icon = ROLE_ICONS[m.sender_role] ?? User;
              return (
                <div
                  key={m.id}
                  className={`flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-sm ${
                    m.mine
                      ? "bg-primary/5 border border-primary/10 self-end max-w-[85%]"
                      : "bg-muted/50 border border-border/40 self-start max-w-[85%]"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Icon className="w-3 h-3 shrink-0" />
                    <span className="font-medium text-foreground truncate">
                      {m.sender_name}
                    </span>
                    <Badge
                      variant="outline"
                      className={`h-4 px-1 text-[9px] font-semibold ${
                        ROLE_BADGE_CLASS[m.sender_role]
                      }`}
                    >
                      {ROLE_LABEL_SHORT[m.sender_role]}
                    </Badge>
                    <span className="ml-auto tabular-nums">{m.when}</span>
                  </div>
                  <div className="whitespace-pre-wrap break-words leading-snug">
                    {m.body}
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Composer — hidden for users who can't send on this stream. */}
      {canSend && (
        <div className="p-2 border-t border-border flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Message operators on this stream…"
            maxLength={2000}
            disabled={sending}
            className="flex-1"
          />
          <Button
            size="sm"
            onClick={send}
            disabled={sending || draft.trim().length === 0}
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
