"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Film } from "lucide-react";

/**
 * Post-stream notice card under the player. Renders only when the
 * stream has ended AND the section recorder produced at least one
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
    <Card className="border-primary/40 bg-primary/5">
      <CardContent className="p-4 flex items-center gap-3 flex-wrap">
        <div className="w-9 h-9 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
          <Film className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {count} recording{count === 1 ? "" : "s"} ready
          </p>
          <p className="text-[11px] text-muted-foreground">
            Download to your device or save to your cloud Replay Library — your plan decides which options unlock.
          </p>
        </div>
        <Button size="sm" onClick={onOpenReplay} className="shrink-0">
          <Film className="w-4 h-4 mr-1.5" />
          Open Replay
        </Button>
      </CardContent>
    </Card>
  );
}
