"use client";

import Link from "next/link";
import { PlayCircle, Eye, Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

export interface ReplayCardData {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  view_count: number;
  like_count: number;
  host_id: string;
  hostName?: string;
}

interface ReplayCardProps {
  replay: ReplayCardData;
}

export function ReplayCard({ replay }: ReplayCardProps) {
  const timeAgo = replay.published_at
    ? formatDistanceToNow(new Date(replay.published_at), { addSuffix: true })
    : null;

  return (
    <Link
      href={`/r/${replay.id}`}
      className="group flex flex-col rounded-xl border border-border bg-card transition-all hover:border-primary/30 hover:shadow-md hover:shadow-primary/5 overflow-hidden"
      aria-label={`Replay: ${replay.title}`}
    >
      {/* Thumbnail / placeholder */}
      <div className="relative aspect-video bg-muted flex items-center justify-center overflow-hidden">
        {replay.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={replay.thumbnail_url}
            alt={replay.title}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground/50">
            <PlayCircle className="h-10 w-10" />
          </div>
        )}
        {/* Play overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/90 text-primary-foreground">
            <PlayCircle className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col gap-2 p-3">
        <p className="text-sm font-semibold leading-snug line-clamp-2 group-hover:text-primary transition-colors">
          {replay.title}
        </p>

        {replay.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {replay.description}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 mt-auto pt-1">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            {replay.view_count > 0 && (
              <span className="flex items-center gap-1">
                <Eye className="h-3 w-3" />
                {replay.view_count.toLocaleString()}
              </span>
            )}
            {replay.like_count > 0 && (
              <span className="flex items-center gap-1">
                <Heart className="h-3 w-3" />
                {replay.like_count.toLocaleString()}
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground text-right truncate max-w-[120px]">
            {replay.hostName && <span className="block truncate">{replay.hostName}</span>}
            {timeAgo && <span className="block">{timeAgo}</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}
