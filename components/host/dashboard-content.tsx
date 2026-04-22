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
    setTimeout(() => setCopiedCode(null), 2000);
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
              <div className="flex flex-col gap-4">
                {streams.map((stream) => (
                  <Card key={stream.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-medium text-foreground truncate">
                              {stream.title}
                            </h3>
                            {getStatusBadge(stream.status)}
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Users className="w-4 h-4" />
                              {stream.viewer_count} viewers
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-4 h-4" />
                              {new Date(stream.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground font-mono">
                            Code: {stream.room_code}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => copyShareLink(stream.room_code)}
                          >
                            {copiedCode === stream.room_code ? (
                              "Copied!"
                            ) : (
                              <>
                                <Copy className="w-4 h-4 mr-1" />
                                Share
                              </>
                            )}
                          </Button>
                          {stream.status !== "ended" && (
                            <Button asChild size="sm">
                              <Link href={`/host/stream/${stream.room_code}`}>
                                <ExternalLink className="w-4 h-4 mr-1" />
                                {stream.status === "live" ? "Manage" : "Start"}
                              </Link>
                            </Button>
                          )}
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
