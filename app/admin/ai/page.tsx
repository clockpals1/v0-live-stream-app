import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAiConfig, redactAiConfig } from "@/lib/ai/config";
import { AiConfigPanel } from "@/components/admin/ai/ai-config-panel";
import { Check, Circle, Mic, Film, Sparkles, Volume2 } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";

export const dynamic = "force-dynamic";

/**
 * /admin/ai — AI provider configuration.
 *
 * Mirrors /admin/billing/page.tsx structure exactly.
 * Server component: gates on admin role, server-loads redacted config.
 */
export default async function AdminAiPage() {
  const supabase = await createClient();

  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    redirect("/auth/login");
  }
  if (!user) redirect("/auth/login");

  const { data: host } = await supabase
    .from("hosts")
    .select("role, is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  const isAdmin = !!host && (host.role === "admin" || host.is_admin === true);
  if (!isAdmin) redirect("/host/dashboard");

  let initialConfig = null;
  let enabledProviders = 0;
  let migrationMissing = false;

  try {
    const admin = createAdminClient();
    const cfg = await getAiConfig(admin);
    if (!cfg) {
      migrationMissing = true;
    } else {
      initialConfig = redactAiConfig(cfg);
      enabledProviders = [
        cfg.groq_enabled, cfg.google_gemini_enabled, cfg.mistral_enabled,
        cfg.together_enabled, cfg.nvidia_enabled, cfg.openai_enabled,
        cfg.huggingface_enabled, cfg.stability_enabled, cfg.replicate_enabled,
        cfg.runway_enabled, cfg.elevenlabs_enabled, cfg.deepgram_enabled,
      ].filter(Boolean).length;
    }
  } catch (e) {
    console.error("[admin/ai] page load failed:", e);
    migrationMissing = true;
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <PageHeader
        title="AI Configuration"
        description="Manage AI provider API keys, capability routing, and agent settings."
        breadcrumbs={[
          { label: "Admin Center", href: "/admin" },
          { label: "AI Configuration" },
        ]}
      />
      <main className="flex-1 overflow-auto">
      <div className="container mx-auto max-w-5xl space-y-6 px-4 py-8">

        {/* Quick stats */}
        {initialConfig && (
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Active providers"
              value={String(enabledProviders)}
              hint="Across text, image, video, and audio"
            />
            <StatCard
              label="Primary text"
              value={initialConfig.primary_text_provider}
              hint="Routes all content generation requests"
            />
            <StatCard
              label="Agent mode"
              value={initialConfig.agent_mode_enabled ? "ON" : "OFF"}
              hint={initialConfig.agent_mode_enabled ? `${initialConfig.agent_max_steps} steps, ${initialConfig.agent_daily_ideas} ideas/day` : "Enable in Agent tab"}
              accent={initialConfig.agent_mode_enabled ? "live" : undefined}
            />
          </div>
        )}

        {/* Config panel or migration warning */}
        {migrationMissing ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            The <code className="font-mono">ai_config</code> table is missing.
            Apply migration <code className="font-mono">033_ai_config.sql</code> in
            the Supabase SQL editor, then refresh this page.
          </div>
        ) : initialConfig ? (
          <AiConfigPanel initial={initialConfig} />
        ) : null}

        {/* ── Short Video Creator — best media AI providers ──────────── */}
        <section className="space-y-3 pt-2">
          <div className="border-b border-border pb-2">
            <div className="text-sm font-semibold">Recommended for Short Video Creator</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Best providers for voice narration, visual consistency, and AI video generation.
              Add their API keys above to wire them into the workflow.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {MEDIA_PROVIDERS.map((p) => (
              <a
                key={p.name}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 rounded-lg border border-border p-3 hover:border-primary/40 hover:bg-muted/30 transition-colors"
              >
                <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${p.iconBg}`}>
                  <p.Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium">{p.name}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${p.badgeColor}`}>{p.badge}</span>
                  </div>
                  <div className="text-[11px] font-medium text-muted-foreground">{p.use}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground/70">{p.desc}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{p.url}</div>
                </div>
              </a>
            ))}
          </div>
        </section>

        {/* Supported free providers quick-ref */}
        <section className="space-y-3 pt-2">
          <div className="border-b border-border pb-2">
            <div className="text-sm font-semibold">Free provider quick-reference</div>
            <p className="mt-0.5 text-xs text-muted-foreground">Get API keys for free. No credit card required.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {FREE_PROVIDERS.map((p) => (
              <a
                key={p.label}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 rounded-lg border border-border p-3 hover:border-primary/40 hover:bg-muted/30 transition-colors"
              >
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-100 dark:bg-emerald-950">
                  <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className="text-[11px] text-muted-foreground">{p.desc}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{p.url}</div>
                </div>
              </a>
            ))}
          </div>
        </section>
      </div>
      </main>
    </div>
  );
}

