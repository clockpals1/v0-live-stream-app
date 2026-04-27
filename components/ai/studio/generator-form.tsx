"use client";

import { useState } from "react";
import {
  Sparkles, Copy, Check, Loader2, Star, Video,
  Radio, Megaphone, Layers, Zap, Target,
  TrendingUp, Send, ChevronRight, RotateCcw,
  Hash, FileText, Lightbulb, Clapperboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { TaskType, Platform, Tone } from "@/lib/ai/prompts";

// ─── Types ────────────────────────────────────────────────────────────────────

type ModeId = "short_video" | "go_live" | "ad_campaign" | "content_pack";

interface SubtaskDef {
  task: TaskType;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface ModeDef {
  id: ModeId;
  label: string;
  tagline: string;
  icon: React.ComponentType<{ className?: string }>;
  accentClass: string;
  ringClass: string;
  subtasks: SubtaskDef[];
  examples: string[];
}

interface OutputSection {
  label: string;
  content: string;
}

// ─── Static data ──────────────────────────────────────────────────────────────

const MODES: ModeDef[] = [
  {
    id: "short_video",
    label: "Short Video Creator",
    tagline: "Hook · Script · CTA · Caption",
    icon: Video,
    accentClass: "from-violet-500/10 to-purple-500/5 border-violet-500/20",
    ringClass: "ring-violet-500/40",
    examples: ["Fitness morning routine reel", "Product review in 30 seconds", "3 mistakes beginners make", "How I got my first 1k followers"],
    subtasks: [
      { task: "short_video_script", label: "Reel / Organic Short", description: "60s script for TikTok, Reels, or Shorts", icon: Clapperboard },
      { task: "short_video_ad",    label: "Ad / Promo Script",   description: "15–60s conversion-focused ad script",    icon: Megaphone },
      { task: "hook_variants",     label: "5 Hook Variants",     description: "Curiosity, pain, benefit, story, trend", icon: Zap },
    ],
  },
  {
    id: "go_live",
    label: "Go Live Content",
    tagline: "Script · Outline · Promo · Recap",
    icon: Radio,
    accentClass: "from-rose-500/10 to-pink-500/5 border-rose-500/20",
    ringClass: "ring-rose-500/40",
    examples: ["Creator Q&A stream script", "Product launch livestream", "Weekly community show outline", "Tutorial stream"],
    subtasks: [
      { task: "script_gen",    label: "Full Stream Script", description: "Hook, talking points, and CTA for your live", icon: FileText },
      { task: "content_ideas", label: "Stream Topic Ideas", description: "7 strategic stream concepts for your niche",  icon: Lightbulb },
    ],
  },
  {
    id: "ad_campaign",
    label: "Ad & Campaign",
    tagline: "Hook · Copy · CTA · Email subjects",
    icon: Megaphone,
    accentClass: "from-amber-500/10 to-orange-500/5 border-amber-500/20",
    ringClass: "ring-amber-500/40",
    examples: ["Affiliate: NordVPN for creators", "Course launch campaign", "Brand deal content pack", "Local business promo"],
    subtasks: [
      { task: "affiliate_campaign", label: "Affiliate Campaign Pack", description: "Hook, pitch, email subjects, CTAs, benefits", icon: TrendingUp },
      { task: "ad_copy_full",       label: "Full Ad Creative Pack",   description: "Headlines, body, CTA, objection handler",    icon: Target },
    ],
  },
  {
    id: "content_pack",
    label: "Content Pack",
    tagline: "Captions · Titles · Hashtags · Ideas",
    icon: Layers,
    accentClass: "from-sky-500/10 to-cyan-500/5 border-sky-500/20",
    ringClass: "ring-sky-500/40",
    examples: ["Personal finance tips post", "New product launch caption", "Fitness transformation content", "Tech review post"],
    subtasks: [
      { task: "caption_gen",   label: "Caption Variants (3)", description: "Platform-optimised captions for any post",    icon: FileText },
      { task: "title_gen",     label: "Title Variants (5)",   description: "Click-worthy titles for videos or articles",  icon: Lightbulb },
      { task: "hashtag_gen",   label: "Hashtag Pack",         description: "Optimised hashtags for maximum reach",        icon: Hash },
      { task: "content_ideas", label: "Content Ideas (7)",    description: "Strategic content ideas for your niche",      icon: Sparkles },
    ],
  },
];

const GHOST_SECTIONS: Partial<Record<TaskType, string[]>> = {
  short_video_script: ["HOOK (FIRST 3 SECONDS)", "CONCEPT", "SCRIPT BODY", "CTA", "CAPTION"],
  short_video_ad:     ["HOOK (3 SECONDS)", "PROBLEM", "SOLUTION", "PROOF POINT", "CTA", "VISUAL DIRECTION"],
  hook_variants:      ["CURIOSITY HOOK", "PAIN HOOK", "BENEFIT HOOK", "STORY HOOK", "TREND HOOK"],
  script_gen:         ["HOOK", "MAIN CONTENT", "CALL TO ACTION"],
  affiliate_campaign: ["HOOK", "SHORT PITCH", "EMAIL SUBJECT", "CTA", "KEY BENEFITS"],
  ad_copy_full:       ["HEADLINE", "BODY COPY", "CTA", "OBJECTION HANDLER", "SOCIAL PROOF ANGLE"],
  caption_gen:        ["CAPTION 1", "CAPTION 2", "CAPTION 3"],
};

const TONE_OPTIONS: { value: Tone; label: string }[] = [
  { value: "energetic",    label: "Energetic" },
  { value: "casual",       label: "Casual" },
  { value: "professional", label: "Professional" },
  { value: "educational",  label: "Educational" },
  { value: "inspiring",    label: "Inspiring" },
  { value: "humorous",     label: "Humorous" },
];

const PLATFORM_OPTIONS: { value: Platform; label: string }[] = [
  { value: "tiktok",    label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "youtube",   label: "YouTube" },
  { value: "twitter",   label: "Twitter / X" },
  { value: "linkedin",  label: "LinkedIn" },
  { value: "generic",   label: "General" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseSections(text: string): OutputSection[] {
  const lines = text.split("\n");
  const sections: OutputSection[] = [];
  let label = "";
  let content: string[] = [];
  for (const line of lines) {
    const match = line.match(/^([A-Z][A-Z ()\\/+\-0-9]+):\s*(.*)/);
    if (match) {
      if (label) sections.push({ label, content: content.join("\n").trim() });
      label = match[1];
      content = match[2] ? [match[2]] : [];
    } else if (label) {
      content.push(line);
    }
  }
  if (label) sections.push({ label, content: content.join("\n").trim() });
  const filled = sections.filter((s) => s.content);
  return filled.length ? filled : [{ label: "OUTPUT", content: text.trim() }];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ModeCard({ mode, active, onClick }: { mode: ModeDef; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col gap-2.5 rounded-xl border bg-gradient-to-br p-4 text-left transition-all",
        mode.accentClass,
        active ? `ring-2 ${mode.ringClass} shadow-sm` : "hover:shadow-sm",
      )}
    >
      <div className="flex items-center justify-between">
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", active ? "bg-background/90" : "bg-background/60")}>
          <mode.icon className="h-4 w-4" />
        </div>
        {active && <ChevronRight className="h-3.5 w-3.5 opacity-50" />}
      </div>
      <div>
        <p className="text-sm font-semibold leading-snug">{mode.label}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">{mode.tagline}</p>
      </div>
    </button>
  );
}

function PillSelect<T extends string>({
  label, options, value, onChange,
}: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              value === o.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function GhostRow({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/50 p-3">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">{label}</p>
      <div className="space-y-1">
        <div className="h-2.5 w-full rounded-full bg-muted/40" />
        <div className="h-2.5 w-4/5 rounded-full bg-muted/30" />
      </div>
    </div>
  );
}

function SectionBox({ section, onCopy, isCopied }: {
  section: OutputSection;
  onCopy: (label: string, content: string) => void;
  isCopied: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{section.label}</span>
        <button
          type="button"
          onClick={() => onCopy(section.label, section.content)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {isCopied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          {isCopied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="p-3 text-sm leading-relaxed whitespace-pre-wrap">{section.content}</p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function GeneratorForm({ hostId: _ }: { hostId: string }) {
  const [modeId, setModeId]             = useState<ModeId>("short_video");
  const [taskType, setTaskType]         = useState<TaskType>("short_video_script");
  const [topic, setTopic]               = useState("");
  const [niche, setNiche]               = useState("");
  const [audience, setAudience]         = useState("");
  const [platform, setPlatform]         = useState<Platform>("tiktok");
  const [tone, setTone]                 = useState<Tone>("energetic");
  const [videoLength, setVideoLength]   = useState("60");
  const [monetAngle, setMonetAngle]     = useState("organic");
  const [productName, setProductName]   = useState("");
  const [productDesc, setProductDesc]   = useState("");
  const [targetAudience, setTargetAud]  = useState("");
  const [loading, setLoading]           = useState(false);
  const [sections, setSections]         = useState<OutputSection[]>([]);
  const [rawResult, setRawResult]       = useState<string | null>(null);
  const [assetId, setAssetId]           = useState<string | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const [copiedLabel, setCopiedLabel]   = useState<string | null>(null);
  const [copiedAll, setCopiedAll]       = useState(false);
  const [starred, setStarred]           = useState(false);
  const [addingToQueue, setAddingQueue] = useState(false);

  const activeMode    = MODES.find((m) => m.id === modeId)!;
  const activeSubtask = activeMode.subtasks.find((s) => s.task === taskType) ?? activeMode.subtasks[0];
  const ghostSections = GHOST_SECTIONS[taskType] ?? [];
  const isShortVideo  = modeId === "short_video";
  const isAdCampaign  = modeId === "ad_campaign";
  const hasResult     = sections.length > 0 && !loading;

  function switchMode(mode: ModeDef) {
    setModeId(mode.id);
    setTaskType(mode.subtasks[0].task);
    setSections([]); setRawResult(null); setError(null); setStarred(false);
  }

  function switchSubtask(task: TaskType) {
    setTaskType(task);
    setSections([]); setRawResult(null); setError(null);
  }

  async function handleGenerate() {
    if (!topic.trim()) return;
    setLoading(true); setSections([]); setRawResult(null); setAssetId(null);
    setError(null); setStarred(false);

    const input: Record<string, unknown> = {
      topic: topic.trim(), platform, tone,
      niche: niche.trim() || undefined,
      audienceNote: audience.trim() || undefined,
      videoLength, monetizationAngle: monetAngle,
    };
    if (isAdCampaign) {
      input.productDescription = productDesc.trim() || undefined;
      input.productName        = productName.trim() || topic.trim();
      input.targetAudience     = targetAudience.trim() || undefined;
    }
    if (isShortVideo) {
      input.targetAudience = audience.trim() || undefined;
    }

    try {
      const res  = await fetch("/api/ai/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskType, input }),
      });
      const data = (await res.json()) as { ok?: boolean; content?: string; assetId?: string; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Generation failed. Please try again.");
      } else {
        const text = data.content ?? "";
        setRawResult(text); setSections(parseSections(text)); setAssetId(data.assetId ?? null);
      }
    } catch { setError("Network error. Please check your connection."); }
    finally  { setLoading(false); }
  }

  function copySection(label: string, content: string) {
    navigator.clipboard.writeText(content).catch(() => {});
    setCopiedLabel(label);
    setTimeout(() => setCopiedLabel(null), 2000);
  }

  function copyAll() {
    if (!rawResult) return;
    navigator.clipboard.writeText(rawResult).catch(() => {});
    setCopiedAll(true); setTimeout(() => setCopiedAll(false), 2000);
  }

  async function handleAddToQueue() {
    if (!rawResult) return;
    if (platform === "generic") {
      toast.error("Please select a specific platform", {
        description: "Choose TikTok, Instagram, YouTube, etc. before adding to the queue.",
      });
      return;
    }
    setAddingQueue(true);
    try {
      const res = await fetch("/api/ai/publish/queue", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: topic.slice(0, 100),
          body: sections[0]?.content ?? rawResult.slice(0, 500),
          platform: platform === "generic" ? undefined : platform,
          asset_id: assetId,
        }),
      });
      if (res.ok) {
        toast.success("Added to publish queue", {
          description: "Open the Publishing Hub to schedule or post it.",
          action: { label: "Open Queue", onClick: () => { window.location.href = "/ai/publish"; } },
        });
      } else {
        const d = (await res.json()) as { error?: string };
        toast.error(d.error ?? "Failed to add to queue");
      }
    } catch { toast.error("Network error"); }
    finally  { setAddingQueue(false); }
  }

  const generateLabel: Partial<Record<TaskType, string>> = {
    short_video_script: "Write Script",   short_video_ad:     "Write Ad",
    hook_variants:      "Generate Hooks", script_gen:         "Write Script",
    content_ideas:      "Generate Ideas", affiliate_campaign: "Build Campaign",
    ad_copy_full:       "Build Ad Pack",  caption_gen:        "Write Captions",
    title_gen:          "Write Titles",   hashtag_gen:        "Generate Hashtags",
  };

  return (
    <div className="space-y-4">
      {/* ── Mode Cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {MODES.map((m) => (
          <ModeCard key={m.id} mode={m} active={modeId === m.id} onClick={() => switchMode(m)} />
        ))}
      </div>

      {/* ── Workspace ──────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-5">

        {/* Left: Creative Context ─────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-3.5">

          {/* Output type selector */}
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Output type</p>
            <div className="flex flex-col gap-1">
              {activeMode.subtasks.map((st) => (
                <button
                  key={st.task} type="button" onClick={() => switchSubtask(st.task)}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    taskType === st.task
                      ? "border-primary/50 bg-primary/5 text-foreground"
                      : "border-border bg-background hover:bg-muted/40 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <st.icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", taskType === st.task ? "text-primary" : "")} />
                  <div>
                    <p className="text-xs font-medium leading-snug">{st.label}</p>
                    <p className="text-[11px] leading-snug opacity-70">{st.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-border" />

          {/* Topic */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {isAdCampaign ? "Campaign topic / product" : "Topic or concept"}
            </label>
            <Textarea
              value={topic} onChange={(e) => setTopic(e.target.value)}
              placeholder={activeMode.examples[0]} rows={3} className="resize-none text-sm"
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {activeMode.examples.map((ex) => (
                <button
                  key={ex} type="button"
                  onClick={() => { setTopic(ex); setSections([]); setRawResult(null); setError(null); }}
                  className="rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          {/* Ad/Campaign extra fields */}
          {isAdCampaign && (
            <>
              <div>
                <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Product / brand name</label>
                <input value={productName} onChange={(e) => setProductName(e.target.value)}
                  placeholder="e.g. NordVPN, Skillshare, Athletic Greens"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Short description <span className="font-normal opacity-60">(optional)</span>
                </label>
                <input value={productDesc} onChange={(e) => setProductDesc(e.target.value)}
                  placeholder="What it does, key benefit, price point…"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Target audience <span className="font-normal opacity-60">(optional)</span>
                </label>
                <input value={targetAudience} onChange={(e) => setTargetAud(e.target.value)}
                  placeholder="e.g. small business owners, fitness beginners 25–35"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            </>
          )}

          {/* Niche */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Your niche <span className="font-normal opacity-60">(optional)</span>
            </label>
            <input value={niche} onChange={(e) => setNiche(e.target.value)}
              placeholder="e.g. fitness, personal finance, tech reviews"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>

          {/* Audience (short video) */}
          {isShortVideo && (
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Target audience <span className="font-normal opacity-60">(optional)</span>
              </label>
              <input value={audience} onChange={(e) => setAudience(e.target.value)}
                placeholder="e.g. fitness beginners, entrepreneurs, Gen Z"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          )}

          {/* Video length */}
          {isShortVideo && (
            <PillSelect
              label="Video length"
              options={[{ value: "15", label: "15 sec" }, { value: "30", label: "30 sec" }, { value: "60", label: "60 sec" }]}
              value={videoLength} onChange={setVideoLength}
            />
          )}

          {/* Platform */}
          <PillSelect
            label="Platform"
            options={PLATFORM_OPTIONS.filter((p) => isShortVideo ? ["tiktok","instagram","youtube"].includes(p.value) : true)}
            value={platform} onChange={setPlatform}
          />

          {/* Tone */}
          <PillSelect label="Tone" options={TONE_OPTIONS} value={tone} onChange={setTone} />

          {/* Monetization angle (short video only) */}
          {isShortVideo && (
            <PillSelect
              label="Monetization angle"
              options={[
                { value: "organic",   label: "Organic" },
                { value: "affiliate", label: "Affiliate" },
                { value: "product",   label: "Product promo" },
                { value: "brand",     label: "Brand deal" },
              ]}
              value={monetAngle} onChange={setMonetAngle}
            />
          )}

          {/* Generate button */}
          <Button onClick={handleGenerate} disabled={loading || !topic.trim()} className="w-full gap-2" size="lg">
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin" />Generating…</>
              : <><Sparkles className="h-4 w-4" />{generateLabel[taskType] ?? "Generate"}</>}
          </Button>
        </div>

        {/* Right: Result Workspace ─────────────────────────────────── */}
        <div className="lg:col-span-3 flex flex-col rounded-xl border border-border bg-muted/10 overflow-hidden">

          {/* Workspace toolbar */}
          <div className="flex items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <activeSubtask.icon className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="text-sm font-medium truncate">{activeSubtask.label}</span>
              {hasResult && (
                <Badge className="shrink-0 border-0 bg-emerald-500/15 text-[10px] text-emerald-700 dark:text-emerald-300">
                  Ready
                </Badge>
              )}
            </div>
            {hasResult && (
              <div className="flex shrink-0 items-center gap-0.5">
                <button type="button" onClick={copyAll}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                  {copiedAll ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  {copiedAll ? "Copied" : "Copy all"}
                </button>
                <button type="button"
                  onClick={() => { setStarred(true); toast.success("Saved to library"); }}
                  className={cn("rounded-md p-1.5 transition-colors", starred ? "text-amber-500" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                  <Star className={cn("h-3.5 w-3.5", starred && "fill-current")} />
                </button>
                <button type="button" onClick={handleAddToQueue} disabled={addingToQueue}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                  {addingToQueue ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  Queue
                </button>
                <button type="button"
                  onClick={() => { setSections([]); setRawResult(null); setError(null); setStarred(false); }}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Workspace body */}
          <div className="flex-1 overflow-y-auto p-4">

            {/* Empty: ghost preview */}
            {!sections.length && !loading && !error && (
              <div className="space-y-3">
                <div className="rounded-lg border border-dashed border-border/60 bg-background/60 px-4 py-3 text-center">
                  <p className="text-sm font-medium text-muted-foreground">
                    {activeSubtask.label} will appear here
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground/70">{activeSubtask.description}</p>
                </div>
                {ghostSections.length > 0 && (
                  <div className="space-y-2">
                    {ghostSections.map((s) => <GhostRow key={s} label={s} />)}
                  </div>
                )}
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div className="space-y-3">
                <div className="flex items-center gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Writing your {activeSubtask.label.toLowerCase()}…</p>
                </div>
                {ghostSections.map((s) => (
                  <div key={s} className="animate-pulse rounded-lg border border-dashed border-border/50 p-3">
                    <div className="mb-2 h-2 w-24 rounded-full bg-muted/50" />
                    <div className="space-y-1.5">
                      <div className="h-2.5 w-full rounded-full bg-muted/40" />
                      <div className="h-2.5 w-3/4 rounded-full bg-muted/30" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Error */}
            {error && !loading && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <p className="text-sm font-medium text-destructive">Generation failed</p>
                <p className="mt-1 text-xs text-muted-foreground">{error}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={handleGenerate}>Try again</Button>
              </div>
            )}

            {/* Result: structured sections */}
            {sections.length > 0 && !loading && (
              <div className="space-y-2.5">
                {sections.map((sec) => (
                  <SectionBox
                    key={sec.label} section={sec}
                    onCopy={copySection} isCopied={copiedLabel === sec.label}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
