"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Image as ImageIcon,
  Layout,
  Loader2,
  Palette,
  Sparkles,
  Trash2,
} from "lucide-react";
import { LockedCard } from "@/components/host/control-room/locked-card";
import { DeckHeader } from "@/components/host/control-room/deck-header";
import { ICON_CHIP, SURFACE, TYPO } from "@/lib/control-room/styles";
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
 * rendered regardless of plan. Locked features show an upsell card
 * (LockedCard) instead of disappearing — the host always knows what
 * they could unlock.
 */
export function BrandingDeck({ streamId, plan, branding, update }: Props) {
  // Feature keys are registered in lib/billing/plans.ts FEATURE_KEYS
  // and surfaced in the admin plan editor's "Live control room"
  // category. Admin synthetic plan flips them all on; host plans
  // inherit whatever the admin toggled per plan.
  const canWatermark = featureEnabled(plan, "live_watermark");
  const canBrandedPage = featureEnabled(plan, "live_branded_page");
  const canLayouts = featureEnabled(plan, "live_premium_layouts");

  return (
    <div className="flex flex-col gap-3.5">
      <DeckHeader
        icon={Sparkles}
        title="Branding"
        description="Make your stream feel like your brand. Premium controls unlock with paid plans."
      />

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

function SubCard({
  icon: Icon,
  title,
  description,
  active,
  children,
}: {
  icon: typeof Sparkles;
  title: string;
  description: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`${SURFACE.inline} p-3.5`}>
      <div className="flex items-center gap-2.5 mb-3">
        <span className={ICON_CHIP.primary}>
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={TYPO.title}>{title}</p>
          <p className={`${TYPO.sub} truncate`}>{description}</p>
        </div>
        {active && (
          <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30 shrink-0">
            Active
          </span>
        )}
      </div>
      {children}
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
    <SubCard
      icon={ImageIcon}
      title="Logo watermark"
      description="Shown in the corner of your live preview."
      active={!!watermarkUrl}
    >
      <div className="flex flex-col gap-3">
        {watermarkUrl ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={watermarkUrl}
              alt="Current watermark"
              className="h-10 w-auto rounded ring-1 ring-border bg-muted/30"
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
                {uploading && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
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
          <span className={TYPO.label}>Position</span>
          {(["tl", "tr", "bl", "br"] as WatermarkPosition[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange({ watermarkPosition: p })}
              className={`h-7 px-2.5 rounded-md text-[11px] font-medium ring-1 transition-all ${
                position === p
                  ? "ring-primary/60 ring-2 bg-primary/10 text-primary"
                  : "ring-border bg-background hover:ring-foreground/30"
              }`}
            >
              {POS_LABEL[p]}
            </button>
          ))}
        </div>
      </div>
    </SubCard>
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
    <SubCard
      icon={Palette}
      title="Branded watch page"
      description="Theme + accent colour applied to your public watch URL."
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={TYPO.label}>Theme</span>
          {(["default", "minimal", "branded"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onChange({ watchPageTheme: t })}
              className={`h-7 px-2.5 rounded-md text-[11px] capitalize font-medium ring-1 transition-all ${
                theme === t
                  ? "ring-primary/60 ring-2 bg-primary/10 text-primary"
                  : "ring-border bg-background hover:ring-foreground/30"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <span className={TYPO.label}>Accent</span>
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
      </div>
    </SubCard>
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
    <SubCard
      icon={Layout}
      title="Premium layouts"
      description="Composition for the active program output."
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        {(["solo", "split", "pip"] as SceneLayout[]).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => onChange({ layout: l })}
            className={`h-9 px-3 rounded-md text-[12px] capitalize gap-1.5 inline-flex items-center font-medium ring-1 transition-all ${
              layout === l
                ? "ring-primary/60 ring-2 bg-primary/10 text-primary"
                : "ring-border bg-background hover:ring-foreground/30"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            {LAYOUT_LABEL[l]}
          </button>
        ))}
      </div>
    </SubCard>
  );
}
