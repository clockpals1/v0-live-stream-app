"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Radio,
  Video,
  Users,
  MessageCircle,
  Download,
  Share2,
  ArrowRight,
  Sparkles,
} from "lucide-react";

export default function HomePage() {
  const [roomCode, setRoomCode] = useState("");
  const router = useRouter();

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomCode.trim()) {
      router.push(`/watch/${roomCode.trim()}`);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
              <Radio className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground">Isunday Stream Live</span>
          </div>
          <Button asChild>
            <Link href="/auth/login">
              Host Login
            </Link>
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-6">
            <Sparkles className="w-4 h-4" />
            Live Streaming Made Simple
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-foreground mb-6 text-balance">
            Stream Your Events to the World
          </h1>
          <p className="text-lg text-muted-foreground mb-10 max-w-2xl mx-auto text-pretty">
            Broadcast live from your phone to viewers anywhere. Easy setup, real-time chat, 
            and automatic recording. Perfect for events, meetings, and live sessions.
          </p>

          {/* Join Stream Form */}
          <Card className="max-w-md mx-auto">
            <CardHeader>
              <CardTitle>Join a Stream</CardTitle>
              <CardDescription>
                Enter a room code to watch a live stream
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleJoin} className="flex items-center gap-2">
                <Input
                  placeholder="Enter room code"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                  className="font-mono"
                />
                <Button type="submit" disabled={!roomCode.trim()}>
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 px-4 bg-muted/50">
        <div className="container mx-auto max-w-6xl">
          <h2 className="text-3xl font-bold text-foreground text-center mb-12">
            Everything You Need to Go Live
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card>
              <CardContent className="pt-6">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                  <Video className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Phone Streaming</h3>
                <p className="text-sm text-muted-foreground">
                  Stream directly from your phone camera and microphone with one tap
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                  <Users className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Global Viewers</h3>
                <p className="text-sm text-muted-foreground">
                  Share a simple link for viewers to join from anywhere in the world
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                  <MessageCircle className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Live Chat</h3>
                <p className="text-sm text-muted-foreground">
                  Real-time chat between host and viewers for interactive sessions
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                  <Download className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Auto Recording</h3>
                <p className="text-sm text-muted-foreground">
                  Streams are automatically recorded for download or sharing later
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 px-4">
        <div className="container mx-auto max-w-4xl">
          <h2 className="text-3xl font-bold text-foreground text-center mb-12">
            How It Works
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
                1
              </div>
              <h3 className="font-semibold text-foreground mb-2">Create a Stream</h3>
              <p className="text-sm text-muted-foreground">
                Log in as a host and create a new stream with a custom title
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
                2
              </div>
              <h3 className="font-semibold text-foreground mb-2">Share the Link</h3>
              <p className="text-sm text-muted-foreground">
                Copy your unique room link and share it with your audience
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
                3
              </div>
              <h3 className="font-semibold text-foreground mb-2">Go Live</h3>
              <p className="text-sm text-muted-foreground">
                Hit the Go Live button and start broadcasting to your viewers
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 px-4 bg-primary">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="text-3xl font-bold text-primary-foreground mb-4">
            Ready to Start Streaming?
          </h2>
          <p className="text-primary-foreground/80 mb-8">
            Create your account and start your first live stream in minutes
          </p>
          <div className="flex items-center justify-center gap-4">
            <Button variant="secondary" size="lg" asChild>
              <Link href="/auth/signup">
                <Share2 className="w-4 h-4 mr-2" />
                Become a Host
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4">
        <div className="container mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Radio className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground">Isunday Stream Live</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Built with Next.js, Supabase, and WebRTC
          </p>
        </div>
      </footer>
    </div>
  );
}
