"use client";

import { Button } from "@/components/ui/button";
import { Film } from "lucide-react";
import { TYPO } from "@/lib/control-room/styles";

/**
 * Post-stream notice — sits directly under the program preview when
 * the stream has ended AND the section recorder produced at least one
 * ready section. Click jumps the right-rail to the Replay tab.
 */
export function PostStreamBanner({
  count,
  onOpenReplay,
}: {
  count: number;
  onOpenReplay: () => void;
}) {
  if (count <= 0) return null;
  return (
    <div className="rounded-xl p-4 ring-1 ring-primary/30 bg-gradient-to-br from-primary/10 via-primary/[0.04] to-transparent shadow-sm flex items-center gap-3 flex-wrap">
      <span className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary to-primary/70 ring-1 ring-primary/40 text-primary-foreground flex items-center justify-center shrink-0 shadow-sm shadow-primary/20">
        <Film className="w-4 h-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={TYPO.title}>
          {count} recording{count === 1 ? "" : "s"} ready
        </p>
        <p className={`${TYPO.sub} mt-0.5`}>
          Download to your device or save to your cloud Replay Library — your plan decides which options unlock.
        </p>
      </div>
      <Button size="sm" onClick={onOpenReplay} className="shrink-0 h-8">
        <Film className="w-3.5 h-3.5 mr-1.5" />
        Open Replay
      </Button>
    </div>
  );
}
