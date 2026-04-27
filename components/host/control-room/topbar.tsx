"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Radio,
  Pause,
  Circle,
  Users,
  Activity,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { StreamOperatorsDialog } from "@/components/admin/stream-operators-dialog";
import type { StreamHealth } from "@/lib/webrtc/use-stream-health";

interface Props {
  roomCode: string;
  streamId: string;
  streamTitle: string;
  isStreaming: boolean;
  isPaused: boolean;
  isRecording: boolean;
  connectedViewers: number;
  totalViewers: number;
  showOperatorsDialog: boolean;
  health: StreamHealth | null;
}

const HEALTH_COLOUR: Record<StreamHealth["status"], string> = {
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  warn: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  bad: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
  offline: "bg-muted text-muted-foreground border-border",
};

const HEALTH_LABEL: Record<StreamHealth["status"], string> = {
  ok: "Healthy",
  warn: "Marginal",
  bad: "Unstable",
  offline: "No peers",
};

/**
 * Sticky top bar of the Live Control Room. Owns:
 *   - Back link to dashboard
 *   - Brand mark + room code chip
 *   - Live / paused / REC pills
 *   - Stream-health pill (colour reflects useStreamHealth.status)
 *   - Connected vs total viewer counter
 *   - Operators dialog access (admin/owner)
 *   - Theme toggle
 *
 * The bar deliberately stays one row tall on desktop. Items collapse
 * gracefully on narrower viewports — the room code and brand mark
 * disappear before the status pills do.
 */
export function ControlRoomTopbar({
  roomCode,
  streamId,
  streamTitle,
  isStreaming,
  isPaused,
  isRecording,
  connectedViewers,
  totalViewers,
  showOperatorsDialog,
  health,
}: Props) {
  return (
    <header className="sticky top-0 z-30 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" asChild className="h-8 -ml-2 px-2">
            <Link href="/host/dashboard">
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Back</span>
            </Link>
          </Button>
          <div className="h-5 w-px bg-border hidden sm:block" />
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 bg-primary rounded-md flex items-center justify-center shrink-0">
              <Radio className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-foreground hidden md:inline truncate max-w-[16ch]">
              {streamTitle}
            </span>
          </div>
          <div className="h-5 w-px bg-border hidden sm:block" />
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground hidden sm:inline">
              Room
            </span>
            <code className="text-xs font-mono font-semibold text-foreground bg-muted px-2 py-0.5 rounded">
              {roomCode}
            </code>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {showOperatorsDialog && (
            <StreamOperatorsDialog streamId={streamId} streamTitle={streamTitle} />
          )}
          {isStreaming && !isPaused && (
            <Badge className="bg-red-500 text-white animate-pulse gap-1.5 h-6 px-2">
              <span className="w-1.5 h-1.5 rounded-full bg-white" />
              LIVE
            </Badge>
          )}
          {isStreaming && isPaused && (
            <Badge className="bg-orange-500 text-white gap-1 h-6 px-2">
              <Pause className="w-2.5 h-2.5" />
              PAUSED
            </Badge>
          )}
          {isRecording && (
            <Badge variant="outline" className="text-red-500 border-red-500 gap-1 h-6 px-2">
              <Circle className="w-2 h-2 fill-red-500" />
              REC
            </Badge>
          )}
          {health && isStreaming && (
            <Badge
              variant="outline"
              className={`gap-1 h-6 px-2 hidden md:inline-flex ${HEALTH_COLOUR[health.status]}`}
              title={`Bitrate ${health.bitrateKbps} kbps · loss ${health.packetLossPct}% · RTT ${health.rttMs} ms · ICE ${health.iceState}`}
            >
              {health.status === "offline" ? (
                <WifiOff className="w-3 h-3" />
              ) : (
                <Activity className="w-3 h-3" />
              )}
              {HEALTH_LABEL[health.status]}
            </Badge>
          )}
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground border border-border rounded-md h-6 px-2">
            <Users className="w-3.5 h-3.5" />
            <span className="tabular-nums text-xs font-medium">
              {connectedViewers}
              <span className="text-muted-foreground/60">/{totalViewers}</span>
            </span>
          </div>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
