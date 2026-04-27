/**
 * AI Automation Hub — runtime configuration.
 *
 * Mirrors lib/billing/config.ts exactly:
 *   - getAiConfig()      loads the singleton from ai_config via admin client
 *   - redactAiConfig()   strips raw keys, returning set/not-set booleans + tails
 *   - getApiKey()        resolves a provider key from DB config with env fallback
 *   - getPrimaryProvider() resolves the admin-preferred provider for a capability
 *
 * Keys are NEVER returned from redactAiConfig() — only the last 4 chars
 * so the admin panel can show "…XXXX" without exposing values.
 *
 * getApiKey() always falls back to process.env so existing deployments
 * that use env vars continue working before migration 033 is applied.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Full DB row type ──────────────────────────────────────────────────────

export interface AiConfig {
  id: 1;
  // Text / LLM
  groq_api_key: string | null;
  groq_enabled: boolean;
  groq_default_model: string;
  nvidia_api_key: string | null;
  nvidia_enabled: boolean;
  nvidia_default_model: string;
  openai_api_key: string | null;
  openai_enabled: boolean;
  openai_default_model: string;
  google_gemini_api_key: string | null;
  google_gemini_enabled: boolean;
  google_gemini_model: string;
  together_api_key: string | null;
  together_enabled: boolean;
  together_default_model: string;
  mistral_api_key: string | null;
  mistral_enabled: boolean;
  mistral_default_model: string;
  // Image
  huggingface_api_key: string | null;
  huggingface_enabled: boolean;
  stability_api_key: string | null;
  stability_enabled: boolean;
  replicate_api_key: string | null;
  replicate_enabled: boolean;
  // Video
  runway_api_key: string | null;
  runway_enabled: boolean;
  // Audio
  elevenlabs_api_key: string | null;
  elevenlabs_enabled: boolean;
  deepgram_api_key: string | null;
  deepgram_enabled: boolean;
  // Routing
  primary_text_provider: string;
  primary_image_provider: string;
  primary_video_provider: string;
  primary_audio_provider: string;
  // Agent
  agent_mode_enabled: boolean;
  agent_max_steps: number;
  agent_auto_publish: boolean;
  agent_daily_ideas: number;
  updated_at: string;
}

// ─── Redacted shape (safe for client) ─────────────────────────────────────

export interface RedactedAiConfig {
  // Provider enabled state (no keys)
  groq_enabled: boolean;
  groq_api_key_set: boolean;
  groq_api_key_tail: string | null;
  groq_default_model: string;

  nvidia_enabled: boolean;
  nvidia_api_key_set: boolean;
  nvidia_api_key_tail: string | null;
  nvidia_default_model: string;

  openai_enabled: boolean;
  openai_api_key_set: boolean;
  openai_api_key_tail: string | null;
  openai_default_model: string;

  google_gemini_enabled: boolean;
  google_gemini_api_key_set: boolean;
  google_gemini_api_key_tail: string | null;
  google_gemini_model: string;

  together_enabled: boolean;
  together_api_key_set: boolean;
  together_api_key_tail: string | null;
  together_default_model: string;

  mistral_enabled: boolean;
  mistral_api_key_set: boolean;
  mistral_api_key_tail: string | null;
  mistral_default_model: string;

  huggingface_enabled: boolean;
  huggingface_api_key_set: boolean;
  huggingface_api_key_tail: string | null;

  stability_enabled: boolean;
  stability_api_key_set: boolean;
  stability_api_key_tail: string | null;

  replicate_enabled: boolean;
  replicate_api_key_set: boolean;
  replicate_api_key_tail: string | null;

  runway_enabled: boolean;
  runway_api_key_set: boolean;
  runway_api_key_tail: string | null;

  elevenlabs_enabled: boolean;
  elevenlabs_api_key_set: boolean;
  elevenlabs_api_key_tail: string | null;

  deepgram_enabled: boolean;
  deepgram_api_key_set: boolean;
  deepgram_api_key_tail: string | null;

  // Routing preferences
  primary_text_provider: string;
  primary_image_provider: string;
  primary_video_provider: string;
  primary_audio_provider: string;

  // Agent settings
  agent_mode_enabled: boolean;
  agent_max_steps: number;
  agent_auto_publish: boolean;
  agent_daily_ideas: number;

  updated_at: string;
}

// ─── Patch shape accepted by /api/admin/ai-config ─────────────────────────

export interface AiConfigPatch {
  // keys — empty string → clear → NULL in DB
  groq_api_key?: string | null;
  groq_enabled?: boolean;
  groq_default_model?: string;
  nvidia_api_key?: string | null;
  nvidia_enabled?: boolean;
  nvidia_default_model?: string;
  openai_api_key?: string | null;
  openai_enabled?: boolean;
  openai_default_model?: string;
  google_gemini_api_key?: string | null;
  google_gemini_enabled?: boolean;
  google_gemini_model?: string;
  together_api_key?: string | null;
  together_enabled?: boolean;
  together_default_model?: string;
  mistral_api_key?: string | null;
  mistral_enabled?: boolean;
  mistral_default_model?: string;
  huggingface_api_key?: string | null;
  huggingface_enabled?: boolean;
  stability_api_key?: string | null;
  stability_enabled?: boolean;
  replicate_api_key?: string | null;
  replicate_enabled?: boolean;
  runway_api_key?: string | null;
  runway_enabled?: boolean;
  elevenlabs_api_key?: string | null;
  elevenlabs_enabled?: boolean;
  deepgram_api_key?: string | null;
  deepgram_enabled?: boolean;
  primary_text_provider?: string;
  primary_image_provider?: string;
  primary_video_provider?: string;
  primary_audio_provider?: string;
  agent_mode_enabled?: boolean;
  agent_max_steps?: number;
  agent_auto_publish?: boolean;
  agent_daily_ideas?: number;
}

// ─── DB helpers ───────────────────────────────────────────────────────────

/**
 * Load the singleton ai_config row. Caller MUST use an admin/service-role
 * Supabase client — the RLS policy denies non-admin reads.
 * Returns null if migration 033 hasn't been applied yet (table missing).
 */
