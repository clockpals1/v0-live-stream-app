"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Radio, Users, Clock, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";

export interface StreamCardData {
  id: string;
  room_code: string;
  title: string;
  status: "live" | "waiting" | "scheduled" | "ended";
  viewer_count?: number | null;
  started_at?: string | null;
  scheduled_at?: string | null;
  host_id?: string | null;
  hostName?: string;
}

interface StreamCardProps {
  stream: StreamCardData;
  variant?: "default" | "compact";
}

export function StreamCard({ stream, variant = "default" }: StreamCardProps) {
  const isLive = stream.status === "live";
  const isWaiting = stream.status === "waiting";
  const isScheduled = stream.status === "scheduled";

  const href = isScheduled ? "#" : `/watch/${stream.room_code}`;

  const timeLabel = isLive && stream.started_at
    ? formatDistanceToNow(new Date(stream.started_at), { addSuffix: false }) + " live"
    : isScheduled && stream.scheduled_at
    ? format(new Date(stream.scheduled_at), "MMM d, h:mm a")
    : null;

  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-col rounded-xl border border-border bg-card transition-all",
        "hover:border-primary/30 hover:shadow-md hover:shadow-primary/5",
        isScheduled && "cursor-default pointer-events-none opacity-80",
        variant === "compact" ? "p-3 gap-2" : "p-4 gap-3",
      )}
      aria-label={`${stream.title} — ${stream.status}`}
    >
      {/* Status bar */}
      <div className="flex items-center justify-between gap-2">
        {isLive ? (
          <Badge className="h-5 gap-1.5 bg-red-500 text-white hover:bg-red-500 text-[11px] px-2">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
            </span>
            LIVE
          </Badge>
        ) : isWaiting ? (
          <Badge variant="secondary" className="h-5 text-[11px] px-2">
            <Radio className="h-3 w-3 mr-1" />
            Starting soon
          </Badge>
        ) : (
          <Badge variant="outline" className="h-5 text-[11px] px-2 gap-1">
            <Calendar className="h-3 w-3" />
            Scheduled
          </Badge>
        )}

        {isLive && typeof stream.viewer_count === "number" && stream.viewer_count > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Users className="h-3 w-3" />
            {stream.viewer_count}
          </span>
        )}
      </div>

      {/* Title */}
      <p className={cn(
        "font-semibold leading-snug line-clamp-2 group-hover:text-primary transition-colors",
        variant === "compact" ? "text-sm" : "text-[15px]",
      )}>
        {stream.title}
      </p>

      {/* Meta row */}
      <div className="flex items-center justify-between gap-2 mt-auto">
        {stream.hostName && (
          <span className="text-xs text-muted-foreground truncate">
            {stream.hostName}
          </span>
        )}
        {timeLabel && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground ml-auto shrink-0">
            <Clock className="h-3 w-3" />
            {timeLabel}
          </span>
        )}
      </div>
    </Link>
  );
}
