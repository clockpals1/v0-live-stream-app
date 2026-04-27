"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Eye, EyeOff, Megaphone } from "lucide-react";
import { OverlayImageUpload } from "@/components/host/overlay-image-upload";
import type { OverlayBackground, OverlayPreset } from "@/lib/control-room/types";

interface Props {
  streamId: string;
  overlay: OverlayPreset;
  setActive: (v: boolean) => void;
  setMessage: (v: string) => void;
  setBackground: (v: OverlayBackground) => void;
  setImageUrl: (v: string) => void;
}

/**
 * Overlay deck — full-screen on-stage card with optional image and
 * background tint. Re-uses the existing OverlayImageUpload module so
 * R2 upload behaviour is unchanged.
 */
export function OverlayDeck({
  streamId,
  overlay,
  setActive,
  setMessage,
  setBackground,
  setImageUrl,
}: Props) {
  return (
    <Card>
      <CardHeader className="pb-3 border-b">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <Megaphone className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold">Overlay</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Full-screen image, text, or both shown over your video.
              </p>
            </div>
          </div>
          {overlay.active && (
            <Badge className="bg-green-500 text-white text-[10px] h-5 px-1.5 shrink-0">
              LIVE ON SCREEN
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Input
          placeholder="Optional text message (e.g. We'll be right back in 5 minutes...)"
          value={overlay.message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={120}
        />
        <OverlayImageUpload
          streamId={streamId}
          currentUrl={overlay.imageUrl}
          onUploaded={(url) => setImageUrl(url)}
          onCleared={() => setImageUrl("")}
        />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground mr-1">Background:</span>
            {(["dark", "light", "branded"] as const).map((bg) => (
              <button
                key={bg}
                type="button"
                onClick={() => setBackground(bg)}
                className={`h-7 px-2.5 rounded-md border text-xs capitalize transition-all ${
                  overlay.background === bg
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:border-foreground/30"
                }`}
                style={{
                  background:
                    bg === "dark"
                      ? "#111"
                      : bg === "light"
                        ? "#f5f5f5"
                        : "hsl(var(--primary))",
                  color: bg === "light" ? "#111" : "#fff",
                }}
              >
                {bg}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {overlay.message.length}/120
            </span>
            {overlay.active ? (
              <Button size="sm" variant="destructive" onClick={() => setActive(false)}>
                <EyeOff className="w-4 h-4 mr-1.5" />
                Hide
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => setActive(true)}
                disabled={!overlay.message.trim() && !overlay.imageUrl}
              >
                <Eye className="w-4 h-4 mr-1.5" />
                Show Overlay
              </Button>
            )}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Viewers see this as a full-screen overlay on top of your video.
        </p>
      </CardContent>
    </Card>
  );
}
