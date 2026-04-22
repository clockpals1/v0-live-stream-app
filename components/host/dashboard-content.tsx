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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ScheduleStreamForm } from "@/components/host/schedule-stream-form";
import {
  Radio,
  Video,
  Users,
  Clock,
  LogOut,
  Plus,
  Copy,
  ExternalLink,
  Loader2,
  Download,
  Trash2,
  Share2,
  MoreVertical,
  Eye,
  EyeOff,
  Pause,
  Play,
  Square,
  AlertTriangle,
  X,
  CalendarClock,
  MapPin,
} from "lucide-react";
import { nanoid } from "nanoid";
import type { User } from "@supabase/supabase-js";

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
}

interface DashboardContentProps {
  user: User;
  host: Host | null;
  streams: Stream[];
}

export function DashboardContent({ user, host, streams: initialStreams }: DashboardContentProps) {
  const router = useRouter();
  const [streams, setStreams] = useState<Stream[]>(initialStreams || []);
  const [loading, setLoading] = useState(false);
  const [newStreamTitle, setNewStreamTitle] = useState("");
  const [emergencyMessages, setEmergencyMessages] = useState<EmergencyMessage[]>([]);
  const [showEmergencyPanel, setShowEmergencyPanel] = useState(false);
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

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
  const [deletingStream, setDeletingStream] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
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
    
    // Navigate to stream
    router.push(`/host/stream/${data.room_code}`);
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
        <header className="border-b border-border">
          <div className="container mx-auto px-4 py-4 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Radio className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-bold text-foreground">Isunday Stream Live</span>
            </Link>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </header>
        <main className="container mx-auto px-4 py-12">
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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Radio className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground">Isunday Stream Live</span>
          </Link>
          <div className="flex items-center gap-4">
            {/* Emergency Notification Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowEmergencyPanel(true)}
              className="relative"
            >
              <AlertTriangle className="w-4 h-4 mr-2" />
              Emergency
              {emergencyMessages.length > 0 && (
                <Badge className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center p-0">
                  {emergencyMessages.length}
                </Badge>
              )}
            </Button>
            <span className="text-sm text-muted-foreground">
              {host.display_name || user.email}
            </span>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Create / Schedule Stream Card */}
          <Card className="lg:col-span-1">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Plus className="w-5 h-5" />
                New Stream
              </CardTitle>
              <CardDescription>
                Go live instantly or schedule for later
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="instant">
                <TabsList className="w-full mb-4">
                  <TabsTrigger value="instant" className="flex-1">
                    <Video className="w-3.5 h-3.5 mr-1.5" />
                    Instant
                  </TabsTrigger>
                  <TabsTrigger value="schedule" className="flex-1">
                    <CalendarClock className="w-3.5 h-3.5 mr-1.5" />
                    Schedule
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="instant">
                  <form onSubmit={handleCreateStream} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="title">Stream Title</Label>
                      <Input
                        id="title"
                        placeholder="My Live Event"
                        value={newStreamTitle}
                        onChange={(e) => setNewStreamTitle(e.target.value)}
                      />
                    </div>
                    <Button type="submit" disabled={loading} className="w-full">
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Video className="w-4 h-4 mr-2" />
                          Go Live Now
                        </>
                      )}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="schedule">
                  {host && (
                    <ScheduleStreamForm
                      currentHostId={host.id}
                      onScheduled={() => {
                        if (host) {
                          supabase
                            .from("streams")
                            .select("*")
                            .eq("host_id", host.id)
                            .order("created_at", { ascending: false })
                            .then(({ data }: { data: Stream[] | null }) => { if (data) setStreams(data); });
                        }
                      }}
                    />
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Streams List */}
          <div className="lg:col-span-2 flex flex-col gap-6">

            {/* Upcoming Scheduled Streams */}
            {streams.filter(s => s.status === "scheduled").length > 0 && (
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-3 flex items-center gap-2">
                  <CalendarClock className="w-5 h-5 text-blue-500" />
                  Upcoming Scheduled
                </h2>
                <div className="grid gap-3">
                  {streams
                    .filter(s => s.status === "scheduled")
                    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())
                    .map((stream) => (
                      <Card key={stream.id} className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-semibold text-foreground truncate">{stream.title}</h3>
                                {getStatusBadge(stream.status)}
                              </div>
                              {stream.description && (
                                <p className="text-sm text-muted-foreground mb-2 line-clamp-1">{stream.description}</p>
                              )}
                              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                                <span className="flex items-center gap-1 font-medium text-blue-600">
                                  <Clock className="w-3.5 h-3.5" />
                                  {stream.scheduled_at ? getCountdown(stream.scheduled_at) : ""}
                                </span>
                                <span className="flex items-center gap-1">
                                  <CalendarClock className="w-3.5 h-3.5" />
                                  {stream.scheduled_at ? new Date(stream.scheduled_at).toLocaleString() : ""}
                                </span>
                                <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                                  {stream.room_code}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Button asChild size="sm">
                                <Link href={`/host/stream/${stream.room_code}`}>
                                  <Play className="w-4 h-4 mr-1" />
                                  Start
                                </Link>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copyShareLink(stream.room_code)}
                                title="Copy viewer link"
                              >
                                <Copy className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              </div>
            )}

            <div>
              <h2 className="text-xl font-semibold text-foreground mb-4">Your Streams</h2>
            {streams.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Video className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    No streams yet. Create your first stream to get started!
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {streams.filter(s => s.status !== "scheduled").map((stream) => (
                  <Card key={stream.id} className="group hover:shadow-md transition-shadow duration-200">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-3">
                            <div className="flex items-center gap-2">
                              {stream.status === "live" && (
                                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                              )}
                              <h3 className="font-semibold text-foreground text-lg truncate">
                                {stream.title}
                              </h3>
                            </div>
                            {getStatusBadge(stream.status)}
                          </div>
                          
                          <div className="flex items-center gap-6 text-sm text-muted-foreground mb-3">
                            <span className="flex items-center gap-2">
                              <Users className="w-4 h-4" />
                              <span className="font-medium">{stream.viewer_count}</span>
                              <span>viewers</span>
                            </span>
                            <span className="flex items-center gap-2">
                              <Clock className="w-4 h-4" />
                              <span>{new Date(stream.created_at).toLocaleDateString()}</span>
                            </span>
                            {stream.started_at && (
                              <span className="flex items-center gap-2">
                                <Play className="w-4 h-4" />
                                <span>Started {new Date(stream.started_at).toLocaleTimeString()}</span>
                              </span>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">
                              Code: {stream.room_code}
                            </span>
                            {stream.recording_url && (
                              <Badge variant="outline" className="text-xs">
                                <Download className="w-3 h-3 mr-1" />
                                Recording Available
                              </Badge>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {stream.status !== "ended" && (
                            <Button asChild size="sm" className="shrink-0">
                              <Link href={`/host/stream/${stream.room_code}`}>
                                {stream.status === "live" ? (
                                  <>
                                    <Square className="w-4 h-4 mr-1" />
                                    Manage
                                  </>
                                ) : (
                                  <>
                                    <Play className="w-4 h-4 mr-1" />
                                    Start
                                  </>
                                )}
                              </Link>
                            </Button>
                          )}
                          
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="sm" className="shrink-0">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem onClick={() => shareStream(stream)}>
                                <Share2 className="w-4 h-4 mr-2" />
                                Share Stream
                              </DropdownMenuItem>
                              
                              <DropdownMenuItem onClick={() => copyShareLink(stream.room_code)}>
                                <Copy className="w-4 h-4 mr-2" />
                                Copy Link
                              </DropdownMenuItem>
                              
                              {stream.recording_url && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => handleDownloadRecording(stream)}>
                                    <Download className="w-4 h-4 mr-2" />
                                    Download Recording
                                  </DropdownMenuItem>
                                </>
                              )}
                              
                              <DropdownMenuSeparator />
                              
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onSelect={(e) => e.preventDefault()}
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Delete Stream
                                  </DropdownMenuItem>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Stream</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure you want to delete "{stream.title}"? This action cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => handleDeleteStream(stream.id)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      {deletingStream === stream.id ? (
                                        <>
                                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                          Deleting...
                                        </>
                                      ) : (
                                        "Delete Stream"
                                      )}
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
        </div>
      </main>

      {/* Emergency Panel Dialog */}
      <AlertDialog open={showEmergencyPanel} onOpenChange={setShowEmergencyPanel}>
        <AlertDialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Emergency Messages ({emergencyMessages.length})
            </AlertDialogTitle>
            <AlertDialogDescription>
              Viewer emergency messages and technical issues reported
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <div className="space-y-4 py-4">
            {emergencyMessages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No emergency messages reported</p>
              </div>
            ) : (
              emergencyMessages.map((msg) => (
                <Card key={msg.id} className="border-red-200 bg-red-50">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className="bg-red-500 text-white">
                            Emergency
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            From: {msg.sender_name.replace('SYSTEM - ', '')}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {new Date(msg.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm">
                          {msg.message.replace('EMERGENCY: ', '')}
                        </p>
                        {msg.stream_id && (
                          <div className="mt-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => router.push(`/host/stream/${msg.stream_id}`)}
                            >
                              Go to Stream
                            </Button>
                          </div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEmergencyMessages(prev => prev.filter(m => m.id !== msg.id));
                        }}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
          
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowEmergencyPanel(false)}>
              Close
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
