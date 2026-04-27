"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Layers,
  Megaphone,
  Music2,
  Play,
  Plus,
  Trash2,
  Tv,
} from "lucide-react";
import { DeckHeader } from "@/components/host/control-room/deck-header";
import { ICON_CHIP, SURFACE, TYPO } from "@/lib/control-room/styles";
import {
  type Scene,
  type SceneLayout,
  type OverlayPreset,
  type TickerPreset,
  captureScene,
} from "@/lib/control-room/types";

interface Props {
  scenes: Scene[];
  currentLayout: SceneLayout;
  currentOverlay: OverlayPreset;
  currentTicker: TickerPreset;
  currentMusicUrl: string;
  onApply: (s: Scene) => void;
  onSave: (s: Scene) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

/**
 * Scenes rail — saved producer presets for fast scene switching.
 * Each scene is a snapshot of overlay + ticker + music + layout that
 * the host can recall in one click. Apply fan-outs through the same
 * setters that the manual deck controls use, so viewers receive the
 * standard broadcast events with no special-case handling.
 */
export function ScenesRail({
  scenes,
  currentLayout,
  currentOverlay,
  currentTicker,
  currentMusicUrl,
  onApply,
  onSave,
  onDelete,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give the scene a name first");
      return;
    }
    setBusy(true);
    try {
      const scene = captureScene({
        name: trimmed,
        layout: currentLayout,
        overlay: currentOverlay.active || currentOverlay.message ? currentOverlay : null,
        ticker: currentTicker.active || currentTicker.message ? currentTicker : null,
        musicUrl: currentMusicUrl || null,
      });
      await onSave(scene);
      toast.success(`Saved "${scene.name}"`);
      setName("");
      setAdding(false);
    } catch (err) {
      console.error("[scenes] save failed:", err);
      toast.error("Couldn't save scene. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${SURFACE.panel} p-4`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <DeckHeader
          icon={Layers}
          title="Scenes"
          description="Saved overlay + ticker + music presets."
        />
        {!adding && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAdding(true)}
            className="h-7 px-2 -mt-0.5 shrink-0"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            New
          </Button>
        )}
      </div>

      {adding && (
        <div className="flex gap-2 mb-3">
          <Input
            autoFocus
            placeholder="Scene name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 60))}
            maxLength={60}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSave();
              if (e.key === "Escape") {
                setAdding(false);
                setName("");
              }
            }}
            className="h-8 text-sm bg-background/60"
          />
          <Button size="sm" onClick={handleSave} disabled={busy} className="h-8 shrink-0">
            Save
          </Button>
        </div>
      )}

      {scenes.length === 0 && !adding ? (
        <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-6 text-center">
          <p className={`${TYPO.sub} leading-relaxed`}>
            No scenes yet. Configure overlay / ticker / music, then save them as a preset for one-click recall during your show.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {scenes
            .slice()
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((s) => (
              <li
                key={s.id}
                className="group rounded-lg ring-1 ring-border bg-background/60 hover:ring-primary/40 hover:bg-background transition-all p-2.5 flex items-center gap-2"
              >
                <span className={`${ICON_CHIP.muted} h-7 w-7 group-hover:bg-primary/10 group-hover:text-primary group-hover:ring-primary/30 transition-colors`}>
                  <Play className="w-3 h-3 fill-current ml-0.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-foreground truncate leading-tight">
                    {s.name}
                  </p>
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    {s.overlay && (
                      <span className="inline-flex items-center gap-0.5 h-4 px-1 rounded text-[9px] font-medium bg-muted text-muted-foreground">
                        <Megaphone className="w-2.5 h-2.5" /> overlay
                      </span>
                    )}
                    {s.ticker && (
                      <span className="inline-flex items-center gap-0.5 h-4 px-1 rounded text-[9px] font-medium bg-muted text-muted-foreground">
                        <Tv className="w-2.5 h-2.5" /> ticker
                      </span>
                    )}
                    {s.musicUrl && (
                      <span className="inline-flex items-center gap-0.5 h-4 px-1 rounded text-[9px] font-medium bg-muted text-muted-foreground">
                        <Music2 className="w-2.5 h-2.5" /> music
                      </span>
                    )}
                    <span className="inline-flex items-center h-4 px-1 rounded text-[9px] font-medium bg-muted text-muted-foreground capitalize">
                      {s.layout}
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onApply(s)}
                  className="h-7 px-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Apply scene"
                >
                  <Play className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm(`Delete scene "${s.name}"?`)) void onDelete(s.id);
                  }}
                  className="h-7 px-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  title="Delete scene"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
                {/* Always-visible quick apply when no hover (mobile) */}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onApply(s)}
                  className="h-7 px-2 shrink-0 sm:hidden text-primary"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                </Button>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
