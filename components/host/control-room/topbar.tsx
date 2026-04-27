"use client";

import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Circle,
  Pause,
  Radio,
  Users,
  WifiOff,
} from "lucide-react";
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

const HEALTH_COLOR: Record<StreamHealth["status"], string> = {
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/30",
  warn: "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/30",
  bad: "bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/30",
  offline: "bg-muted text-muted-foreground ring-border",
};

const HEALTH_LABEL: Record<StreamHealth["status"], string> = {
  ok: "Healthy",
  warn: "Marginal",
  bad: "Unstable",
  offline: "No peers",
};

/**
 * Sticky top bar for the Live Control Room.
 *
 * Visual goals here:
 *   - Dense single row even at 1280px wide. No badge wrapping.
 *   - Live state is unmistakable — pulsing gradient pill with an
 *     emanating ring instead of a flat red rectangle.
 *   - Health pill mirrors the deck's color so the host learns one
 *     mapping (green/amber/red/grey) and reads either at a glance.
 *   - Subtle gradient bottom edge instead of a solid 1px border —
 *     gives the bar weight without a hard line cutting the page.
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
    <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/65">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-3">
        {/* Left cluster — back · brand · room */}
        <div className="flex items-center gap-2.5 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="h-8 -ml-2 px-2 text-muted-foreground hover:text-foreground"
          >
            <Link href="/host/dashboard">
              <ArrowLeft className="w-4 h-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Back</span>
            </Link>
          </Button>

          <div className="h-6 w-px bg-gradient-to-b from-transparent via-border to-transparent hidden sm:block" />

          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-primary to-primary/70 ring-1 ring-primary/40 flex items-center justify-center shrink-0 shadow-sm shadow-primary/20">
              <Radio className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <div className="hidden md:flex flex-col min-w-0 leading-tight">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Control Room
              </span>
              <span className="text-[13px] font-semibold text-foreground truncate max-w-[18ch]">
                {streamTitle}
              </span>
            </div>
          </div>

          <div className="h-6 w-px bg-gradient-to-b from-transparent via-border to-transparent hidden sm:block" />

          <div className="hidden sm:flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Room
            </span>
            <code className="text-xs font-mono font-semibold text-foreground bg-muted/70 ring-1 ring-border px-2 py-0.5 rounded">
              {roomCode}
            </code>
          </div>
        </div>

        {/* Right cluster — operators · status pills · viewers · theme */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {showOperatorsDialog && (
            <StreamOperatorsDialog
              streamId={streamId}
              streamTitle={streamTitle}
            />
          )}

          {isStreaming && !isPaused && (
            <span className="inline-flex items-center gap-1.5 px-2 h-6 rounded-full text-[11px] font-semibold text-white bg-gradient-to-r from-red-500 to-rose-500 shadow-[0_0_0_3px_rgba(239,68,68,0.18)]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
              </span>
              LIVE
            </span>
          )}
          {isStreaming && isPaused && (
            <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] font-semibold text-white bg-amber-500">
              <Pause className="w-2.5 h-2.5 fill-current" />
              PAUSED
            </span>
          )}
          {isRecording && (
            <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] font-semibold text-red-600 dark:text-red-400 bg-red-500/10 ring-1 ring-red-500/30">
              <Circle className="w-2 h-2 fill-current" />
              REC
            </span>
          )}
          {health && isStreaming && (
            <span
              className={`hidden md:inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] font-medium ring-1 ${HEALTH_COLOR[health.status]}`}
              title={`Bitrate ${health.bitrateKbps} kbps · loss ${health.packetLossPct}% · RTT ${health.rttMs} ms · ICE ${health.iceState}`}
            >
              {health.status === "offline" ? (
                <WifiOff className="w-3 h-3" />
              ) : (
                <Activity className="w-3 h-3" />
              )}
              {HEALTH_LABEL[health.status]}
            </span>
          )}

          <div className="inline-flex items-center gap-1.5 text-xs text-foreground/80 bg-muted/60 ring-1 ring-border rounded-full h-6 px-2">
            <Users className="w-3 h-3 text-muted-foreground" />
            <span className="tabular-nums font-medium">
              {connectedViewers}
              <span className="text-muted-foreground/60">/{totalViewers}</span>
            </span>
          </div>

          <ThemeToggle />
        </div>
      </div>
      {/* Soft gradient edge instead of a hard 1px border */}
      <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
    </header>
  );
}
