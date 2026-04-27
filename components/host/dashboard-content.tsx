"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ScheduleStreamForm } from "@/components/host/schedule-stream-form";
import { StreamOperatorsDialog } from "@/components/admin/stream-operators-dialog";
import { OnboardingChecklist } from "@/components/host/onboarding-checklist";
import { CreatorWorkspaceStrip } from "@/components/host/creator-workspace-strip";
import { DashboardStatsRow } from "@/components/host/dashboard-stats-row";
import { RecentReplaysWidget } from "@/components/host/recent-replays-widget";
import { ThemeToggle } from "@/components/theme-toggle";
import type { EffectivePlan } from "@/lib/billing/entitlements";
import {
  Radio,
  Video,
  Users,
  Clock,
  LogOut,
  Copy,
  ExternalLink,
  Loader2,
  Download,
  Trash2,
  Share2,
  MoreVertical,
  Play,
  Square,
  AlertTriangle,
  Bell,
  X,
  CalendarClock,
  ShieldCheck,
  RefreshCw,
  Settings,
  Sparkles,
} from "lucide-react";
import { nanoid } from "nanoid";
import type { User } from "@supabase/supabase-js";
import { CAPS, resolveRole, ROLE_LABELS, type Role } from "@/lib/rbac";

interface Stream {
  id: string;
  room_code: string;
  title: string;
  status: "waiting" | "scheduled" | "live" | "ended";
  viewer_count: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  recording_url: string | null;
  scheduled_at: string | null;
  description: string | null;
  assigned_host_id: string | null;
}

interface CohostParticipant {
  id: string;
  slot_label: string;
  status: "invited" | "ready" | "live" | "offline";
  stream: {
    id: string;
    title: string;
    room_code: string;
    status: string;
  };
}

interface EmergencyMessage {
  id: string;
  stream_id: string;
  sender_name: string;
  message: string;
  created_at: string;
  is_resolved: boolean;
}

interface Host {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  /** Widened to string so the HostRow from bootstrap.ts (role?: string|null)
   *  is directly assignable without an explicit cast on the server side.
   *  resolveRole() narrows it back to Role inside the component. */
  role?: string | null;
  is_admin?: boolean | null;
  plan_slug?: string | null;
}

interface DashboardContentProps {
  user: User;
  host: Host | null;
  streams: Stream[];
  effectivePlan: EffectivePlan | null;
  /** Server-side prefetched operator assignments so the Super User banner
   *  renders on first paint without an async flash. The client-side
   *  realtime subscription will keep it updated thereafter. */
  initialOperatorStreams?: Array<{
    id: string;
    stream: { id: string; title: string; room_code: string; status: string };
  }>;
}

