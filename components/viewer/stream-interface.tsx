"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Radio, Users, Circle, ArrowLeft, Share2, MessageCircle } from "lucide-react";

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

interface ViewerStreamInterfaceProps {
  stream: Stream;
  hostName: string;
}

export function ViewerStreamInterface({
  stream: initialStream,
  hostName,
}: ViewerStreamInterfaceProps) {
  const [viewerCount] = useState(initialStream.viewer_count);

  const copyShareLink = () => {
    const shareLink = typeof window !== "undefined"
      ? `${window.location.origin}/watch/${initialStream.room_code}`
      : "";
    navigator.clipboard.writeText(shareLink);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Radio className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground">
              Isunday Stream Live
            </span>
          </Link>
          <div className="flex items-center gap-4">
            {initialStream.status === "live" && (
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
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                      <h2 className="text-xl font-semibold text-white mb-2">
                        Stream Loading...
                      </h2>
                      <p className="text-gray-300">
                        Please wait while we connect you to {hostName}'s stream
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Stream Info */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold text-foreground">
                  {initialStream.title}
                </h1>
                <p className="text-sm text-muted-foreground">
                  Hosted by {hostName}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={copyShareLink}>
                <Share2 className="w-4 h-4 mr-2" />
                Share
              </Button>
            </div>
          </div>

          {/* Chat Panel */}
          <Card className="lg:col-span-1 flex flex-col h-[500px] lg:h-[600px]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageCircle className="w-4 h-4" />
                Live Chat
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-0">
              <div className="flex-1 flex items-center justify-center p-8">
                <p className="text-sm text-muted-foreground text-center">
                  Chat will be available once the stream loads
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
