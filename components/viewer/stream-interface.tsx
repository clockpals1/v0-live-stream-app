"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Radio,
  Users,
  Circle,
  Send,
  MessageCircle,
  Clock,
  Share2,
  Copy,
} from "lucide-react";

interface Stream {
  id: string;
  room_code: string;
  title: string;
  status: "waiting" | "live" | "ended";
  viewer_count: number;
  started_at: string | null;
  ended_at: string | null;
}

interface ChatMessage {
  id: string;
  sender_name: string;
  message: string;
  created_at: string;
}

interface ViewerStreamInterfaceProps {
  stream: Stream;
  hostName: string;
}

export function ViewerStreamInterface({ stream: initialStream, hostName }: ViewerStreamInterfaceProps) {
  const [stream, setStream] = useState(initialStream);
  const [viewerName, setViewerName] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(initialStream.viewer_count);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [showNameDialog, setShowNameDialog] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  const shareLink = typeof window !== "undefined" 
    ? `${window.location.origin}/watch/${stream.room_code}` 
    : "";

  // Join stream as viewer
  const joinStream = async () => {
    if (!viewerName.trim()) return;

    const { data } = await supabase
      .from("viewers")
      .insert({
        stream_id: stream.id,
        viewer_name: viewerName.trim(),
      })
      .select()
      .single();

    if (data) {
      setViewerId(data.id);
      setIsJoined(true);
      setShowNameDialog(false);
    }
  };

  // Leave stream on unmount
  useEffect(() => {
    return () => {
      if (viewerId) {
        supabase
          .from("viewers")
          .update({ left_at: new Date().toISOString() })
          .eq("id", viewerId);
      }
    };
  }, [viewerId, supabase]);

  // Subscribe to stream status changes
  useEffect(() => {
    const channel = supabase
      .channel(`stream-${stream.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "streams",
          filter: `id=eq.${stream.id}`,
        },
        (payload) => {
          setStream(payload.new as Stream);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stream.id, supabase]);

  // Subscribe to chat messages
  useEffect(() => {
    const channel = supabase
      .channel(`chat-viewer-${stream.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `stream_id=eq.${stream.id}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as ChatMessage]);
        }
      )
      .subscribe();

    // Load existing messages
    supabase
      .from("chat_messages")
      .select("*")
      .eq("stream_id", stream.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data) setMessages(data);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stream.id, supabase]);

  // Subscribe to viewer count
  useEffect(() => {
    const channel = supabase
      .channel(`viewers-watch-${stream.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "viewers",
          filter: `stream_id=eq.${stream.id}`,
        },
        async () => {
          const { count } = await supabase
            .from("viewers")
            .select("*", { count: "exact", head: true })
            .eq("stream_id", stream.id)
            .is("left_at", null);
          
          setViewerCount(count || 0);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stream.id, supabase]);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !isJoined) return;

    await supabase.from("chat_messages").insert({
      stream_id: stream.id,
      sender_name: viewerName,
      message: newMessage.trim(),
    });

    setNewMessage("");
  };

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getStatusContent = () => {
    switch (stream.status) {
      case "live":
        return (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
            <div className="text-center">
              <div className="w-24 h-24 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                <Radio className="w-12 h-12 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2">Stream is Live!</h2>
              <p className="text-muted-foreground">
                {hostName} is broadcasting
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Note: This is a demo - video feed requires WebRTC signaling server
              </p>
            </div>
          </div>
        );
      case "ended":
        return (
          <div className="absolute inset-0 flex items-center justify-center bg-muted">
            <div className="text-center">
              <Clock className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-foreground mb-2">Stream Ended</h2>
              <p className="text-muted-foreground">
                This stream has ended. Thank you for watching!
              </p>
            </div>
          </div>
        );
      default:
        return (
          <div className="absolute inset-0 flex items-center justify-center bg-muted">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-foreground mb-2">Waiting for Host</h2>
              <p className="text-muted-foreground">
                {hostName} will start the stream soon
              </p>
            </div>
          </div>
        );
    }
  };

  return (
    <>
      <Dialog open={showNameDialog} onOpenChange={setShowNameDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Join the Stream</DialogTitle>
            <DialogDescription>
              Enter your name to join the chat and interact with others
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              joinStream();
            }}
            className="flex flex-col gap-4"
          >
            <Input
              placeholder="Your name"
              value={viewerName}
              onChange={(e) => setViewerName(e.target.value)}
              autoFocus
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setShowNameDialog(false)}
              >
                Watch Only
              </Button>
              <Button type="submit" className="flex-1" disabled={!viewerName.trim()}>
                Join Chat
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

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
              {stream.status === "live" && (
                <Badge className="bg-red-500 text-white animate-pulse">
                  <Circle className="w-2 h-2 mr-1 fill-current" />
                  LIVE
                </Badge>
              )}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="w-4 h-4" />
                <span>{viewerCount} watching</span>
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-6">
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Video Area */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              <Card className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="relative aspect-video bg-black">
                    {getStatusContent()}
                  </div>
                </CardContent>
              </Card>

              {/* Stream Info */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-xl font-semibold text-foreground">{stream.title}</h1>
                  <p className="text-sm text-muted-foreground">Hosted by {hostName}</p>
                </div>
                <Button variant="outline" size="sm" onClick={copyShareLink}>
                  {copied ? (
                    "Copied!"
                  ) : (
                    <>
                      <Share2 className="w-4 h-4 mr-2" />
                      Share
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Chat Panel */}
            <Card className="lg:col-span-1 flex flex-col h-[500px] lg:h-[600px]">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageCircle className="w-4 h-4" />
                  Live Chat
                  {isJoined && (
                    <Badge variant="secondary" className="ml-auto text-xs">
                      {viewerName}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col p-0">
                <ScrollArea className="flex-1 px-4">
                  <div className="flex flex-col gap-3 py-2">
                    {messages.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        No messages yet. Be the first to say something!
                      </p>
                    ) : (
                      messages.map((msg) => (
                        <div key={msg.id} className="flex flex-col gap-1">
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-medium text-foreground">
                              {msg.sender_name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(msg.created_at).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground">{msg.message}</p>
                        </div>
                      ))
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>
                <form onSubmit={sendMessage} className="p-4 border-t border-border">
                  {isJoined ? (
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Send a message..."
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                      />
                      <Button type="submit" size="icon">
                        <Send className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => setShowNameDialog(true)}
                    >
                      Join to chat
                    </Button>
                  )}
                </form>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </>
  );
}
