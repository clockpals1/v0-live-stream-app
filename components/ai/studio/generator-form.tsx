"use client";

import { useState } from "react";
import {
  Sparkles,
  Copy,
  Check,
  ChevronDown,
  Loader2,
  Star,
  FileText,
  Hash,
  Captions,
  ListOrdered,
  Zap,
  CircleDollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskType =
  | "script_gen"
  | "caption_gen"
  | "hashtag_gen"
  | "title_gen"
  | "content_ideas"
  | "affiliate_campaign"
  | "short_video_script";

type Platform = "youtube" | "tiktok" | "instagram" | "twitter" | "linkedin" | "generic";
type Tone = "professional" | "casual" | "energetic" | "educational" | "inspiring" | "humorous";

interface TaskDef {
  type: TaskType;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  placeholders: string[];
  showPlatform: boolean;
  affiliateMode?: boolean;
}

const TASKS: TaskDef[] = [
  {
    type: "script_gen",
    label: "Stream Script",
    description: "Hook, talking points, and CTA for your live stream",
    icon: FileText,
    placeholders: [
      "How to grow on TikTok as a beginner in 2026",
      "My morning fitness routine for busy parents",
      "Reviewing the top 5 AI tools for creators",
    ],
    showPlatform: false,
  },
  {
    type: "caption_gen",
    label: "Social Captions",
    description: "3 caption variants optimised for your platform",
    icon: Captions,
    placeholders: [
      "Behind-the-scenes of my content creation setup",
      "Just launched my new course — here's what's inside",
      "My biggest lesson from 100 livestreams",
    ],
    showPlatform: true,
  },
  {
    type: "hashtag_gen",
    label: "Hashtag Pack",
    description: "Optimised hashtags for maximum reach",
    icon: Hash,
    placeholders: [
      "Digital marketing for small businesses",
      "Home workout and fitness motivation",
      "Personal finance tips for millennials",
    ],
    showPlatform: true,
  },
  {
    type: "title_gen",
    label: "Title Variants",
    description: "5 high-click title options for your content",
    icon: ListOrdered,
    placeholders: [
      "Tutorial: building a personal brand from scratch",
      "Interview with a 7-figure creator",
      "Day in my life as a full-time content creator",
    ],
    showPlatform: true,
  },
  {
    type: "content_ideas",
    label: "Content Ideas",
    description: "7 strategic content ideas for your niche",
    icon: Sparkles,
    placeholders: [
      "Mindset and productivity",
      "Crypto and Web3 for beginners",
      "Sustainable fashion and eco living",
    ],
    showPlatform: false,
  },
  {
    type: "short_video_script",
    label: "Short Video Script",
    description: "60-second script for TikTok or Reels",
    icon: Zap,
    placeholders: [
      "3 mistakes new creators make",
      "How I gained 10k followers in 30 days",
      "The simple habit that changed my productivity",
    ],
    showPlatform: false,
  },
  {
    type: "affiliate_campaign",
    label: "Affiliate Campaign",
    description: "Full campaign copy pack for a product",
    icon: CircleDollarSign,
    placeholders: [
      "VPN service for remote workers",
      "Online course platform for educators",
      "Fitness supplement brand",
    ],
    showPlatform: false,
    affiliateMode: true,
  },
];

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "youtube", label: "YouTube" },
  { value: "twitter", label: "Twitter / X" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "generic", label: "Generic" },
];

const TONES: { value: Tone; label: string }[] = [
  { value: "casual", label: "Casual" },
  { value: "energetic", label: "Energetic" },
  { value: "professional", label: "Professional" },
  { value: "educational", label: "Educational" },
  { value: "inspiring", label: "Inspiring" },
  { value: "humorous", label: "Humorous" },
];

// ─── Main Component ───────────────────────────────────────────────────────────

interface GeneratorFormProps {
  hostId: string;
}