export async function getAiConfig(
  supabase: SupabaseClient,
): Promise<AiConfig | null> {
  const { data, error } = await supabase
    .from("ai_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    console.warn("[ai/config] getAiConfig failed:", error.message);
    return null;
  }
  return data as AiConfig | null;
}

/**
 * Redact: strip raw API keys, return only set/not-set booleans + last 4 chars.
 */
export function redactAiConfig(cfg: AiConfig): RedactedAiConfig {
  const tail = (s: string | null) =>
    s && s.length > 4 ? s.slice(-4) : null;

  return {
    groq_enabled: cfg.groq_enabled,
    groq_api_key_set: !!cfg.groq_api_key,
    groq_api_key_tail: tail(cfg.groq_api_key),
    groq_default_model: cfg.groq_default_model,

    nvidia_enabled: cfg.nvidia_enabled,
    nvidia_api_key_set: !!cfg.nvidia_api_key,
    nvidia_api_key_tail: tail(cfg.nvidia_api_key),
    nvidia_default_model: cfg.nvidia_default_model,

    openai_enabled: cfg.openai_enabled,
    openai_api_key_set: !!cfg.openai_api_key,
    openai_api_key_tail: tail(cfg.openai_api_key),
    openai_default_model: cfg.openai_default_model,

    google_gemini_enabled: cfg.google_gemini_enabled,
    google_gemini_api_key_set: !!cfg.google_gemini_api_key,
    google_gemini_api_key_tail: tail(cfg.google_gemini_api_key),
    google_gemini_model: cfg.google_gemini_model,

    together_enabled: cfg.together_enabled,
    together_api_key_set: !!cfg.together_api_key,
    together_api_key_tail: tail(cfg.together_api_key),
    together_default_model: cfg.together_default_model,

    mistral_enabled: cfg.mistral_enabled,
    mistral_api_key_set: !!cfg.mistral_api_key,
    mistral_api_key_tail: tail(cfg.mistral_api_key),
    mistral_default_model: cfg.mistral_default_model,

    huggingface_enabled: cfg.huggingface_enabled,
    huggingface_api_key_set: !!cfg.huggingface_api_key,
    huggingface_api_key_tail: tail(cfg.huggingface_api_key),

    stability_enabled: cfg.stability_enabled,
    stability_api_key_set: !!cfg.stability_api_key,
    stability_api_key_tail: tail(cfg.stability_api_key),

    replicate_enabled: cfg.replicate_enabled,
    replicate_api_key_set: !!cfg.replicate_api_key,
    replicate_api_key_tail: tail(cfg.replicate_api_key),

    runway_enabled: cfg.runway_enabled,
    runway_api_key_set: !!cfg.runway_api_key,
    runway_api_key_tail: tail(cfg.runway_api_key),

    elevenlabs_enabled: cfg.elevenlabs_enabled,
    elevenlabs_api_key_set: !!cfg.elevenlabs_api_key,
    elevenlabs_api_key_tail: tail(cfg.elevenlabs_api_key),

    deepgram_enabled: cfg.deepgram_enabled,
    deepgram_api_key_set: !!cfg.deepgram_api_key,
    deepgram_api_key_tail: tail(cfg.deepgram_api_key),

    primary_text_provider: cfg.primary_text_provider,
    primary_image_provider: cfg.primary_image_provider,
    primary_video_provider: cfg.primary_video_provider,
    primary_audio_provider: cfg.primary_audio_provider,

    agent_mode_enabled: cfg.agent_mode_enabled,
    agent_max_steps: cfg.agent_max_steps,
    agent_auto_publish: cfg.agent_auto_publish,
    agent_daily_ideas: cfg.agent_daily_ideas,

    updated_at: cfg.updated_at,
  };
}

