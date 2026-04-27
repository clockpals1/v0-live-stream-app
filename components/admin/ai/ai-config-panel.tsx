"use client";

import { useState, useTransition } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  Save,
  Check,
  Circle,
  KeyRound,
  Sparkles,
  ImageIcon,
  Video,
  Music,
  Bot,
  ExternalLink,
} from "lucide-react";
import type { RedactedAiConfig, AiConfigPatch } from "@/lib/ai/config";
import { cn } from "@/lib/utils";

/**
 * Admin panel — AI provider API keys + agent settings.
 *
 * Follows the exact same pattern as StripeConfigPanel:
 *   - Fields show StatusPill (set / not set / pending / will-clear)
 *   - Reveal/hide toggle on secret key fields
 *   - Save/Discard flow with optimistic updates
 *   - Inline error, never toast-only
 *   - Tabs split by provider category
 */

// ─── Types ─────────────────────────────────────────────────────────────────

type DraftKey = keyof AiConfigPatch;

interface ProviderDef {
  id: string;
  label: string;
  tier: "free" | "premium" | "freemium";
  keyField: DraftKey;
  enabledField: DraftKey;
  modelField?: DraftKey;
  defaultModel?: string;
  placeholder: string;
  docsUrl: string;
  description: string;
}

// ─── Provider registry ─────────────────────────────────────────────────────

const TEXT_PROVIDERS: ProviderDef[] = [
  {
    id: "groq",
    label: "Groq",
    tier: "free",
    keyField: "groq_api_key",
    enabledField: "groq_enabled",
    modelField: "groq_default_model",
    defaultModel: "llama-3.1-70b-versatile",
    placeholder: "gsk_…",
    docsUrl: "https://console.groq.com",
    description: "Llama 3.1 70B/8B, Mixtral 8x7B, Gemma 2. 14,400 req/day free.",
  },
  {
    id: "google_gemini",
    label: "Google Gemini",
    tier: "free",
    keyField: "google_gemini_api_key",
    enabledField: "google_gemini_enabled",
    modelField: "google_gemini_model",
    defaultModel: "gemini-1.5-flash",
    placeholder: "AIza…",
    docsUrl: "https://aistudio.google.com",
    description: "Gemini 1.5 Flash — free tier, 15 RPM. Pro unlocked with billing.",
  },
  {
    id: "mistral",
    label: "Mistral AI",
    tier: "free",
    keyField: "mistral_api_key",
    enabledField: "mistral_enabled",
    modelField: "mistral_default_model",
    defaultModel: "open-mistral-7b",
    placeholder: "…",
    docsUrl: "https://console.mistral.ai",
    description: "open-mistral-7b free tier. Mistral Large on paid plans.",
  },
  {
    id: "together",
    label: "Together.ai",
    tier: "freemium",
    keyField: "together_api_key",
    enabledField: "together_enabled",
    modelField: "together_default_model",
    defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
    placeholder: "…",
    docsUrl: "https://api.together.xyz",
    description: "Llama 3.1 70B Turbo, Mixtral, Qwen. Free credits on signup.",
  },
  {
    id: "nvidia_nim",
    label: "NVIDIA NIM",
    tier: "freemium",
    keyField: "nvidia_api_key",
    enabledField: "nvidia_enabled",
    modelField: "nvidia_default_model",
    defaultModel: "meta/llama-3.1-70b-instruct",
    placeholder: "nvapi-…",
    docsUrl: "https://build.nvidia.com",
    description: "Llama 3.1 405B, Mistral Large. ~$100 free credits on signup.",
  },
  {
    id: "openai",
    label: "OpenAI",
    tier: "premium",
    keyField: "openai_api_key",
    enabledField: "openai_enabled",
    modelField: "openai_default_model",
    defaultModel: "gpt-4o-mini",
    placeholder: "sk-…",
    docsUrl: "https://platform.openai.com",
    description: "GPT-4o Mini (cheap), GPT-4o (quality). Pay-per-token.",
  },
];

