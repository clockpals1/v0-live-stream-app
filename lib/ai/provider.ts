/**
 * AI Provider abstraction — all supported providers.
 *
 * API keys are loaded from the ai_config DB table (migration 033) via
 * lib/ai/config.ts. If the table is not yet applied, getApiKey() falls
 * back to process.env — so existing deployments keep working.
 *
 * SUPPORTED PROVIDERS
 * -------------------
 * Text / LLM (FREE tier):
 *   groq          — api.groq.com (OpenAI compat)  Llama 3.1 70B, Mixtral
 *   google_gemini — generativelanguage.googleapis.com (native REST)
 *   mistral       — api.mistral.ai (OpenAI compat) open-mistral-7b
 *   together      — api.together.xyz (OpenAI compat) Llama 3.1 70B Turbo
 *
 * Text / LLM (PREMIUM):
 *   nvidia_nim    — integrate.api.nvidia.com (OpenAI compat) Llama 405B
 *   openai        — api.openai.com (OpenAI compat) GPT-4o-mini / GPT-4o
 *
 * Image (via HuggingFace Inference API — FREE):
 *   huggingface   — api-inference.huggingface.co SDXL, FLUX.1, Kandinsky
 *
 * Image (PREMIUM):
 *   stability     — api.stability.ai SDXL, SD3
 *   replicate     — api.replicate.com (any model, pay-per-run)
 *
 * Audio / Music (FREE):
 *   deepgram      — api.deepgram.com nova-2 transcription (free credits)
 *
 * NEVER throws — returns a discriminated union.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getAiConfig,
  getApiKey as cfgGetApiKey,
  getPrimaryProvider,
  type AiConfig,
} from "@/lib/ai/config";

export type AiProvider =
  | "groq"
  | "nvidia_nim"
  | "openai"
  | "google_gemini"
  | "together"
  | "mistral"
  | "huggingface"
  | "stability"
  | "replicate"
  | "deepgram";

export interface AiGenerateOptions {
  systemPrompt: string;
  userPrompt: string;
  /** Explicit provider override. Omit to use admin-configured primary. */
  provider?: AiProvider;
  /** Explicit model override. Omit to use provider default from ai_config. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Pass pre-loaded config to avoid extra DB round-trip in batch jobs. */
  config?: AiConfig | null;
}

export type AiGenerateResult =
  | { ok: true; content: string; provider: AiProvider; model: string; tokensUsed: number }
  | { ok: false; error: string; provider: AiProvider; model: string };

// ─── Decommissioned-model safety map ────────────────────────────────────────
// When a stored model name is retired by a provider, map it to its current
// successor so existing DB rows keep working without a manual DB update.

const DEPRECATED_MODELS: Record<string, string> = {
  // Groq deprecations — https://console.groq.com/docs/deprecations
  "llama-3.1-70b-versatile": "llama-3.3-70b-versatile",
  "llama-3.1-70b-specdec": "llama-3.3-70b-specdec",
  "llama-3.2-90b-text-preview": "llama-3.3-70b-versatile",
};

function resolveModel(model: string): string {
  return DEPRECATED_MODELS[model] ?? model;
}

// ─── Provider routing table ───────────────────────────────────────────────

interface ProviderDef {
  baseUrl: string;
  /** Key column on AiConfig to fetch default model. */
  modelKey: keyof AiConfig;
  /** Which HTTP strategy to use. */
  style: "openai_compat" | "gemini";
}

const PROVIDERS: Record<string, ProviderDef> = {
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    modelKey: "groq_default_model",
    style: "openai_compat",
  },
  nvidia_nim: {
    baseUrl: "https://integrate.api.nvidia.com/v1",
    modelKey: "nvidia_default_model",
    style: "openai_compat",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    modelKey: "openai_default_model",
    style: "openai_compat",
  },
  together: {
    baseUrl: "https://api.together.xyz/v1",
    modelKey: "together_default_model",
    style: "openai_compat",
  },
  mistral: {
    baseUrl: "https://api.mistral.ai/v1",
    modelKey: "mistral_default_model",
    style: "openai_compat",
  },
  google_gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    modelKey: "google_gemini_model",
    style: "gemini",
  },
};

// ─── Main text generation function ───────────────────────────────────────