// ─── Runtime helpers ──────────────────────────────────────────────────────

/**
 * Resolve the API key for a provider. DB config takes priority; falls back
 * to process.env so existing env-var-only deployments keep working.
 */
export function getApiKey(
  cfg: AiConfig | null,
  provider: string,
): string | null {
  const envFallbacks: Record<string, string> = {
    groq: "GROQ_API_KEY",
    nvidia_nim: "NVIDIA_API_KEY",
    openai: "OPENAI_API_KEY",
    google_gemini: "GOOGLE_GEMINI_API_KEY",
    together: "TOGETHER_API_KEY",
    mistral: "MISTRAL_API_KEY",
    huggingface: "HUGGINGFACE_API_KEY",
    stability: "STABILITY_API_KEY",
    replicate: "REPLICATE_API_KEY",
    runway: "RUNWAY_API_KEY",
    elevenlabs: "ELEVENLABS_API_KEY",
    deepgram: "DEEPGRAM_API_KEY",
  };

  // DB key takes priority over env
  const dbKey = cfg
    ? (cfg[`${provider}_api_key` as keyof AiConfig] as string | null)
    : null;
  if (dbKey) return dbKey;

  // Env fallback
  const envVar = envFallbacks[provider];
  return envVar ? (process.env[envVar] ?? null) : null;
}

/**
 * Resolve which provider to use for a capability, falling back gracefully
 * through the admin preference → first enabled provider → null.
 */
export function getPrimaryProvider(
  cfg: AiConfig | null,
  capability: "text" | "image" | "video" | "audio",
): string | null {
  const prefKey = `primary_${capability}_provider` as keyof AiConfig;
  const preferred = cfg ? (cfg[prefKey] as string) : null;

  // Return preferred if it has a key set
  if (preferred && getApiKey(cfg, preferred)) return preferred;

  // Fallback chain per capability
  const chains: Record<string, string[]> = {
    text: ["groq", "google_gemini", "mistral", "together", "nvidia_nim", "openai"],
    image: ["huggingface", "nvidia_nim", "stability", "replicate"],
    video: ["huggingface", "replicate", "runway"],
    audio: ["groq", "deepgram", "elevenlabs", "huggingface"],
  };

  for (const p of (chains[capability] ?? [])) {
    if (getApiKey(cfg, p)) return p;
  }
  return null;
}