const IMAGE_PROVIDERS: ProviderDef[] = [
  {
    id: "huggingface",
    label: "HuggingFace",
    tier: "free",
    keyField: "huggingface_api_key",
    enabledField: "huggingface_enabled",
    placeholder: "hf_…",
    docsUrl: "https://huggingface.co/settings/tokens",
    description: "SDXL, FLUX.1, Kandinsky, MusicGen, CogVideoX. Free inference API.",
  },
  {
    id: "replicate",
    label: "Replicate",
    tier: "premium",
    keyField: "replicate_api_key",
    enabledField: "replicate_enabled",
    placeholder: "r8_…",
    docsUrl: "https://replicate.com",
    description: "Any model: Wan2.1, SDXL, MusicGen, audio. Pay-per-run.",
  },
  {
    id: "stability",
    label: "Stability AI",
    tier: "premium",
    keyField: "stability_api_key",
    enabledField: "stability_enabled",
    placeholder: "sk-…",
    docsUrl: "https://platform.stability.ai",
    description: "Stable Diffusion 3 Ultra, SDXL. High-quality thumbnails.",
  },
];

const VIDEO_PROVIDERS: ProviderDef[] = [
  {
    id: "huggingface_video",
    label: "HuggingFace (CogVideoX / LTX-Video)",
    tier: "free",
    keyField: "huggingface_api_key",
    enabledField: "huggingface_enabled",
    placeholder: "hf_… (shared with Image tab)",
    docsUrl: "https://huggingface.co/spaces/THUDM/CogVideoX",
    description: "Free video generation via HuggingFace Inference API. Slow queue.",
  },
  {
    id: "replicate_video",
    label: "Replicate (Wan2.1 / AnimateDiff)",
    tier: "premium",
    keyField: "replicate_api_key",
    enabledField: "replicate_enabled",
    placeholder: "r8_… (shared with Image tab)",
    docsUrl: "https://replicate.com/models",
    description: "Pay-per-run video models. Wan2.1 is highest quality open model.",
  },
  {
    id: "runway",
    label: "Runway ML (Gen-3 Alpha)",
    tier: "premium",
    keyField: "runway_api_key",
    enabledField: "runway_enabled",
    placeholder: "…",
    docsUrl: "https://dev.runwayml.com",
    description: "Gen-3 Alpha Turbo — professional video generation. $15/month+.",
  },
];

const AUDIO_PROVIDERS: ProviderDef[] = [
  {
    id: "groq_whisper",
    label: "Groq Whisper (transcription)",
    tier: "free",
    keyField: "groq_api_key",
    enabledField: "groq_enabled",
    placeholder: "gsk_… (shared with Text tab)",
    docsUrl: "https://console.groq.com",
    description: "whisper-large-v3 via Groq — fastest free transcription. ~189× real-time.",
  },
  {
    id: "huggingface_music",
    label: "HuggingFace MusicGen",
    tier: "free",
    keyField: "huggingface_api_key",
    enabledField: "huggingface_enabled",
    placeholder: "hf_… (shared with Image tab)",
    docsUrl: "https://huggingface.co/facebook/musicgen-large",
    description: "Meta MusicGen — AI music from text prompts, free via HuggingFace.",
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs (TTS)",
    tier: "freemium",
    keyField: "elevenlabs_api_key",
    enabledField: "elevenlabs_enabled",
    placeholder: "…",
    docsUrl: "https://elevenlabs.io",
    description: "Text-to-speech. Free tier: 10,000 chars/month. Human-quality voices.",
  },
  {
    id: "deepgram",
    label: "Deepgram (transcription)",
    tier: "freemium",
    keyField: "deepgram_api_key",
    enabledField: "deepgram_enabled",
    placeholder: "…",
    docsUrl: "https://deepgram.com",
    description: "nova-2 transcription. Free $200 credit on signup.",
  },
];

// ─── Component ─────────────────────────────────────────────────────────────

