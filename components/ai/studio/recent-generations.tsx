"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { AssetCardClient, type AssetCardData } from "./asset-card-client";

const DEFAULT_VISIBLE = 3;

export function RecentGenerations({ assets }: { assets: AssetCardData[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? assets : assets.slice(0, DEFAULT_VISIBLE);
  const hidden = assets.length - DEFAULT_VISIBLE;

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((asset) => (
          <AssetCardClient key={asset.id} asset={asset} />
        ))}
      </div>

      {hidden > 0 && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-1.5 text-[12px] text-muted-foreground shadow-sm hover:border-primary/40 hover:bg-muted hover:text-foreground transition-all"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                Collapse
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                See all {assets.length} generations
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
