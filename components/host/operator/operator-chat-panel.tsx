"use client";

/**
 * Redesigned public-chat panel for the operator control room.
 *
 * Purpose: reduce friction during live ops. The old design was a compressed
 * side list with one-line messages; operators had to squint to track what a
 * viewer had just said. This redesign gives each message a colored sender
 * chip, a timestamp, word-wrapped body, and self-vs-others bubble alignment
 * so the operator can act fast without losing context.
 *
 * Subscribes to the same `chat-room-${streamId}` broadcast channel as the
 * owner's stream interface so messages arrive in real time.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, RefreshCw } from "lucide-react";

export interface ChatMessage {
  id: string;
  sender_name: string;
  message: string;
  created_at: string;
}

interface Props {
  /** Operator's display name — marks their own outgoing messages. */
  senderName: string;
  /** Full message list (live-updated by the parent's broadcast subscription). */
  messages: ChatMessage[];
  /** Send a new message — returns true on success. */
  onSend: (text: string) => Promise<boolean>;
  /** Optional refresh — reloads history from DB. */
  onRefresh?: () => Promise<void>;
}

// Stable color assignment per sender name so the operator can track people.
function nameColor(name: string) {
  const palette = [
    "text-sky-400",
    "text-emerald-400",
    "text-amber-400",
    "text-rose-400",
    "text-violet-400",
    "text-cyan-400",
    "text-lime-400",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}

export function OperatorChatPanel({ senderName, messages, onSend, onRefresh }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const [newMessage, setNewMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  const refresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = newMessage.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const ok = await onSend(text);
      if (ok) setNewMessage("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center justify-between px-1 pb-2">
        <span className="text-[11px] text-muted-foreground">
          Public chat — viewers can see what you send here.
        </span>
        {onRefresh && (
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={refreshing}
            className="h-6 w-6 p-0"
            aria-label="Refresh chat"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 min-h-0 -mx-1 px-1">
        <div className="flex flex-col gap-2 pr-1 pb-1">
          {messages.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">
              No messages yet. Viewer chat appears here in real time.
            </p>
          ) : (
            messages.map((m) => {
              const isSelf = m.sender_name.startsWith(senderName);
              const time = new Date(m.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              });
              return (
                <div
                  key={m.id}
                  className={`rounded-lg px-2.5 py-1.5 border text-sm ${
                    isSelf
                      ? "bg-primary/10 border-primary/25 ml-6"
                      : "bg-muted/40 border-border mr-6"
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-0.5 min-w-0">
                    <span
                      className={`text-[11px] font-semibold truncate max-w-[140px] shrink ${
                        isSelf ? "text-primary" : nameColor(m.sender_name)
                      }`}
                    >
                      {isSelf ? `${m.sender_name} (you)` : m.sender_name}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
                      {time}
                    </span>
                  </div>
                  <p className="text-[13px] text-foreground/90 leading-snug [overflow-wrap:anywhere]">
                    {m.message}
                  </p>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      <form onSubmit={send} className="shrink-0 pt-2 flex gap-2">
        <Input
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Send to viewers…"
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