export async function generateText(
  opts: AiGenerateOptions,
): Promise<AiGenerateResult> {
  // Load ai_config from DB (or use provided pre-loaded config)
  let cfg: AiConfig | null = opts.config ?? null;
  if (cfg === undefined || (cfg === null && !("config" in opts))) {
    try {
      const admin = createAdminClient();
      cfg = await getAiConfig(admin);
    } catch {
      cfg = null;
    }
  }

  // Resolve provider
  const provider = (opts.provider ?? getPrimaryProvider(cfg, "text") ?? "groq") as AiProvider;
  const def = PROVIDERS[provider];

  if (!def) {
    return { ok: false, error: `Unknown provider: ${provider}`, provider, model: "" };
  }

  // Resolve API key — DB first, env fallback
  const apiKey = cfgGetApiKey(cfg, provider);
  if (!apiKey) {
    return {
      ok: false,
      error: `No API key configured for "${provider}". Add it in Admin → AI Configuration.`,
      provider,
      model: "",
    };
  }

  // Resolve model — remap any decommissioned model names transparently
  const defaultModel = cfg ? (cfg[def.modelKey] as string) : null;
  const model = resolveModel(opts.model ?? defaultModel ?? "default");

  if (def.style === "gemini") {
    return callGemini({ apiKey, model, opts, provider });
  }
  return callOpenAiCompat({ apiKey, model, opts, provider, baseUrl: def.baseUrl });
}

// ─── OpenAI-compatible call ───────────────────────────────────────────────

async function callOpenAiCompat({
  apiKey,
  model,
  opts,
  provider,
  baseUrl,
}: {
  apiKey: string;
  model: string;
  opts: AiGenerateOptions;
  provider: AiProvider;
  baseUrl: string;
}): Promise<AiGenerateResult> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: opts.systemPrompt },
          { role: "user", content: opts.userPrompt },
        ],
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.7,
        stream: false,
      }),
    });
  } catch (err) {
    return { ok: false, error: `Network error calling ${provider}: ${String(err)}`, provider, model };
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      detail = body?.error?.message ?? detail;
    } catch { /* ignore */ }
    return { ok: false, error: detail, provider, model };
  }

  interface Completion {
    choices: Array<{ message: { content: string } }>;
    usage?: { total_tokens?: number };
  }
  let data: Completion;
  try { data = (await response.json()) as Completion; }
  catch { return { ok: false, error: "Invalid JSON response", provider, model }; }

  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) return { ok: false, error: "Provider returned empty content", provider, model };

  return { ok: true, content, provider, model, tokensUsed: data.usage?.total_tokens ?? 0 };
}

// ─── Google Gemini native REST call ──────────────────────────────────────

async function callGemini({
  apiKey,
  model,
  opts,
  provider,
}: {
  apiKey: string;
  model: string;
  opts: AiGenerateOptions;
  provider: AiProvider;
}): Promise<AiGenerateResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    systemInstruction: { parts: [{ text: opts.systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: opts.userPrompt }] }],
    generationConfig: {
      maxOutputTokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.7,
    },
  };

  let response: Response;
  try { response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch (err) { return { ok: false, error: `Network error calling google_gemini: ${String(err)}`, provider, model }; }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const b = (await response.json()) as { error?: { message?: string } };
      detail = b?.error?.message ?? detail;
    } catch { /* ignore */ }
    return { ok: false, error: detail, provider, model };
  }

  interface GeminiResponse {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { totalTokenCount?: number };
  }
  let data: GeminiResponse;
  try { data = (await response.json()) as GeminiResponse; }
  catch { return { ok: false, error: "Invalid JSON response from Gemini", provider, model }; }

  const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  if (!content) return { ok: false, error: "Gemini returned empty content", provider, model };

  return {
    ok: true,
    content,
    provider,
    model,
    tokensUsed: data.usageMetadata?.totalTokenCount ?? 0,
  };
}

// ─── Convenience helpers ──────────────────────────────────────────────────

/**
 * Return the first available text provider using DB config + env fallback.
 * Used by the generate API route when no explicit provider is requested.
 */
export async function getAvailableTextProvider(): Promise<AiProvider | null> {
  try {
    const admin = createAdminClient();
    const cfg = await getAiConfig(admin);
    return (getPrimaryProvider(cfg, "text") as AiProvider) ?? null;
  } catch {
    if (process.env.GROQ_API_KEY) return "groq";
    if (process.env.NVIDIA_API_KEY) return "nvidia_nim";
    return null;
  }
}

/** @deprecated Use getAvailableTextProvider() instead */
export function getAvailableProvider(): AiProvider | null {
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.NVIDIA_API_KEY) return "nvidia_nim";
  return null;
}
