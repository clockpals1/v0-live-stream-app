"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ImageIcon,
  Loader2,
  Palette,
  Sparkles,
  Trash2,
  Layout,
} from "lucide-react";
import { LockedCard } from "@/components/host/control-room/locked-card";
import { featureEnabled } from "@/lib/billing/plans";
import type { BillingPlan } from "@/lib/billing/plans";
import type {
  BrandingConfig,
  WatermarkPosition,
  SceneLayout,
} from "@/lib/control-room/types";

interface Props {
  streamId: string;
  plan: BillingPlan | null;
  branding: BrandingConfig;
  update: (patch: Partial<BrandingConfig>) => void;
}

const POS_LABEL: Record<WatermarkPosition, string> = {
  tl: "Top Left",
  tr: "Top Right",
  bl: "Bottom Left",
  br: "Bottom Right",
};

const LAYOUT_LABEL: Record<SceneLayout, string> = {
  solo: "Solo",
  split: "Split",
  pip: "PiP",
};

/**
 * Branding deck — premium creator-tools surface. Every card is
 * rendered regardless of plan; locked features show a clear upsell
 * card so the host always knows what they could unlock without
 * leaving the page.
 *
 * Feature keys consulted:
 *   - logo_watermark        → Watermark uploader + position picker
 *   - branded_watch_page    → Watch-page theme + accent colour
 *   - premium_layouts       → Layout chooser (solo / split / pip)
 *
 * Branding writes go through the parent `update()` setter which
 * persists to streams.branding (jsonb). Watermark uploads use the
 * existing `stream-overlays` Supabase Storage bucket — same bucket
 * used by overlay images so we don't need a separate policy.
 */
export function BrandingDeck({ streamId, plan, branding, update }: Props) {
  const canWatermark = featureEnabled(plan, "logo_watermark");
  const canBrandedPage = featureEnabled(plan, "branded_watch_page");
  const canLayouts = featureEnabled(plan, "premium_layouts");

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-muted-foreground -mt-1">
        Make your stream feel like your brand. Premium controls unlock with paid plans.
      </p>

      {canWatermark ? (
        <WatermarkCard
          streamId={streamId}
          watermarkUrl={branding.watermarkUrl ?? null}
          position={branding.watermarkPosition ?? "tr"}
          onChange={(patch) => update(patch)}
        />
      ) : (
        <LockedCard
          title="Logo watermark"
          description="Place your logo in any corner of your stream preview. Your brand mark, always on."
        />
      )}

      {canBrandedPage ? (
        <BrandedPageCard
          theme={branding.watchPageTheme ?? "default"}
          accent={branding.accentColor ?? "#1d4ed8"}
          onChange={(patch) => update(patch)}
        />
      ) : (
        <LockedCard
          title="Branded watch page"
          description="Custom theme and accent colour on your public watch page. Stand out from the crowd."
        />
      )}

      {canLayouts ? (
        <LayoutCard
          layout={branding.layout ?? "solo"}
          onChange={(patch) => update(patch)}
        />
      ) : (
        <LockedCard
          title="Premium layouts"
          description="Switch between Solo, Split-screen, and Picture-in-Picture compositions during your show."
        />
      )}
    </div>
  );
}

function WatermarkCard({
  streamId,
  watermarkUrl,
  position,
  onChange,
}: {
  streamId: string;
  watermarkUrl: string | null;
  position: WatermarkPosition;
  onChange: (patch: Partial<BrandingConfig>) => void;
}) {
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const onFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file (PNG with transparency works best).");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Watermark must be under 2 MB.");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
      const path = `${streamId}/watermark/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("stream-overlays")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("stream-overlays").getPublicUrl(path);
      onChange({ watermarkUrl: data.publicUrl });
      toast.success("Watermark applied");
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 border-b">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
              <ImageIcon className="w-4 h-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Logo watermark</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Shown in the corner of your live preview.
              </p>
            </div>
          </div>
          {watermarkUrl && (
            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[10px] h-5 px-1.5">
              ACTIVE
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-3">
        {watermarkUrl ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={watermarkUrl}
              alt="Current watermark"
              className="h-10 w-auto rounded border border-border bg-muted/30"
            />
            <div className="flex items-center gap-1.5 ml-auto">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onChange({ watermarkUrl: null })}
                className="h-7 text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                Remove
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => inputRef.current?.click()}
                className="h-7"
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : null}
                Replace
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="h-9"
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <ImageIcon className="w-4 h-4 mr-2" />
            )}
            Upload watermark (PNG, ≤ 2 MB)
          </Button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = "";
          }}
        />
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Position:</span>
          {(["tl", "tr", "bl", "br"] as WatermarkPosition[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange({ watermarkPosition: p })}
              className={`h-7 px-2.5 rounded-md border text-xs transition-all ${
                position === p
                  ? "border-primary ring-2 ring-primary/30 bg-primary/10"
                  : "border-border hover:border-foreground/30"
              }`}
            >
              {POS_LABEL[p]}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function BrandedPageCard({
  theme,
  accent,
  onChange,
}: {
  theme: "default" | "minimal" | "branded";
  accent: string;
  onChange: (patch: Partial<BrandingConfig>) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3 border-b">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
            <Palette className="w-4 h-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold">Branded watch page</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Theme + accent colour applied to your public watch URL.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Theme:</span>
          {(["default", "minimal", "branded"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onChange({ watchPageTheme: t })}
              className={`h-7 px-2.5 rounded-md border text-xs capitalize transition-all ${
                theme === t
                  ? "border-primary ring-2 ring-primary/30 bg-primary/10"
                  : "border-border hover:border-foreground/30"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Accent:</span>
          <Input
            type="color"
            value={accent}
            onChange={(e) => onChange({ accentColor: e.target.value })}
            className="h-8 w-14 p-1 cursor-pointer"
          />
          <Input
            value={accent}
            onChange={(e) => onChange({ accentColor: e.target.value })}
            className="h-8 font-mono text-xs flex-1 max-w-[120px]"
            maxLength={9}
          />
        </label>
      </CardContent>
    </Card>
  );
}

function LayoutCard({
  layout,
  onChange,
}: {
  layout: SceneLayout;
  onChange: (patch: Partial<BrandingConfig>) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3 border-b">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
            <Layout className="w-4 h-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold">Premium layouts</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Composition for the active program output.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex items-center gap-1.5 flex-wrap pt-3">
        {(["solo", "split", "pip"] as SceneLayout[]).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => onChange({ layout: l })}
            className={`h-9 px-3 rounded-md border text-xs capitalize gap-1.5 inline-flex items-center transition-all ${
              layout === l
                ? "border-primary ring-2 ring-primary/30 bg-primary/10"
                : "border-border hover:border-foreground/30"
            }`}
          >
            <Sparkles className="w-3 h-3" />
            {LAYOUT_LABEL[l]}
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