const MEDIA_PROVIDERS = [
  {
    name: "ElevenLabs",
    Icon: Mic,
    iconBg: "bg-violet-100 dark:bg-violet-950 text-violet-600 dark:text-violet-400",
    badge: "Voice",
    badgeColor: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    use: "AI Voiceover / Voice Cloning",
    desc: "Best for narration and voice cloning from a 1-min sample. Multilingual TTS. 10,000 chars/mo free. Connect via elevenlabs_key in the Providers tab.",
    url: "https://elevenlabs.io",
  },
  {
    name: "PlayHT",
    Icon: Volume2,
    iconBg: "bg-sky-100 dark:bg-sky-950 text-sky-600 dark:text-sky-400",
    badge: "Voice",
    badgeColor: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    use: "Voice Cloning (alt.)",
    desc: "Clone any voice from 5 s of audio. Good free tier and a solid fallback when ElevenLabs quota is exhausted.",
    url: "https://play.ht",
  },
  {
    name: "Runway ML Gen-3",
    Icon: Film,
    iconBg: "bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400",
    badge: "Video AI",
    badgeColor: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    use: "Image → Video / Visual Consistency",
    desc: "Best for animating reference images and maintaining character/product consistency across scenes. Pair with the scene\u2019s visual_prompt + your reference images.",
    url: "https://runwayml.com",
  },
  {
    name: "Luma AI Dream Machine",
    Icon: Sparkles,
    iconBg: "bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400",
    badge: "Video AI",
    badgeColor: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    use: "Text / Image → Realistic Video",
    desc: "Generates 5-second photorealistic clips from text or image prompts. Strong for product demos, lifestyle B-roll, and cinematic shots.",
    url: "https://lumalabs.ai",
  },
  {
    name: "Stability AI / SDXL",
    Icon: Sparkles,
    iconBg: "bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400",
    badge: "Images",
    badgeColor: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    use: "Scene Visuals / Storyboard Frames",
    desc: "Generate on-brand scene visuals from each scene\u2019s visual_prompt. Free via HuggingFace — already listed below. Enable stability_key in the Providers tab for paid tiers.",
    url: "https://stability.ai",
  },
  {
    name: "Pika Labs",
    Icon: Film,
    iconBg: "bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400",
    badge: "Video AI",
    badgeColor: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    use: "Social Video Generation",
    desc: "Strong for animated text overlays and lifestyle video clips. Good alternative to Runway for social-focused short-form content (TikTok / Reels).",
    url: "https://pika.art",
  },
];

const FREE_PROVIDERS = [
  { label: "Groq", desc: "Llama 3.1 70B — 14,400 req/day free. Fastest inference.", url: "https://console.groq.com" },
  { label: "Google Gemini", desc: "Gemini 1.5 Flash — 15 RPM free tier, no credit card.", url: "https://aistudio.google.com/app/apikey" },
  { label: "Mistral AI", desc: "open-mistral-7b free tier, great for European hosting.", url: "https://console.mistral.ai" },
  { label: "Together.ai", desc: "Llama 3.1 70B Turbo + free credits on signup.", url: "https://api.together.xyz" },
  { label: "NVIDIA NIM", desc: "~$100 free credits — Llama 3.1 405B, Mistral Large.", url: "https://build.nvidia.com" },
  { label: "HuggingFace", desc: "SDXL, FLUX.1, MusicGen, CogVideoX — all free.", url: "https://huggingface.co/settings/tokens" },
  { label: "ElevenLabs", desc: "10,000 chars/month TTS free — human-quality voices.", url: "https://elevenlabs.io" },
  { label: "Deepgram", desc: "$200 free credit on signup for nova-2 transcription.", url: "https://deepgram.com" },
];

function StatCard({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: "live" }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Circle className="h-2 w-2" />
        {label}
      </div>
      <div className={`mt-1.5 text-xl font-semibold font-mono tracking-tight ${accent === "live" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
