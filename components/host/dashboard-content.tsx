"use client";

import { useState } from "react";
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
import { toast } from "sonner";
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
} from "lucide-react";
import { nanoid } from "nanoid";
import type { User } from "@supabase/supabase-js";

interface Stream {
  id: string;
  room_code: string;
  title: string;
  status: "waiting" | "live" | "ended";
  viewer_count: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
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

export function DashboardContent({ user, host, streams }: DashboardContentProps) {
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [deletingStream, setDeletingStream] = useState<string | null>(null);
  const router = useRouter();

  const handleCreateStream = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!host) return;
    
    setLoading(true);
    const supabase = createClient();
    const roomCode = nanoid(8);

    const { data, error } = await supabase
      .from("streams")
      .insert({
        host_id: host.id,
        room_code: roomCode,
        title: title || "Live Stream",
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating stream:", error);
      setLoading(false);
      return;
    }

    router.push(`/host/stream/${data.room_code}`);
  };

  const handleSignOut = async () => {
    const supabase = createClient();
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
    const supabase = createClient();
    
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
          {/* Create Stream Card */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="w-5 h-5" />
                New Stream
              </CardTitle>
              <CardDescription>
                Start a new live stream event
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateStream} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="title">Stream Title</Label>
                  <Input
                    id="title"
                    placeholder="My Live Event"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
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
                      Create Stream
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Streams List */}
          <div className="lg:col-span-2">
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
                {streams.map((stream) => (
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
      </main>
    </div>
  );
}