export function AiConfigPanel({
  initial,
}: {
  initial: RedactedAiConfig;
}) {
  const [config, setConfig] = useState<RedactedAiConfig>(initial);
  const [drafts, setDrafts] = useState<Partial<Record<DraftKey, unknown>>>({});
  const [reveal, setReveal] = useState<Partial<Record<string, boolean>>>({});
  const [pending, startTransition] = useTransition();
  const [inlineError, setInlineError] = useState<string | null>(null);

  const isDirty = Object.keys(drafts).length > 0;

  function setDraft(key: DraftKey, value: unknown) {
    setDrafts((p) => ({ ...p, [key]: value }));
  }

  async function patchConfig(body: Partial<Record<DraftKey, unknown>>) {
    setInlineError(null);
    const res = await fetch("/api/admin/ai-config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { config?: RedactedAiConfig; error?: string };
    if (!res.ok || !json.config) throw new Error(json.error ?? "Save failed");
    setConfig(json.config);
  }

  function onSave() {
    if (!isDirty) return;
    startTransition(async () => {
      try {
        await patchConfig(drafts);
        setDrafts({});
        toast.success("AI configuration saved.");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Save failed.";
        setInlineError(msg);
        toast.error(msg);
      }
    });
  }

  function renderProvider(def: ProviderDef, showModel = true) {
    const keyDraft = drafts[def.keyField] as string | undefined;
    const isSet = (config[`${def.id.replace("_video", "").replace("_whisper", "").replace("_music", "")}_api_key_set` as keyof RedactedAiConfig] as boolean | undefined) ??
      !!(config[`${def.keyField.replace("_api_key", "")}_api_key_set` as keyof RedactedAiConfig]);
    const tail = config[`${def.keyField.replace("_api_key", "")}_api_key_tail` as keyof RedactedAiConfig] as string | null ?? null;
    const isEnabled = drafts[def.enabledField] !== undefined
      ? (drafts[def.enabledField] as boolean)
      : (config[`${def.enabledField.replace("_enabled", "")}_enabled` as keyof RedactedAiConfig] as boolean | undefined) ?? false;

    const willChange = keyDraft !== undefined && keyDraft !== "";
    const willClear = keyDraft === "";
    const showField = reveal[def.keyField] ?? false;

    const tierColors: Record<string, string> = {
      free: "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/50 dark:border-emerald-800",
      freemium: "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/50 dark:border-amber-800",
      premium: "text-violet-700 bg-violet-50 border-violet-200 dark:text-violet-300 dark:bg-violet-950/50 dark:border-violet-800",
    };

    const modelDraft = def.modelField ? (drafts[def.modelField] as string | undefined) : undefined;
    const currentModel = def.modelField
      ? (config[def.modelField as keyof RedactedAiConfig] as string | undefined) ?? def.defaultModel ?? ""
      : "";

    return (
      <div key={def.id} className="rounded-lg border border-border bg-card p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{def.label}</span>
              <span className={cn("text-[10px] border rounded-full px-1.5 py-0.5 font-medium uppercase tracking-wider", tierColors[def.tier])}>
                {def.tier === "freemium" ? "free credits" : def.tier}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">{def.description}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={def.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground"
              aria-label={`${def.label} docs`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <Switch
              checked={isEnabled}
              onCheckedChange={(v) => setDraft(def.enabledField, v)}
              disabled={!isSet && !willChange}
              aria-label={`Enable ${def.label}`}
            />
          </div>
        </div>

        {/* API key field — hide if it's a "shared key" hint entry */}
        {!def.placeholder.includes("(shared") && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">API Key</Label>
              <StatusPill
                tone={willChange ? "pending" : willClear ? "warning" : isSet ? "ok" : "muted"}
              >
                {willChange ? "Pending" : willClear ? "Will clear" : isSet ? (tail ? `…${tail}` : "Saved") : "Not set"}
              </StatusPill>
            </div>
            <div className="flex gap-2">
              <Input
                type={showField ? "text" : "password"}
                placeholder={def.placeholder}
                value={(keyDraft as string) ?? ""}
                onChange={(e) => setDraft(def.keyField, e.target.value)}
                className={cn(
                  "font-mono text-sm h-8",
                  (keyDraft !== undefined) && "border-amber-400 focus-visible:ring-amber-300/50 dark:border-amber-500/60",
                )}
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setReveal((p) => ({ ...p, [def.keyField]: !showField }))}
                aria-label={showField ? "Hide key" : "Reveal key"}
              >
                {showField ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        )}

        {/* Shared-key note */}
        {def.placeholder.includes("(shared") && (
          <p className="text-[11px] text-muted-foreground italic">
            Uses the key configured in the appropriate tab above. No separate key needed.
          </p>
        )}

        {/* Model override (optional) */}
        {def.modelField && showModel && !def.placeholder.includes("(shared") && (
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Default model</Label>
            <Input
              type="text"
              placeholder={def.defaultModel ?? "model-name"}
              value={modelDraft ?? currentModel}
              onChange={(e) => def.modelField && setDraft(def.modelField, e.target.value)}
              className={cn(
                "font-mono text-sm h-8",
                modelDraft !== undefined && "border-amber-400 focus-visible:ring-amber-300/50",
              )}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}
      </div>
    );
  }

  const enabledCount = [
    config.groq_enabled, config.google_gemini_enabled, config.mistral_enabled,
    config.together_enabled, config.nvidia_enabled, config.openai_enabled,
    config.huggingface_enabled, config.stability_enabled, config.replicate_enabled,
    config.runway_enabled, config.elevenlabs_enabled, config.deepgram_enabled,
  ].filter(Boolean).length;

  return (
    <Card>
      <CardHeader className="border-b border-border bg-muted/20 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" />
              AI Provider Configuration
            </CardTitle>
            <CardDescription className="mt-1 max-w-prose">
              Add API keys for each AI provider you want to activate. All keys are
              stored encrypted in the database — never in environment variables.
              The primary provider for each capability is selected in the routing row.
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums">{enabledCount}</div>
            <div className="text-xs text-muted-foreground">providers active</div>
          </div>
        </div>

        {inlineError && (
          <Alert variant="destructive" className="mt-3 py-2">
            <AlertDescription className="text-xs">{inlineError}</AlertDescription>
          </Alert>
        )}
      </CardHeader>

      <CardContent className="pt-5">
        <Tabs defaultValue="text">
          <TabsList className="mb-5 grid w-full grid-cols-5">
            <TabsTrigger value="text" className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Text</span>
            </TabsTrigger>
            <TabsTrigger value="image" className="gap-1.5">
              <ImageIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Image</span>
            </TabsTrigger>
            <TabsTrigger value="video" className="gap-1.5">
              <Video className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Video</span>
            </TabsTrigger>
            <TabsTrigger value="audio" className="gap-1.5">
              <Music className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Audio</span>
            </TabsTrigger>
            <TabsTrigger value="agent" className="gap-1.5">
              <Bot className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Agent</span>
            </TabsTrigger>
          </TabsList>

          {/* ─── Text / LLM ─────────────────────────────────────────── */}
          <TabsContent value="text" className="space-y-3">
            <CapabilityNote>
              Text providers power all content generation: scripts, captions, hashtags,
              titles, ideas, and campaign copy. Groq is recommended as the primary —
              fastest free inference available.
            </CapabilityNote>
            <RoutingRow
              label="Primary text provider"
              value={(drafts.primary_text_provider as string) ?? config.primary_text_provider}
              options={["groq", "google_gemini", "mistral", "together", "nvidia_nim", "openai"]}
              onChange={(v) => setDraft("primary_text_provider", v)}
            />
            {TEXT_PROVIDERS.map((p) => renderProvider(p))}
          </TabsContent>

          {/* ─── Image ──────────────────────────────────────────────── */}
          <TabsContent value="image" className="space-y-3">
            <CapabilityNote>
              Image providers generate stream thumbnails, social media visuals, and
              campaign artwork from text prompts. HuggingFace (SDXL / FLUX.1) is free.
            </CapabilityNote>
            <RoutingRow
              label="Primary image provider"
              value={(drafts.primary_image_provider as string) ?? config.primary_image_provider}
              options={["huggingface", "stability", "replicate"]}
              onChange={(v) => setDraft("primary_image_provider", v)}
            />
            {IMAGE_PROVIDERS.map((p) => renderProvider(p, false))}
          </TabsContent>

          {/* ─── Video ──────────────────────────────────────────────── */}
          <TabsContent value="video" className="space-y-3">
            <CapabilityNote>
              Video providers generate short clips for social media from text prompts.
              HuggingFace (CogVideoX) is free but slow. Runway is the premium option
              for production-quality output.
            </CapabilityNote>
            <RoutingRow
              label="Primary video provider"
              value={(drafts.primary_video_provider as string) ?? config.primary_video_provider}
              options={["huggingface", "replicate", "runway"]}
              onChange={(v) => setDraft("primary_video_provider", v)}
            />
            {VIDEO_PROVIDERS.map((p) => renderProvider(p, false))}
          </TabsContent>

          {/* ─── Audio / Music ───────────────────────────────────────── */}
          <TabsContent value="audio" className="space-y-3">
            <CapabilityNote>
              Audio providers handle music generation (MusicGen), text-to-speech
              (ElevenLabs), and stream transcription (Groq Whisper, Deepgram).
              Groq Whisper is the fastest free transcription available.
            </CapabilityNote>
            <RoutingRow
              label="Primary audio provider"
              value={(drafts.primary_audio_provider as string) ?? config.primary_audio_provider}
              options={["groq", "deepgram", "elevenlabs", "huggingface"]}
              onChange={(v) => setDraft("primary_audio_provider", v)}
            />
            {AUDIO_PROVIDERS.map((p) => renderProvider(p, false))}
          </TabsContent>

          {/* ─── God-mode Agent Settings ─────────────────────────────── */}
          <TabsContent value="agent" className="space-y-4">
            <CapabilityNote>
              God-mode enables background AI agents that chain multiple tasks autonomously —
              planning, generating, and optionally publishing without human review.
              Start conservatively (max 5 steps, auto-publish off).
            </CapabilityNote>

            <div className="rounded-lg border border-border bg-card divide-y divide-border">
              <AgentToggleRow
                label="Agent mode"
                description="Enable the background agentic executor for automation rules."
                checked={(drafts.agent_mode_enabled as boolean | undefined) ?? config.agent_mode_enabled}
                onChange={(v) => setDraft("agent_mode_enabled", v)}
                accent="violet"
              />
              <AgentToggleRow
                label="Auto-publish"
                description="Allow agents to publish generated content to social platforms without human approval. Enable only after reviewing agent outputs manually."
                checked={(drafts.agent_auto_publish as boolean | undefined) ?? config.agent_auto_publish}
                onChange={(v) => setDraft("agent_auto_publish", v)}
                accent="amber"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Max steps per agent run</Label>
                <p className="text-[11px] text-muted-foreground">
                  How many subtasks one God-mode chain can execute (1–20).
                </p>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={(drafts.agent_max_steps as number | undefined) ?? config.agent_max_steps}
                  onChange={(e) => setDraft("agent_max_steps", Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 5)))}
                  className="h-8 w-24 font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Daily content ideas</Label>
                <p className="text-[11px] text-muted-foreground">
                  How many ideas to generate per host in daily automation runs (1–20).
                </p>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={(drafts.agent_daily_ideas as number | undefined) ?? config.agent_daily_ideas}
                  onChange={(e) => setDraft("agent_daily_ideas", Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 5)))}
                  className="h-8 w-24 font-mono text-sm"
                />
              </div>
            </div>

            <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-800 dark:bg-violet-950/30">
              <p className="text-xs text-violet-800 dark:text-violet-300">
                <strong>God-mode cron:</strong> Background agents run via{" "}
                <code className="font-mono">POST /api/cron/ai/daily-jobs</code> with{" "}
                <code className="font-mono">Authorization: Bearer CRON_SECRET</code>.
                Schedule this in your Cloudflare Cron Triggers — daily at 7:00 UTC is recommended.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        {/* Save / Discard */}
        <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          {isDirty && (
            <Button
              variant="ghost"
              onClick={() => { setDrafts({}); setInlineError(null); }}
              disabled={pending}
            >
              Discard
            </Button>
          )}
          <Button onClick={onSave} disabled={!isDirty || pending}>
            <Save className="mr-2 h-4 w-4" />
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function StatusPill({ tone, children }: { tone: "ok" | "muted" | "pending" | "warning"; children: React.ReactNode }) {
  const cls =
    tone === "ok" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : tone === "pending" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
    : tone === "warning" ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
    : "bg-muted text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px]", cls)}>
      {tone === "ok" ? <Check className="h-2.5 w-2.5" /> : tone === "muted" ? <Circle className="h-2 w-2" /> : null}
      {children}
    </span>
  );
}

function CapabilityNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-muted-foreground rounded-md bg-muted/50 px-3 py-2 border border-border">
      {children}
    </p>
  );
}

function RoutingRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-2.5">
      <div>
        <span className="text-xs font-semibold">{label}</span>
        <p className="text-[11px] text-muted-foreground">
          Requests route to this provider when no explicit override is set.
        </p>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}

function AgentToggleRow({
  label,
  description,
  checked,
  onChange,
  accent,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  accent: "violet" | "amber";
}) {
  const accentCls = accent === "violet"
    ? "data-[state=checked]:bg-violet-600"
    : "data-[state=checked]:bg-amber-500";

  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {checked && (
            <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal text-emerald-600 border-emerald-300">
              On
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        className={accentCls}
        aria-label={label}
      />
    </div>
  );
}
