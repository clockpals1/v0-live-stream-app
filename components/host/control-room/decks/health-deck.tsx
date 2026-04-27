"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gauge,
  Wifi,
  WifiOff,
} from "lucide-react";
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

const STATUS_COLOUR: Record<StreamHealth["status"], string> = {
  ok: "text-emerald-700 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  warn: "text-amber-700 dark:text-amber-400 border-amber-500/30 bg-amber-500/10",
  bad: "text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/10",
  offline: "text-muted-foreground border-border bg-muted",
};

/**
 * Health deck — surfaces the metrics already collected by
 * useStreamHealth (a getStats() poll over every viewer's outbound PC):
 *
 *   - Aggregate outbound video bitrate (kbps, averaged across peers)
 *   - Worst peer packet loss (%)
 *   - Worst peer round-trip time (ms)
 *   - Worst ICE connection state across peers
 *   - A derived ok/warn/bad/offline status
 *
 * Renders a non-intrusive grid of four metric tiles plus a single
 * coloured status row at the top. The same status drives the topbar
 * pill so the host never needs to open this deck unless something
 * looks wrong.
 */
export function HealthDeck({ health, isStreaming, viewerCount }: Props) {
  if (!isStreaming) {
    return (
      <Card>
        <CardHeader className="pb-3 border-b">
          <CardHeader__Inline />
        </CardHeader>
        <CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">
            Stream health appears here once you go live. We sample bitrate,
            packet loss, round-trip time, and ICE state every 2 seconds from
            every connected viewer&apos;s peer connection.
          </p>
        </CardContent>
      </Card>
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
    <Card>
      <CardHeader className="pb-3 border-b">
        <CardHeader__Inline />
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-3">
        <div
          className={`rounded-md border px-3 py-2 flex items-center gap-2 ${STATUS_COLOUR[health.status]}`}
        >
          <Icon className="w-4 h-4" />
          <span className="text-sm font-semibold">{STATUS_LABEL[health.status]}</span>
          {health.iceState !== "no-peers" && (
            <Badge variant="outline" className="ml-auto text-[10px] h-5 px-1.5 capitalize">
              ICE: {String(health.iceState)}
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Metric
            icon={<Gauge className="w-3.5 h-3.5" />}
            label="Bitrate"
            value={`${health.bitrateKbps}`}
            suffix="kbps"
          />
          <Metric
            icon={<Activity className="w-3.5 h-3.5" />}
            label="Loss (worst)"
            value={`${health.packetLossPct}`}
            suffix="%"
            danger={health.packetLossPct >= 3}
          />
          <Metric
            icon={<Clock className="w-3.5 h-3.5" />}
            label="RTT (worst)"
            value={`${health.rttMs}`}
            suffix="ms"
            danger={health.rttMs > 250}
          />
          <Metric
            icon={<Wifi className="w-3.5 h-3.5" />}
            label="Peers"
            value={`${viewerCount}`}
            suffix=""
          />
        </div>

        <p className="text-[11px] text-muted-foreground">
          Per-peer outbound metrics. Drops of bitrate or sudden RTT spikes usually
          mean a viewer is on a flaky network — your stream itself may be fine.
        </p>
      </CardContent>
    </Card>
  );
}

function CardHeader__Inline() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
        <Activity className="w-4 h-4 text-primary" />
      </div>
      <div>
        <CardTitle className="text-sm font-semibold">Stream health</CardTitle>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Live diagnostics from every viewer&apos;s connection.
        </p>
      </div>
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
      className={`rounded-md border bg-card px-2.5 py-2 flex flex-col gap-0.5 ${
        danger ? "border-red-500/40" : "border-border"
      }`}
    >
      <div className="flex items-center gap-1 text-muted-foreground text-[10px] uppercase tracking-wider">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-lg font-semibold tabular-nums">{value}</span>
        {suffix && (
          <span className="text-[10px] text-muted-foreground">{suffix}</span>
        )}
      </div>
    </div>
  );
}
