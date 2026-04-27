import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAiConfig, redactAiConfig } from "@/lib/ai/config";
import { Button } from "@/components/ui/button";
import { AiConfigPanel } from "@/components/admin/ai/ai-config-panel";
import {
  Radio,
  ArrowLeft,
  ShieldCheck,
  Sparkles,
  Check,
  Circle,
} from "lucide-react";

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
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Radio className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground">Isunday Stream Live</span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <ShieldCheck className="h-4 w-4" />
              Admin
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin">
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                User management
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl space-y-6 px-4 py-8">
        {/* Breadcrumb + title */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link href="/admin" className="hover:text-foreground">Admin</Link>
            <span>/</span>
            <span className="text-foreground">AI Configuration</span>
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Sparkles className="h-5 w-5" />
            AI Configuration
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage AI provider API keys, capability routing, and God-mode agent settings
            for the AI Automation Hub at <code className="font-mono text-xs">ai.isunday.me</code>.
          </p>
        </div>

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
      </main>
    </div>
  );
}

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