export function DashboardContent({
  user,
  host,
  streams: initialStreams,
  effectivePlan,
  initialOperatorStreams,
}: DashboardContentProps) {
  const router = useRouter();
  const [streams, setStreams] = useState<Stream[]>(initialStreams || []);
  const [loading, setLoading] = useState(false);
  const [newStreamTitle, setNewStreamTitle] = useState("");
  const [emergencyMessages, setEmergencyMessages] = useState<EmergencyMessage[]>([]);
  const [showEmergencyPanel, setShowEmergencyPanel] = useState(false);
  const [cohostParticipants, setCohostParticipants] = useState<CohostParticipant[]>([]);
  // Streams this user manages as a Super User (stream_operators row + joined stream).
  // Seeded from the server-side prefetch so the banner appears on first paint.
  const [operatorStreams, setOperatorStreams] = useState<Array<{
    id: string;
    stream: { id: string; title: string; room_code: string; status: string };
  }>>(initialOperatorStreams ?? []);
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  // Load streams where this host is a co-host participant
  useEffect(() => {
    if (!host) return;
    const load = async () => {
      const { data } = await supabase
        .from("stream_participants")
        .select("id, slot_label, status, stream:streams(id, title, room_code, status)")
        .eq("host_id", host.id)
        .neq("status", "offline");
      if (data) {
        const filtered = (data as any[]).filter((p) => p.stream && p.stream.status !== "ended");
        setCohostParticipants(filtered as CohostParticipant[]);
      }
    };
    load();
  }, [host]);

  // Load streams this host is assigned to as a Super-User operator
  useEffect(() => {
    if (!host) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("stream_operators")
          .select("id, stream:streams(id, title, room_code, status)")
          .eq("host_id", host.id);
        if (cancelled) return;
        if (error) {
          // 42P01: table missing (migration 016 not applied). Just show empty.
          if (error.code !== "42P01") console.warn("[dashboard] operator streams load failed:", error.message);
          setOperatorStreams([]);
          return;
        }
        const filtered = ((data as any[]) ?? []).filter(
          (r) => r.stream && r.stream.status !== "ended",
        );
        setOperatorStreams(filtered);
      } catch (err) {
        if (!cancelled) setOperatorStreams([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [host, supabase]);

  // Subscribe to emergency messages
  useEffect(() => {
    if (!host) return;

    const channel = supabase
      .channel('emergency-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `sender_name=like.SYSTEM%`,
        },
        (payload: any) => {
          const message = payload.new;
          if (message.message && message.message.includes('EMERGENCY:')) {
            const emergencyMsg: EmergencyMessage = {
              id: message.id,
              stream_id: message.stream_id,
              sender_name: message.sender_name,
              message: message.message,
              created_at: message.created_at,
              is_resolved: false,
            };
            
            setEmergencyMessages(prev => [emergencyMsg, ...prev]);
            
            // Show notification
            toast.error(`Emergency message from ${message.sender_name.replace('SYSTEM - ', '')}`, {
              duration: 10000,
              action: {
                label: 'View',
                onClick: () => setShowEmergencyPanel(true),
              },
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [host]);

  // Load streams from database
  useEffect(() => {
    if (!host) return;

    const loadStreams = async () => {
      try {
        // Try full query including assigned streams (requires migration 003)
        const { data, error } = await supabase
          .from("streams")
          .select("*")
          .or(`host_id.eq.${host.id},assigned_host_id.eq.${host.id}`)
          .order("created_at", { ascending: false });

        if (error) {
          // assigned_host_id column may not exist yet — fall back to simple query
          console.warn("Full query failed, falling back to host_id only:", error.message);
          const { data: fallback, error: fallbackErr } = await supabase
            .from("streams")
            .select("*")
            .eq("host_id", host.id)
            .order("created_at", { ascending: false });

          if (fallbackErr) {
            console.error("Fallback query also failed:", fallbackErr);
            // Both queries failed (likely RLS recursion) — keep server-side initialStreams
          } else {
            console.log("Loaded streams (fallback):", fallback?.length || 0);
            setStreams(fallback || []);
          }
        } else {
          console.log("Loaded streams:", data?.length || 0);
          setStreams(data || []);
        }
      } catch (err) {
        console.error("Exception loading streams:", err);
      } finally {
        setLoading(false);
      }
    };

    loadStreams();
  }, [host]);

  // Load existing emergency messages
  useEffect(() => {
    if (!host) return;

    const loadEmergencyMessages = async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('*')
        .like('sender_name', 'SYSTEM%')
        .like('message', 'EMERGENCY%')
        .order('created_at', { ascending: false })
        .limit(10);

      if (data) {
        const emergencyMsgs = data.map((msg: any) => ({
          id: msg.id,
          stream_id: msg.stream_id,
          sender_name: msg.sender_name,
          message: msg.message,
          created_at: msg.created_at,
          is_resolved: false,
        }));
        setEmergencyMessages(emergencyMsgs);
      }
    };

    loadEmergencyMessages();
  }, [host]);
  // Real-time: refresh co-host participant list on any participant row change
  useEffect(() => {
    if (!host) return;
    const refresh = async () => {
      const { data } = await supabase
        .from("stream_participants")
        .select("id, slot_label, status, stream:streams(id, title, room_code, status)")
        .eq("host_id", host.id)
        .neq("status", "offline");
      if (data) {
        const filtered = (data as any[]).filter((p) => p.stream && p.stream.status !== "ended");
        setCohostParticipants(filtered as CohostParticipant[]);
      }
    };
    const ch = supabase
      .channel(`cohost-rt-${host.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "stream_participants" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [host]);

  // Real-time: update own stream cards when stream status changes (e.g. goes live)
  useEffect(() => {
    if (!host) return;
    const ch = supabase
      .channel(`own-streams-rt-${host.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "streams" }, (payload: any) => {
        setStreams((prev) =>
          prev.map((s) => s.id === payload.new.id ? { ...s, ...payload.new } : s)
        );
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [host]);

  // Real-time: Super User assignments. When an admin/host assigns (or removes)
  // this user as an operator, the "Streams you manage" section updates
  // immediately — no reload needed, no hunting through lists.
  useEffect(() => {
    if (!host) return;
    const refreshOps = async () => {
      const { data, error } = await supabase
        .from("stream_operators")
        .select("id, stream:streams(id, title, room_code, status)")
        .eq("host_id", host.id);
      if (error) return; // table missing / permission — silent fallback
      const filtered = ((data as any[]) ?? []).filter(
        (r) => r.stream && r.stream.status !== "ended",
      );
      setOperatorStreams(filtered);
    };
    const ch = supabase
      .channel(`stream-ops-rt-${host.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stream_operators" },
        (payload: any) => {
          const row = payload.new ?? payload.old;
          if (!row || row.host_id !== host.id) return;

          if (payload.eventType === "INSERT") {
            // Fetch the stream name + room_code so the toast is actionable.
            supabase
              .from("streams")
              .select("title, room_code")
              .eq("id", row.stream_id)
              .single()
              .then(({ data: s }: { data: { title: string; room_code: string } | null }) => {
                const name = s?.title ?? "a stream";
                const code = s?.room_code;
                toast.success(`You've been added as Super User operator on "${name}"`, {
                  duration: 12000,
                  description: "You can now manage overlays, ticker, music, media and branding for this stream.",
                  action: code
                    ? {
                        label: "Open Control Room →",
                        onClick: () => {
                          window.location.href = `/host/stream/${code}`;
                        },
                      }
                    : undefined,
                });
              });
          } else if (payload.eventType === "DELETE") {
            toast.info("You have been removed as operator from a stream.", { duration: 6000 });
          }

          refreshOps();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [host, supabase]);

  const [deletingStream, setDeletingStream] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  // When non-null, the StreamOperatorsDialog at the bottom of the page opens
  // for this specific stream. Used by both the "Your Streams" dropdown and
  // the post-schedule auto-open flow.
  const [manageOperatorsFor, setManageOperatorsFor] = useState<
    { id: string; title: string } | null
  >(null);
  // When set, the dashboard will navigate to this room as soon as the
  // operator-assignment dialog closes — used by the "Go Live Now" flow to
  // offer operator assignment BEFORE entering the live stream page.
  const [pendingGoLiveRoom, setPendingGoLiveRoom] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);

  // Countdown re-render every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => forceUpdate(n => n + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const getCountdown = (scheduledAt: string): string => {
    const diff = new Date(scheduledAt).getTime() - Date.now();
    if (diff <= 0) return "Starting soon";
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (days > 0) return `In ${days}d ${hours}h`;
    if (hours > 0) return `In ${hours}h ${mins}m`;
    return `In ${mins} min${mins !== 1 ? "s" : ""}`;
  };

  const handleCreateStream = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!host) return;

    // Role guard — mirrors RLS. Cohost-only users cannot create their own streams.
    if (!CAPS.createOwnStreams(resolveRole(host))) {
      toast.error("Your role doesn't allow creating streams. Ask an admin.");
      return;
    }

    setLoading(true);
    const roomCode = nanoid(8);

    const { data, error } = await supabase
      .from("streams")
      .insert({
        host_id: host.id,
        room_code: roomCode,
        title: newStreamTitle || "Live Stream",
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating stream:", error);
      setLoading(false);
      return;
    }

    // Reset form and loading state
    setNewStreamTitle("");
    setLoading(false);

    // Before navigating, give the host a chance to attach Super Users.
    // Closing the dialog (skip or confirm) triggers the navigation below.
    setPendingGoLiveRoom(data.room_code);
    setManageOperatorsFor({ id: data.id, title: data.title });
    toast.info("Assign Super Users — or close this dialog to go live immediately.", {
      duration: 5000,
    });
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const copyShareLink = (roomCode: string) => {
    const link = `${window.location.origin}/watch/${roomCode}`;
    navigator.clipboard.writeText(link);
    setCopiedCode(roomCode);
    toast.success("Share link copied to clipboard!");
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleDeleteStream = async (streamId: string) => {
    setDeletingStream(streamId);
    
    try {
      const { error } = await supabase
        .from("streams")
        .delete()
        .eq("id", streamId);

      if (error) {
        console.error("Error deleting stream:", error);
        toast.error("Failed to delete stream");
      } else {
        toast.success("Stream deleted successfully");
        router.refresh();
      }
    } catch (err) {
      console.error("Error deleting stream:", err);
      toast.error("Failed to delete stream");
    } finally {
      setDeletingStream(null);
    }
  };

  const handleDownloadRecording = async (stream: Stream) => {
    if (!stream.recording_url) {
      toast.error("No recording available for this stream");
      return;
    }

    try {
      const response = await fetch(stream.recording_url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `${stream.title.replace(/\s+/g, '_')}_recording.webm`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success("Recording downloaded successfully");
    } catch (err) {
      console.error("Error downloading recording:", err);
      toast.error("Failed to download recording");
    }
  };

  const shareStream = async (stream: Stream) => {
    const shareData = {
      title: stream.title,
      text: `Join my live stream: ${stream.title}`,
      url: `${window.location.origin}/watch/${stream.room_code}`
    };

    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        toast.success("Stream shared successfully");
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          copyShareLink(stream.room_code);
        }
      }
    } else {
      copyShareLink(stream.room_code);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "live":
        return <Badge className="bg-red-500 text-white">Live</Badge>;
      case "ended":
        return <Badge variant="secondary">Ended</Badge>;
      case "scheduled":
        return <Badge className="bg-blue-500 text-white gap-1"><CalendarClock className="w-3 h-3" />Scheduled</Badge>;
      default:
        return <Badge variant="outline">Waiting</Badge>;
    }
  };

  if (!host) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border/60 bg-background/95 backdrop-blur">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Radio className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-bold">Isunday Live</span>
            </Link>
            <div className="flex items-center gap-1">
              <ThemeToggle size="sm" />
              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                <LogOut className="w-4 h-4" />
                <span className="sr-only">Sign Out</span>
              </Button>
            </div>
          </div>
        </header>
        <main className="container mx-auto px-4 py-16">
          <Card className="max-w-md mx-auto">
            <CardHeader className="text-center">
              <CardTitle>Host Access Required</CardTitle>
              <CardDescription>
                Your account ({user.email}) is not yet registered as a host.
                Please contact an administrator to get host access.
              </CardDescription>
            </CardHeader>
          </Card>
        </main>
      </div>
    );
  }

  const role = resolveRole(host);
  const canCreateStreams = CAPS.createOwnStreams(role);
  const canAccessAdmin = CAPS.accessAdminPanel(role)
    || effectivePlan?.isPlatformAdmin === true;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  const liveOwned = streams.filter(s => s.status === "live");
  const liveCohost = cohostParticipants.filter(p => p.stream.status === "live");
  const isAnyLive = liveOwned.length > 0 || liveCohost.length > 0;
  const scheduledStreams = streams
    .filter(s => s.status === "scheduled")
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  const pastStreams = streams.filter(s => s.status !== "scheduled" && s.status !== "live");

  return (
    <div className="min-h-screen bg-background">

      {/* ─── Slim header ────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 py-2.5 flex items-center justify-between gap-3">

          {/* Brand */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 bg-primary rounded-md flex items-center justify-center">
              <Radio className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <span className="font-bold text-sm hidden sm:block">Isunday Live</span>
          </Link>

          {/* Nav actions */}
          <div className="flex items-center gap-0.5 ml-auto">
            {/* Role badge */}
            <Badge
              variant="secondary"
              className={`mr-2 hidden sm:flex text-[10px] gap-1 ${
                role === "admin" ? "bg-primary/10 text-primary border-primary/20"
                : role === "cohost" ? "bg-purple-500/10 text-purple-600 border-purple-500/20"
                : role === "super_user" ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                : ""
              }`}
            >
              {(role === "admin" || role === "super_user") && <ShieldCheck className="w-2.5 h-2.5" />}
              {role === "cohost" && <Users className="w-2.5 h-2.5" />}
              {ROLE_LABELS[role]}
            </Badge>

            {canAccessAdmin && (
              <Button variant="ghost" size="sm" asChild className="h-8 px-2.5">
                <Link href="/admin">
                  <ShieldCheck className="w-4 h-4" />
                  <span className="ml-1.5 hidden md:inline text-xs">Admin</span>
                </Link>
              </Button>
            )}

            {canCreateStreams && (
              <Button variant="ghost" size="sm" asChild className="h-8 px-2.5">
                <Link href="/host/settings">
                  <Settings className="w-4 h-4" />
                  <span className="ml-1.5 hidden md:inline text-xs">Settings</span>
                </Link>
              </Button>
            )}

            {canCreateStreams && (
              <Button variant="ghost" size="sm" asChild className="h-8 px-2.5">
                <a href="https://studio.isunday.me">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <span className="ml-1.5 hidden md:inline text-xs">Studio</span>
                </a>
              </Button>
            )}

            {/* Emergency bell */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowEmergencyPanel(true)}
              className="relative h-8 px-2.5"
            >
              <Bell className="w-4 h-4" />
              {emergencyMessages.length > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
              )}
            </Button>

            <span className="hidden lg:block text-xs text-muted-foreground px-2 border-l border-border ml-1">
              {host.display_name || user.email}
            </span>

            <ThemeToggle size="sm" />

            <Button variant="ghost" size="sm" onClick={handleSignOut} className="h-8 px-2.5">
              <LogOut className="w-4 h-4" />
              <span className="sr-only">Sign Out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-6xl space-y-6">

        {/* ─── Greeting ───────────────────────────────────────────── */}
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {greeting}, {host.display_name?.split(" ")[0] || "creator"}.
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </p>
          </div>
          {effectivePlan?.plan && (
            <div className="shrink-0 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-[11px] font-medium text-primary">
              {effectivePlan.isPlatformAdmin ? "Admin" : effectivePlan.plan.name}
            </div>
          )}
        </div>

        {/* ─── Onboarding checklist ───────────────────────────────── */}
        {canCreateStreams && (
          <OnboardingChecklist
            userId={user.id}
            displayName={host.display_name}
            streamCount={streams.length}
            planSlug={host.plan_slug ?? null}
          />
        )}

        {/* ─── Quick stats ────────────────────────────────────────── */}
        {canCreateStreams && <DashboardStatsRow />}

        {/* ─── LIVE NOW banner ────────────────────────────────────── */}
        {isAnyLive && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
              <h2 className="font-semibold text-base">Live Right Now</h2>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {liveOwned.map((s) => (
                <Card key={s.id} className="border-red-400/40 bg-red-500/5">
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse shrink-0" />
                        <span className="font-medium text-sm truncate">{s.title}</span>
                        <Badge className="bg-red-500 text-white text-[10px] h-4 px-1.5 shrink-0">LIVE</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Users className="w-3 h-3" />{s.viewer_count} viewers
                      </span>
                    </div>
                    <Button asChild size="sm" className="bg-red-600 hover:bg-red-700 text-white shrink-0 h-8">
                      <Link href={`/host/stream/${s.room_code}`}>
                        <Radio className="w-3.5 h-3.5 mr-1" />Manage
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
              {liveCohost.map((p) => (
                <Card key={p.id} className="border-purple-400/40 bg-purple-500/5">
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse shrink-0" />
                        <span className="font-medium text-sm truncate">{p.stream.title}</span>
                        <Badge className="bg-red-500 text-white text-[10px] h-4 px-1.5 shrink-0">LIVE</Badge>
                      </div>
                      <span className="text-xs text-purple-600">Co-Host · {p.slot_label}</span>
                    </div>
                    <Button asChild size="sm" className="bg-purple-600 hover:bg-purple-700 text-white shrink-0 h-8">
                      <Link href={`/host/stream/${p.stream.room_code}/cohost/${p.id}`}>
                        <Video className="w-3.5 h-3.5 mr-1" />Manage
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ─── Operator assignment banner ─────────────────────────── */}
        {operatorStreams.length > 0 && (
          <Card className="border-amber-400/40 bg-amber-500/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 bg-amber-500 rounded-full flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold flex items-center gap-2 flex-wrap">
                    Super User — {operatorStreams.length} stream{operatorStreams.length !== 1 ? "s" : ""} assigned
                    {operatorStreams.some(p => p.stream.status === "live") && (
                      <Badge className="bg-red-500 text-white text-[10px] h-4 px-1.5 animate-pulse">● LIVE</Badge>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {operatorStreams.map((op) => (
                      <Button key={op.id} asChild size="sm" variant="outline"
                        className={`h-7 text-xs gap-1.5 ${op.stream.status === "live" ? "border-red-300" : "border-amber-300"}`}>
                        <Link href={`/host/stream/${op.stream.room_code}`}>
                          <Radio className={`w-3 h-3 ${op.stream.status === "live" ? "text-red-500 animate-pulse" : "text-amber-500"}`} />
                          {op.stream.title}
                        </Link>
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── Co-host invitations banner ─────────────────────────── */}
        {cohostParticipants.filter(p => p.stream.status !== "live" && (p.status === "invited" || p.status === "ready")).length > 0 && (
          <Card className="border-purple-400/40 bg-purple-500/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 bg-purple-500 rounded-full flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">
                    Co-host invitations pending
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {cohostParticipants.filter(p => p.stream.status !== "live").map((p) => (
                      <Button key={p.id} asChild size="sm" variant="outline"
                        className="h-7 text-xs gap-1.5 border-purple-300">
                        <Link href={`/host/stream/${p.stream.room_code}/cohost/${p.id}`}>
                          <Video className="w-3 h-3 text-purple-500" />
                          {p.stream.title}
                          <Badge variant="outline" className="ml-1 text-[9px] h-3.5 px-1">
                            {p.status === "ready" ? "Ready" : "Invited"}
                          </Badge>
                        </Link>
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── GO LIVE hero card ───────────────────────────────────── */}
        {canCreateStreams && (
          <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-primary/3 to-transparent">
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <Radio className="w-4 h-4 text-primary" />
                <h2 className="font-semibold">Start streaming</h2>
              </div>
              <form onSubmit={handleCreateStream} className="flex flex-col sm:flex-row gap-3">
                <Input
                  placeholder="What's your stream title? (optional)"
                  value={newStreamTitle}
                  onChange={(e) => setNewStreamTitle(e.target.value)}
                  className="flex-1 bg-background"
                />
                <Button type="submit" disabled={loading} className="shrink-0 gap-2 sm:w-auto w-full">
                  {loading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />Creating…</>
                  ) : (
                    <><Radio className="w-4 h-4" />Go Live Now</>
                  )}
                </Button>
              </form>
              <div className="mt-3 flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowScheduleDialog(true)}
                >
                  <CalendarClock className="w-3.5 h-3.5 mr-1.5" />
                  Schedule for later
                </Button>
                <span className="text-xs text-muted-foreground hidden sm:block">
                  Title is optional — you can update it from the control room
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── Role card for non-creators ─────────────────────────── */}
        {!canCreateStreams && role === "super_user" && (
          <Card className="border-amber-400/40 bg-amber-500/5">
            <CardContent className="p-5 flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-sm">Operator access</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  You can manage overlays, ticker, music, and branding for streams you're assigned to. Stream creation is reserved for admins.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        {!canCreateStreams && role === "cohost" && (
          <Card className="border-purple-400/40 bg-purple-500/5">
            <CardContent className="p-5 flex items-start gap-3">
              <Users className="w-5 h-5 text-purple-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-sm">Co-host access</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Join streams you&apos;ve been invited to above. Ask an admin to upgrade your access if you need to create streams.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── Main content grid ───────────────────────────────────── */}
        <div className="grid lg:grid-cols-3 gap-6">

          {/* Left / main column */}
          <div className="lg:col-span-2 space-y-6">

            {/* Scheduled streams */}
            {scheduledStreams.length > 0 && (
              <div>
                <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
                  <CalendarClock className="w-4 h-4 text-blue-500" />
                  Upcoming
                  <Badge variant="outline" className="ml-1 text-[10px]">{scheduledStreams.length}</Badge>
                </h2>
                <div className="space-y-2">
                  {scheduledStreams.map((stream) => (
                    <Card key={stream.id} className="border-blue-400/30 bg-blue-500/5">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-sm truncate">{stream.title}</span>
                              {getStatusBadge(stream.status)}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              <span className="text-blue-600 font-medium">
                                {stream.scheduled_at ? getCountdown(stream.scheduled_at) : ""}
                              </span>
                              <span>
                                {stream.scheduled_at ? new Date(stream.scheduled_at).toLocaleString(undefined, {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}) : ""}
                              </span>
                              <span className="font-mono bg-muted px-1.5 py-0.5 rounded">{stream.room_code}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button asChild size="sm" className="h-8">
                              <Link href={`/host/stream/${stream.room_code}`}>
                                <Play className="w-3.5 h-3.5 mr-1" />Start
                              </Link>
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0"
                              onClick={() => setManageOperatorsFor({ id: stream.id, title: stream.title })}
                              title="Manage operators">
                              <ShieldCheck className="w-3.5 h-3.5 text-amber-500" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0"
                              onClick={() => copyShareLink(stream.room_code)} title="Copy link">
                              <Copy className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Stream history */}
            <div>
              <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
                <Video className="w-4 h-4 text-muted-foreground" />
                Stream History
                {pastStreams.length > 0 && (
                  <Badge variant="outline" className="ml-1 text-[10px]">{pastStreams.length}</Badge>
                )}
              </h2>

              {streams.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-12 text-center">
                    <Radio className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                    <p className="text-sm font-medium text-muted-foreground">No streams yet</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Use the card above to go live — it only takes a second.
                    </p>
                  </CardContent>
                </Card>
              ) : pastStreams.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center">
                    <Radio className="w-7 h-7 text-red-400 mx-auto mb-2 animate-pulse" />
                    <p className="text-sm text-muted-foreground">
                      All your streams are live — check <span className="text-red-500 font-medium">Live Right Now</span> above.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {pastStreams.map((stream) => (
                    <Card key={stream.id} className="group hover:border-border/80 transition-colors">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-sm truncate">{stream.title}</span>
                              {getStatusBadge(stream.status)}
                              {stream.recording_url && (
                                <Badge variant="outline" className="text-[10px] h-4 px-1">
                                  <Download className="w-2.5 h-2.5 mr-0.5" />Rec
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Users className="w-3 h-3" />{stream.viewer_count}
                              </span>
                              <span>{new Date(stream.created_at).toLocaleDateString(undefined, {month:"short",day:"numeric",year:"numeric"})}</span>
                              <span className="font-mono bg-muted px-1.5 py-0.5 rounded hidden sm:inline">{stream.room_code}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button asChild size="sm" className="h-8">
                              <Link href={`/host/stream/${stream.room_code}`}>
                                {stream.status === "ended" ? (
                                  <><RefreshCw className="w-3.5 h-3.5 mr-1" />Go Live Again</>
                                ) : (
                                  <><Play className="w-3.5 h-3.5 mr-1" />Start</>
                                )}
                              </Link>
                            </Button>
                            {stream.status === "ended" && (
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0"
                                onClick={() => copyShareLink(stream.room_code)} title="Copy link">
                                <Copy className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                  <MoreVertical className="w-3.5 h-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem onClick={() => shareStream(stream)}>
                                  <Share2 className="w-3.5 h-3.5 mr-2" />Share stream
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => copyShareLink(stream.room_code)}>
                                  <Copy className="w-3.5 h-3.5 mr-2" />Copy link
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem asChild>
                                  <Link href={`/host/streams/${stream.id}/summary`}>
                                    <ExternalLink className="w-3.5 h-3.5 mr-2" />View summary
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setManageOperatorsFor({ id: stream.id, title: stream.title })}>
                                  <ShieldCheck className="w-3.5 h-3.5 mr-2 text-amber-500" />Manage operators
                                </DropdownMenuItem>
                                {stream.recording_url && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => handleDownloadRecording(stream)}>
                                      <Download className="w-3.5 h-3.5 mr-2" />Download recording
                                    </DropdownMenuItem>
                                  </>
                                )}
                                <DropdownMenuSeparator />
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={e => e.preventDefault()}>
                                      <Trash2 className="w-3.5 h-3.5 mr-2" />Delete stream
                                    </DropdownMenuItem>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete stream?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        &ldquo;{stream.title}&rdquo; will be permanently deleted. This cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => handleDeleteStream(stream.id)}
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      >
                                        {deletingStream === stream.id ? (
                                          <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Deleting…</>
                                        ) : "Delete"}
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ─── Right sidebar ──────────────────────────────────────── */}
          <div className="space-y-4">
            {/* Creator Workspace modules */}
            {canCreateStreams && (
              <CreatorWorkspaceStrip
                plan={effectivePlan?.plan ?? null}
                isPlatformAdmin={effectivePlan?.isPlatformAdmin ?? false}
              />
            )}
            {/* Recent Replays */}
            {canCreateStreams && <RecentReplaysWidget />}
          </div>
        </div>

      </main>

      {/* ─── Schedule dialog ────────────────────────────────────────── */}
      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-blue-500" />
              Schedule a stream
            </DialogTitle>
          </DialogHeader>
          {host && (
            <ScheduleStreamForm
              currentHostId={host.id}
              onScheduled={(newStream) => {
                if (host) {
                  supabase
                    .from("streams")
                    .select("*")
                    .eq("host_id", host.id)
                    .order("created_at", { ascending: false })
                    .then(({ data }: { data: Stream[] | null }) => { if (data) setStreams(data); });
                }
                setShowScheduleDialog(false);
                if (newStream) setManageOperatorsFor(newStream);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Emergency dialog ───────────────────────────────────────── */}
      <AlertDialog open={showEmergencyPanel} onOpenChange={setShowEmergencyPanel}>
        <AlertDialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              Emergency messages
              {emergencyMessages.length > 0 && (
                <Badge className="bg-red-500 text-white ml-1">{emergencyMessages.length}</Badge>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>Viewer-reported issues and alerts from your streams.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-3">
            {emergencyMessages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <AlertTriangle className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No emergency messages — all clear.</p>
              </div>
            ) : (
              emergencyMessages.map((msg) => (
                <Card key={msg.id} className="border-red-200 bg-red-50 dark:bg-red-950/20">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className="bg-red-500 text-white text-[10px]">Emergency</Badge>
                          <span className="text-xs text-muted-foreground truncate">
                            {msg.sender_name.replace("SYSTEM - ", "")} · {new Date(msg.created_at).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-sm">{msg.message.replace("EMERGENCY: ", "")}</p>
                        {msg.stream_id && (
                          <Button variant="outline" size="sm" className="mt-2 h-7 text-xs"
                            onClick={() => router.push(`/host/stream/${msg.stream_id}`)}>
                            Go to stream
                          </Button>
                        )}
                      </div>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0"
                        onClick={() => setEmergencyMessages(prev => prev.filter(m => m.id !== msg.id))}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowEmergencyPanel(false)}>Close</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Operator-assignment dialog ─────────────────────────────── */}
      {manageOperatorsFor && (
        <StreamOperatorsDialog
          streamId={manageOperatorsFor.id}
          streamTitle={manageOperatorsFor.title}
          open={!!manageOperatorsFor}
          onOpenChange={(next) => {
            if (!next) {
              setManageOperatorsFor(null);
              if (pendingGoLiveRoom) {
                const room = pendingGoLiveRoom;
                setPendingGoLiveRoom(null);
                router.push(`/host/stream/${room}`);
              }
            }
          }}
          trigger={null}
        />
      )}
    </div>
  );
}
