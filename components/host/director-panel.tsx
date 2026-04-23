"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useWarmCohostPool } from "@/lib/webrtc/use-warm-cohost-pool";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Camera, Plus, Radio, Trash2, Copy, Users, Wifi, WifiOff, Circle } from "lucide-react";

interface Participant {
  id: string;
  stream_id: string;
  host_id: string;
  slot_label: string;
  status: "invited" | "ready" | "live" | "offline";
  joined_at: string | null;
  host?: { id: string; display_name: string | null; email: string };
}

interface Host {
  id: string;
  display_name: string | null;
  email: string;
}

interface DirectorPanelProps {
  streamId: string;
  roomCode: string;
  activeParticipantId: string | null;
  /** participantId=null means switch back to main host camera */
  onSwitch: (participantId: string | null, warmStream: MediaStream | null) => void;
}

const STATUS_COLORS: Record<string, string> = {
  invited: "bg-yellow-500",
  ready:   "bg-blue-500",
  live:    "bg-red-500",
  offline: "bg-gray-400",
};

const STATUS_LABELS: Record<string, string> = {
  invited: "Invited",
  ready:   "Camera Ready",
  live:    "Broadcasting",
  offline: "Offline",
};

export function DirectorPanel({ streamId, roomCode, activeParticipantId, onSwitch }: DirectorPanelProps) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [allHosts, setAllHosts] = useState<Host[]>([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedHostId, setSelectedHostId] = useState("");
  const [slotLabel, setSlotLabel] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  // Pre-warm receiver connections for all ready/live co-hosts so that
  // replaceTrack() fires with a zero-lag already-flowing MediaStream.
  const warmIds = useMemo(
    () => participants.filter((p) => p.status === "ready" || p.status === "live").map((p) => p.id),
    [participants]
  );
  const warmPool = useWarmCohostPool(warmIds);

  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  // Load participants
  const loadParticipants = async () => {
    const res = await fetch(`/api/streams/participants/${streamId}`);
    if (res.ok) {
      const { participants: data } = await res.json();
      setParticipants(data || []);
    }
  };

  // Load all registered hosts (for the add dialog)
  const loadHosts = async () => {
    const { data } = await supabase
      .from("hosts")
      .select("id, display_name, email")
      .order("display_name", { ascending: true });
    setAllHosts(data || []);
  };

  useEffect(() => {
    loadParticipants();
    loadHosts();
  }, [streamId]);

  // Real-time participant status via Broadcast (no Postgres publication needed)
  useEffect(() => {
    const channel = supabase
      .channel(`stream-cams-${streamId}`)
      .on("broadcast", { event: "participant-status" }, ({ payload }: { payload: any }) => {
        const { participantId, status } = payload as { participantId: string; status: string };
        setParticipants((prev) =>
          prev.map((p) => (p.id === participantId ? { ...p, status: status as Participant["status"] } : p))
        );
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [streamId]);

  // Fallback: Postgres Changes (works only if stream_participants is in realtime publication)
  useEffect(() => {
    const channel = supabase
      .channel(`participants-pg-${streamId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stream_participants", filter: `stream_id=eq.${streamId}` },
        () => { loadParticipants(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [streamId]);

  // Add a co-host to the stream
  const handleAddParticipant = async () => {
    if (!selectedHostId) return;
    setIsAdding(true);
    try {
      const res = await fetch(`/api/streams/participants/${streamId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_id: selectedHostId, slot_label: slotLabel || "Camera" }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        toast.error(error || "Failed to add co-host");
      } else {
        toast.success("Co-host added successfully");
        setAddDialogOpen(false);
        setSelectedHostId("");
        setSlotLabel("");
        await loadParticipants();
      }
    } finally {
      setIsAdding(false);
    }
  };

  // Remove a co-host
  const handleRemove = async (participantId: string) => {
    const res = await fetch(`/api/streams/participants/${streamId}/${participantId}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Co-host removed");
      setParticipants((prev) => prev.filter((p) => p.id !== participantId));
      if (activeParticipantId === participantId) onSwitch(null, null);
    } else {
      toast.error("Failed to remove co-host");
    }
  };

  // Switch active camera — relay fires immediately using the pre-warmed stream.
  const handleSwitch = async (participantId: string | null) => {
    // Fire relay instantly so viewers see the switch before the API round-trip.
    const warmStream = participantId ? (warmPool.get(participantId) ?? null) : null;
    onSwitch(participantId, warmStream);

    setIsSwitching(true);
    try {
      const res = await fetch(`/api/streams/participants/switch/${streamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Unknown error" }));
        toast.error(error || "Failed to switch camera");
      } else {
        const label = participantId
          ? (participants.find((p) => p.id === participantId)?.slot_label || "Co-host")
          : "Main Camera";
        toast.success(`Switched to ${label}`);
      }
    } catch {
      toast.error("Network error — could not switch camera");
    } finally {
      setIsSwitching(false);
    }
  };

  // Generate co-host broadcast link
  const getCohostLink = (participantId: string) =>
    `${window.location.origin}/host/stream/${roomCode}/cohost/${participantId}`;

  const copyLink = (participantId: string) => {
    navigator.clipboard.writeText(getCohostLink(participantId));
    toast.success("Link copied — share with co-host");
  };

  const availableHosts = allHosts.filter(
    (h) => !participants.some((p) => p.host_id === h.id)
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Cameras</span>
          {participants.length > 0 && (
            <Badge variant="secondary" className="text-xs">{participants.length}</Badge>
          )}
        </div>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
              <Plus className="w-3 h-3" /> Add Co-Host
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Co-Host Camera</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <Label className="text-xs mb-1 block">Select Host</Label>
                <select
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                  value={selectedHostId}
                  onChange={(e) => setSelectedHostId(e.target.value)}
                >
                  <option value="">Choose a registered host…</option>
                  {availableHosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.display_name || h.email}
                    </option>
                  ))}
                </select>
                {availableHosts.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    All registered hosts are already added. Add more hosts in Admin → Host Management.
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs mb-1 block">Camera Label (optional)</Label>
                <Input
                  placeholder="e.g. Stage Camera, Field Reporter"
                  value={slotLabel}
                  onChange={(e) => setSlotLabel(e.target.value)}
                  className="text-sm"
                />
              </div>
              <Button onClick={handleAddParticipant} disabled={!selectedHostId || isAdding} className="w-full">
                {isAdding ? "Adding…" : "Add Co-Host"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {/* Main camera card (always shown) */}
          <Card className={`border-2 transition-colors ${!activeParticipantId ? "border-primary" : "border-transparent"}`}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Radio className="w-3.5 h-3.5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">Main Camera</p>
                    <p className="text-xs text-muted-foreground truncate">Your device</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!activeParticipantId ? (
                    <Badge className="bg-red-500 text-white text-xs animate-pulse">LIVE</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs"
                      disabled={isSwitching}
                      onClick={() => handleSwitch(null)}
                    >
                      Go Live
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Co-host participant cards */}
          {participants.map((p) => {
            const isActive = activeParticipantId === p.id;
            const canGoLive = p.status === "ready" || p.status === "live";

            return (
              <Card key={p.id} className={`border-2 transition-colors ${isActive ? "border-primary" : "border-transparent"}`}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[p.status]}`} />
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{p.slot_label}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {p.host?.display_name || p.host?.email || "Unknown"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="secondary" className="text-xs hidden sm:flex">
                        {STATUS_LABELS[p.status]}
                      </Badge>
                      {isActive ? (
                        <Badge className="bg-red-500 text-white text-xs animate-pulse">LIVE</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant={canGoLive ? "default" : "outline"}
                          className="h-6 text-xs"
                          disabled={!canGoLive || isSwitching}
                          onClick={() => handleSwitch(p.id)}
                          title={!canGoLive ? "Waiting for co-host to start broadcasting…" : "Switch viewers to this feed"}
                        >
                          {canGoLive ? <><Circle className="w-2.5 h-2.5 fill-red-500 mr-1" />Go Live</> : "Waiting…"}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Invite link + remove */}
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground flex-1"
                      onClick={() => copyLink(p.id)}
                    >
                      <Copy className="w-3 h-3" /> Copy Invite Link
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove co-host?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {p.host?.display_name || p.host?.email} will be removed from this stream.
                            If they are currently live, viewers will be switched back to the main camera.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleRemove(p.id)}>Remove</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {participants.length === 0 && (
            <div className="py-6 text-center text-xs text-muted-foreground space-y-1">
              <Users className="w-6 h-6 mx-auto mb-2 opacity-40" />
              <p className="font-medium text-foreground/70">No co-hosts added yet</p>
              <p>Click &quot;+ Add Co-Host&quot; above to invite a second camera.</p>
              <p className="text-[11px] pt-1">
                Co-hosts must first be registered in{" "}
                <a href="/admin" target="_blank" className="underline text-primary">Admin → Host Management</a>.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