export function GeneratorForm({ hostId: _ }: GeneratorFormProps) {
  const [activeTask, setActiveTask] = useState<TaskDef>(TASKS[0]);
  const [topic, setTopic] = useState("");
  const [niche, setNiche] = useState("");
  const [platform, setPlatform] = useState<Platform>("generic");
  const [tone, setTone] = useState<Tone>("casual");
  const [productName, setProductName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  const placeholder =
    activeTask.placeholders[Math.floor(Date.now() / 10000) % activeTask.placeholders.length];

  async function handleGenerate() {
    if (!topic.trim()) return;
    setLoading(true);
    setResult(null);
    setError(null);

    const input: Record<string, unknown> = {
      topic: topic.trim(),
      platform,
      tone,
      niche: niche.trim() || undefined,
    };
    if (activeTask.affiliateMode && productName.trim()) {
      input.productName = productName.trim();
    }

    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskType: activeTask.type, input }),
      });
      const data = (await res.json()) as { ok?: boolean; content?: string; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Generation failed. Please try again.");
      } else {
        setResult(data.content ?? "");
      }
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* ─── Left: controls ───────────────────────────────────────────── */}
      <div className="lg:col-span-2 space-y-4">
        {/* Task picker */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Task
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setTaskOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm font-medium"
            >
              <span className="flex items-center gap-2">
                <activeTask.icon className="h-4 w-4 text-primary" />
                {activeTask.label}
              </span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", taskOpen && "rotate-180")} />
            </button>
            {taskOpen && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
                {TASKS.map((t) => (
                  <button
                    key={t.type}
                    type="button"
                    onClick={() => { setActiveTask(t); setTaskOpen(false); setResult(null); setError(null); }}
                    className={cn(
                      "flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-muted",
                      activeTask.type === t.type && "bg-primary/5 text-primary",
                    )}
                  >
                    <t.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div>
                      <div className="font-medium">{t.label}</div>
                      <div className="text-[11px] text-muted-foreground">{t.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Topic input */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {activeTask.affiliateMode ? "Product or Campaign Topic" : "Topic / Idea"}
          </label>
          <Textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={placeholder}
            rows={3}
            className="resize-none text-sm"
          />
        </div>

        {/* Affiliate: product name */}
        {activeTask.affiliateMode && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Product Name
            </label>
            <input
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="e.g. NordVPN, Skillshare, Athletic Greens"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        )}

        {/* Niche (optional) */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Your Niche <span className="text-muted-foreground/60 normal-case font-normal">(optional)</span>
          </label>
          <input
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            placeholder="e.g. fitness, personal finance, tech reviews"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        {/* Platform + Tone */}
        <div className="grid grid-cols-2 gap-3">
          {activeTask.showPlatform && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Platform
              </label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as Platform)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          )}
          <div className={activeTask.showPlatform ? "" : "col-span-2"}>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Tone
            </label>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value as Tone)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {TONES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Generate button */}
        <Button
          onClick={handleGenerate}
          disabled={loading || !topic.trim()}
          className="w-full gap-2"
          size="lg"
        >
          {loading ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
          ) : (
            <><Sparkles className="h-4 w-4" /> Generate</>
          )}
        </Button>
      </div>

      {/* ─── Right: result ────────────────────────────────────────────── */}
      <div className="lg:col-span-3">
        <div className="flex h-full flex-col rounded-xl border border-border bg-background">
          {/* Result header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <activeTask.icon className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{activeTask.label}</span>
              {result && (
                <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal text-emerald-600 border-emerald-300">
                  Ready
                </Badge>
              )}
            </div>
            {result && (
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleCopy}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy all"}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                  <Star className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          {/* Result body */}
          <div className="flex-1 overflow-y-auto p-4">
            {!result && !loading && !error && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center py-12">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">Ready to generate</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Fill in your topic and hit Generate — results appear here instantly.
                  </p>
                </div>
              </div>
            )}

            {loading && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center py-12">
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Writing your {activeTask.label.toLowerCase()}…
                </p>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <p className="text-sm text-destructive font-medium">Generation failed</p>
                <p className="mt-1 text-xs text-muted-foreground">{error}</p>
              </div>
            )}

            {result && (
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
                {result}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
