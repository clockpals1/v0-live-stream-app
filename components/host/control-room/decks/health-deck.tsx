"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gauge,
  Wifi,
  WifiOff,
} from "lucide-react";
import { DeckHeader } from "@/components/host/control-room/deck-header";
import { SURFACE, TYPO } from "@/lib/control-room/styles";
import type { StreamHealth } from "@/lib/webrtc/use-stream-health";

interface Props {
  health: StreamHealth;
  isStreaming: boolean;
  viewerCount: number;
}

const STATUS_LABEL: Record<StreamHealth["status"], string> = {
  ok: "Healthy",
  warn: "Marginal",
  bad: "Unstable",
  offline: "No active peers",
};

const STATUS_BAR: Record<StreamHealth["status"], string> = {
  ok: "from-emerald-500/20 to-emerald-500/5 ring-emerald-500/30 text-emerald-700 dark:text-emerald-300",
  warn: "from-amber-500/20 to-amber-500/5 ring-amber-500/30 text-amber-700 dark:text-amber-300",
  bad: "from-red-500/20 to-red-500/5 ring-red-500/30 text-red-700 dark:text-red-300",
  offline: "from-muted to-muted/40 ring-border text-muted-foreground",
};

export function HealthDeck({ health, isStreaming, viewerCount }: Props) {
  if (!isStreaming) {
    return (
      <div className="flex flex-col gap-3.5">
        <DeckHeader
          icon={Activity}
          title="Stream health"
          description="Live diagnostics from every viewer's connection."
        />
        <p className="text-sm text-muted-foreground leading-relaxed">
          Stream health appears here once you go live. We sample bitrate,
          packet loss, round-trip time, and ICE state every 2 seconds from
          every connected viewer&apos;s peer connection.
        </p>
      </div>
    );
  }

  const Icon =
    health.status === "ok"
      ? CheckCircle2
      : health.status === "warn"
        ? AlertTriangle
        : health.status === "bad"
          ? AlertTriangle
          : WifiOff;

  return (
    <div className="flex flex-col gap-3.5">
      <DeckHeader
        icon={Activity}
        title="Stream health"
        description="Live diagnostics from every viewer's connection."
      />

      <div
        className={`rounded-lg bg-gradient-to-r px-3.5 py-2.5 flex items-center gap-2.5 ring-1 ${STATUS_BAR[health.status]}`}
      >
        <Icon className="w-4 h-4" />
        <span className="text-[13px] font-semibold">{STATUS_LABEL[health.status]}</span>
        {health.iceState !== "no-peers" && (
          <span className="ml-auto text-[10px] uppercase tracking-[0.12em] font-medium opacity-80">
            ICE: {String(health.iceState)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Metric icon={<Gauge className="w-3.5 h-3.5" />} label="Bitrate" value={`${health.bitrateKbps}`} suffix="kbps" />
        <Metric icon={<Activity className="w-3.5 h-3.5" />} label="Loss (worst)" value={`${health.packetLossPct}`} suffix="%" danger={health.packetLossPct >= 3} />
        <Metric icon={<Clock className="w-3.5 h-3.5" />} label="RTT (worst)" value={`${health.rttMs}`} suffix="ms" danger={health.rttMs > 250} />
        <Metric icon={<Wifi className="w-3.5 h-3.5" />} label="Peers" value={`${viewerCount}`} suffix="" />
      </div>

      <p className={TYPO.sub}>
        Per-peer outbound metrics. Drops of bitrate or sudden RTT spikes usually
        mean a viewer is on a flaky network — your stream itself may be fine.
      </p>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  suffix,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix: string;
  danger?: boolean;
}) {
  return (
    <div
      className={`${SURFACE.inline} px-3 py-2.5 ${danger ? "ring-1 ring-red-500/40 bg-red-500/[0.03]" : ""}`}
    >
      <div className="flex items-center gap-1 text-muted-foreground">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className={TYPO.metric}>{value}</span>
        {suffix && <span className="text-[10px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}
