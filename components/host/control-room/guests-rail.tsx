"use client";

import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Users } from "lucide-react";

export interface GuestParticipant {
  id: string;
  slot_label: string;
  status: "invited" | "ready" | "live" | "offline";
  host_id: string;
  host?: { display_name: string | null; email: string };
}

/**
 * Guests rail. Lists invited co-hosts and a one-click join-link copy
 * per slot. Status badge reflects participant state from
 * stream_participants in real time.
 *
 * Live switching of which guest goes on-air remains in the Cameras
 * tab (DirectorPanel) — that's the production tool. This rail is the
 * presence list the host glances at to know who's available.
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
    <Card>
      <CardHeader className="pb-3 border-b">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <Users className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-sm font-semibold">Guests</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Co-hosts invited to this room.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-3">
        {participants.length === 0 ? (
          <p className="text-[11px] text-muted-foreground py-4 text-center">
            No guests yet. Invite co-hosts from the Cameras tab.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {participants.map((p) => {
              const display = p.host?.display_name || p.host?.email || "Unknown";
              const link = `${origin}/host/stream/${roomCode}/cohost/${p.id}`;
              return (
                <li
                  key={p.id}
                  className="rounded-md border border-border bg-card p-2 flex items-center gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate">{display}</span>
                      <Badge
                        variant={p.status === "live" ? "default" : "secondary"}
                        className={`text-[10px] h-4 px-1.5 ${
                          p.status === "live"
                            ? "bg-red-500 text-white"
                            : p.status === "ready"
                              ? "bg-green-500/20 text-green-700"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {p.status === "live" ? "● LIVE" : p.status}
                      </Badge>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{p.slot_label}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 shrink-0"
                    onClick={() => {
                      navigator.clipboard.writeText(link);
                      toast.success("Join link copied!");
                    }}
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
