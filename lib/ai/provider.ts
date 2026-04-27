/**
 * AI Provider abstraction — Groq + NVIDIA NIM.
 *
 * Both providers expose an OpenAI-compatible /v1/chat/completions endpoint,
 * so the implementation is nearly identical. The only differences are:
 *   - base URL
 *   - API key env variable
 *   - default model names
 *
 * PROVIDER SELECTION
 * ------------------
 * Pass provider: "groq" (default) or provider: "nvidia_nim".
 * Groq is preferred for text: fastest latency (~200ms), generous free tier.
 * NVIDIA NIM is used for image prompts / tasks needing Llama 405B quality.
 *
 * FREE TIER LIMITS (as of 2025)
 * ------------------------------
 * Groq:       14,400 req/day, 6,000 tokens/min on llama-3.1-70b-versatile
 * NVIDIA NIM: ~$100 free credits on signup; 40 req/min after credits
 *
 * ENV VARIABLES REQUIRED
 * ----------------------
 * GROQ_API_KEY       — from console.groq.com
 * NVIDIA_API_KEY     — from build.nvidia.com
 *
 * Never throws — returns a discriminated union so callers handle errors
 * without try/catch at the call site.
 */

export type AiProvider = "groq" | "nvidia_nim";

export interface AiGenerateOptions {
  systemPrompt: string;
  userPrompt: string;
  provider?: AiProvider;
  /** Override the default model for the provider. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export type AiGenerateResult =
  | { ok: true; content: string; provider: AiProvider; model: string; tokensUsed: number }
  | { ok: false; error: string; provider: AiProvider; model: string };

const PROVIDER_CONFIG: Record<
  AiProvider,
  { baseUrl: string; envKey: string; defaultModel: string }
> = {
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    defaultModel: "llama-3.1-70b-versatile",
  },
  nvidia_nim: {
    baseUrl: "https://integrate.api.nvidia.com/v1",
    envKey: "NVIDIA_API_KEY",
    defaultModel: "meta/llama-3.1-70b-instruct",
  },
};

export async function generateText(
  opts: AiGenerateOptions,
): Promise<AiGenerateResult> {
  const provider: AiProvider = opts.provider ?? "groq";
  const cfg = PROVIDER_CONFIG[provider];
  const model = opts.model ?? cfg.defaultModel;
  const apiKey = process.env[cfg.envKey];

  if (!apiKey) {
    return {
      ok: false,
      error: `${cfg.envKey} is not configured. Set it in your environment variables.`,
      provider,
      model,
    };
  }

  let response: Response;
  try {
    response = await fetch(`${cfg.baseUrl}/chat/completions`, {
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
    return {
      ok: false,
      error: `Network error calling ${provider}: ${String(err)}`,
      provider,
      model,
    };
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      detail = body?.error?.message ?? detail;
    } catch {
      // ignore parse error
    }
    return { ok: false, error: detail, provider, model };
  }

  interface CompletionResponse {
    choices: Array<{ message: { content: string } }>;
    usage?: { total_tokens?: number };
  }

  let data: CompletionResponse;
  try {
    data = (await response.json()) as CompletionResponse;
  } catch {
    return { ok: false, error: "Invalid JSON response from provider", provider, model };
  }

  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) {
    return { ok: false, error: "Provider returned empty content", provider, model };
  }

  return {
    ok: true,
    content,
    provider,
    model,
    tokensUsed: data.usage?.total_tokens ?? 0,
  };
}

/**
 * Pick a provider automatically based on which API keys are configured.
 * Groq is preferred; falls back to NVIDIA NIM; returns null if neither set.
 */
export function getAvailableProvider(): AiProvider | null {
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.NVIDIA_API_KEY) return "nvidia_nim";
  return null;
}
