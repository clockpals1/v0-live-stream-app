"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Copy, Users } from "lucide-react";
import { DeckHeader } from "@/components/host/control-room/deck-header";
import { SURFACE, TYPO } from "@/lib/control-room/styles";

export interface GuestParticipant {
  id: string;
  slot_label: string;
  status: "invited" | "ready" | "live" | "offline";
  host_id: string;
  host?: { display_name: string | null; email: string };
}

const STATUS_DOT: Record<GuestParticipant["status"], string> = {
  live: "bg-red-500 ring-red-500/30 animate-pulse",
  ready: "bg-emerald-500 ring-emerald-500/30",
  invited: "bg-amber-500 ring-amber-500/30",
  offline: "bg-muted-foreground/40 ring-border",
};

/**
 * Initials avatar — derives 1-2 chars from a display name. Matches the
 * style used elsewhere in the platform (subscriber lists, audience CRM).
 */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

/**
 * Guests rail. Co-hosts invited to this room with status dot and
 * one-click join-link copy per slot. Live switching of which guest
 * goes on-air remains in the Cameras tab (DirectorPanel) — this rail
 * is the at-a-glance presence list.
 */
export function GuestsRail({
  participants,
  roomCode,
}: {
  participants: GuestParticipant[];
  roomCode: string;
}) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <section className={`${SURFACE.panel} p-4`}>
      <DeckHeader
        icon={Users}
        title="Guests"
        description="Co-hosts invited to this room."
      />

      {participants.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-6 text-center">
          <p className={`${TYPO.sub} leading-relaxed`}>
            No guests yet. Invite co-hosts from the Cameras tab.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {participants.map((p) => {
            const display = p.host?.display_name || p.host?.email || "Unknown";
            const link = `${origin}/host/stream/${roomCode}/cohost/${p.id}`;
            return (
              <li
                key={p.id}
                className="rounded-lg ring-1 ring-border bg-background/60 hover:ring-foreground/20 transition-all p-2.5 flex items-center gap-2.5"
              >
                <div className="relative shrink-0">
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 ring-1 ring-primary/30 text-primary flex items-center justify-center text-[11px] font-semibold">
                    {initials(display)}
                  </div>
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-background ${STATUS_DOT[p.status]}`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-foreground truncate leading-tight">
                    {display}
                  </p>
                  <p className={`${TYPO.sub} truncate`}>
                    {p.slot_label}{" "}
                    <span className="capitalize text-foreground/60">· {p.status}</span>
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 px-0 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    navigator.clipboard.writeText(link);
                    toast.success("Join link copied!");
                  }}
                  title="Copy join link"
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
