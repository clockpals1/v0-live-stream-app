"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Megaphone } from "lucide-react";
import { OverlayImageUpload } from "@/components/host/overlay-image-upload";
import { DeckHeader } from "@/components/host/control-room/deck-header";
import { TYPO } from "@/lib/control-room/styles";
import type { OverlayBackground, OverlayPreset } from "@/lib/control-room/types";

interface Props {
  streamId: string;
  overlay: OverlayPreset;
  setActive: (v: boolean) => void;
  setMessage: (v: string) => void;
  setBackground: (v: OverlayBackground) => void;
  setImageUrl: (v: string) => void;
}

export function OverlayDeck({
  streamId,
  overlay,
  setActive,
  setMessage,
  setBackground,
  setImageUrl,
}: Props) {
  return (
    <div className="flex flex-col gap-3.5">
      <DeckHeader
        icon={Megaphone}
        title="Overlay"
        description="Full-screen image, text, or both — shown over your video."
        status={
          overlay.active
            ? { label: "Live on screen", tone: "live" }
            : undefined
        }
      />

      <Input
        placeholder="Optional message (e.g. We'll be right back in 5 minutes...)"
        value={overlay.message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={120}
        className="bg-background/60"
      />

      <OverlayImageUpload
        streamId={streamId}
        currentUrl={overlay.imageUrl}
        onUploaded={(url) => setImageUrl(url)}
        onCleared={() => setImageUrl("")}
      />

      <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
        <div className="flex items-center gap-1.5">
          <span className={TYPO.label}>Background</span>
          <div className="flex items-center gap-1">
            {(["dark", "light", "branded"] as const).map((bg) => (
              <button
                key={bg}
                type="button"
                onClick={() => setBackground(bg)}
                className={`h-7 px-2.5 rounded-md text-[11px] capitalize font-medium ring-1 transition-all ${
                  overlay.background === bg
                    ? "ring-primary/60 ring-2"
                    : "ring-border hover:ring-foreground/30"
                }`}
                style={{
                  background:
                    bg === "dark"
                      ? "#0f172a"
                      : bg === "light"
                        ? "#fafafa"
                        : "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary)/0.7))",
                  color: bg === "light" ? "#111" : "#fff",
                }}
              >
                {bg}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {overlay.message.length}/120
          </span>
          {overlay.active ? (
            <Button size="sm" variant="destructive" onClick={() => setActive(false)} className="h-8">
              <EyeOff className="w-3.5 h-3.5 mr-1.5" />
              Hide
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => setActive(true)}
              disabled={!overlay.message.trim() && !overlay.imageUrl}
              className="h-8"
            >
              <Eye className="w-3.5 h-3.5 mr-1.5" />
              Show overlay
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
