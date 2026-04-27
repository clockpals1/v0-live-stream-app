"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Layers, Plus, Play, Trash2, Music2, Megaphone, Tv } from "lucide-react";
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
 *
 * A scene is a snapshot of overlay + ticker + music URL + layout.
 * Applying a scene fans out to the existing setters in the control
 * room state hook — no new broadcast surface, no viewer-side change.
 *
 * Capture flow:
 *   1. Host configures overlay/ticker/music live.
 *   2. Clicks "Save current as scene", types a name, presses Save.
 *   3. The current state is snapshotted via captureScene() and pushed
 *      to streams.scenes jsonb.
 *
 * Apply flow:
 *   1. Host clicks "Apply" on any scene tile.
 *   2. The hook fan-outs to overlay/ticker/music broadcasts.
 *   3. Viewers receive the standard stream-overlay / stream-ticker
 *      events as if the host had typed the values manually.
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
    <Card>
      <CardHeader className="pb-3 border-b">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <Layers className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold">Scenes</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Saved overlay + ticker + music presets.
              </p>
            </div>
          </div>
          {!adding && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="h-7 px-2">
              <Plus className="w-3.5 h-3.5 mr-1" />
              New
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-3 flex flex-col gap-2">
        {adding && (
          <div className="flex gap-2">
            <Input
              autoFocus
              placeholder="Scene name (e.g. Welcome, Break, Outro)"
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
              className="h-8 text-sm"
            />
            <Button size="sm" onClick={handleSave} disabled={busy} className="h-8 shrink-0">
              Save
            </Button>
          </div>
        )}

        {scenes.length === 0 && !adding ? (
          <p className="text-[11px] text-muted-foreground py-4 text-center">
            No scenes yet. Configure overlay / ticker / music, then save them as a preset for one-click recall during your show.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {scenes
              .slice()
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((s) => (
                <li
                  key={s.id}
                  className="group rounded-md border border-border bg-card hover:border-primary/40 transition-colors p-2 flex items-center gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm font-medium truncate">{s.name}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {s.overlay && (
                        <Badge variant="outline" className="h-4 px-1 text-[9px] gap-0.5">
                          <Megaphone className="w-2.5 h-2.5" /> overlay
                        </Badge>
                      )}
                      {s.ticker && (
                        <Badge variant="outline" className="h-4 px-1 text-[9px] gap-0.5">
                          <Tv className="w-2.5 h-2.5" /> ticker
                        </Badge>
                      )}
                      {s.musicUrl && (
                        <Badge variant="outline" className="h-4 px-1 text-[9px] gap-0.5">
                          <Music2 className="w-2.5 h-2.5" /> music
                        </Badge>
                      )}
                      <Badge variant="outline" className="h-4 px-1 text-[9px] capitalize">
                        {s.layout}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onApply(s)}
                    className="h-7 px-2 shrink-0"
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
                    className="h-7 px-2 shrink-0 text-muted-foreground hover:text-destructive"
                    title="Delete scene"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </li>
              ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
