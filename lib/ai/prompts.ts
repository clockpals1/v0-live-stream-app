/**
 * AI Automation Hub — system prompts for each task type.
 *
 * Each exported function returns { systemPrompt, userPrompt } ready to pass
 * directly to generateText(). Separating prompts from the API route keeps
 * the route thin and makes prompts easy to iterate without touching infra.
 *
 * Design rules:
 *   1. System prompts establish persona + output format. Be prescriptive.
 *   2. User prompts inject the host's specific context.
 *   3. Always ask for clean, copy-pastable output — no markdown fences,
 *      no meta-commentary unless the format genuinely requires it.
 */

export type TaskType =
  | "script_gen"
  | "caption_gen"
  | "hashtag_gen"
  | "title_gen"
  | "content_ideas"
  | "affiliate_campaign"
  | "short_video_script"
  | "weekly_summary"
  | "post_stream_recap";

export type Platform =
  | "youtube"
  | "tiktok"
  | "instagram"
  | "twitter"
  | "linkedin"
  | "generic";

export type Tone =
  | "professional"
  | "casual"
  | "energetic"
  | "educational"
  | "inspiring"
  | "humorous";

export interface BasePromptContext {
  topic: string;
  platform?: Platform;
  tone?: Tone;
  niche?: string;
  audienceNote?: string;
}

export interface AffiliateContext extends BasePromptContext {
  productName: string;
  productUrl?: string;
  productDescription?: string;
}

export interface SummaryContext {
  streamCount: number;
  totalViewers: number;
  topStreamTitle: string;
  subscriberGrowth: number;
  periodLabel: string; // e.g. "April 21–27, 2026"
}

// ─── Script Generation ────────────────────────────────────────────────────────

export function buildScriptPrompt(ctx: BasePromptContext) {
  const systemPrompt = `You are an expert live stream scriptwriter who creates compelling, engaging scripts for content creators.
Your scripts are structured, punchy, and convert viewers into followers.
Output format — three clearly labelled sections only:
  HOOK (30 seconds): Attention-grabbing opening
  MAIN CONTENT: Key talking points as a numbered list (5–7 points)
  CALL TO ACTION (15 seconds): Closing action prompt
Tone: ${ctx.tone ?? "casual"}. Platform: ${ctx.platform ?? "generic"}.
Write in second person ("you"), no filler phrases, no meta-commentary.`;

  const userPrompt = `Create a live stream script for this topic: "${ctx.topic}"
${ctx.niche ? `Niche: ${ctx.niche}` : ""}
${ctx.audienceNote ? `Audience note: ${ctx.audienceNote}` : ""}`;

  return { systemPrompt, userPrompt };
}

// ─── Caption Generation ───────────────────────────────────────────────────────

export function buildCaptionPrompt(ctx: BasePromptContext) {
  const platformGuide: Record<Platform, string> = {
    youtube: "max 200 chars, keyword-rich, include a question to boost comments",
    tiktok: "max 150 chars, trend-aware, use 2–3 emojis naturally",
    instagram: "max 220 chars, storytelling hook, ends with question or CTA",
    twitter: "max 280 chars, punchy, no hashtags in body (they go at end)",
    linkedin: "professional tone, 180–220 chars, insight-led",
    generic: "conversational, 150–200 chars, platform-neutral",
  };

  const guide = platformGuide[ctx.platform ?? "generic"];

  const systemPrompt = `You are a social media copywriter who creates high-performing captions for creators.
Output exactly 3 caption variants labelled CAPTION 1, CAPTION 2, CAPTION 3.
Each caption: ${guide}.
Tone: ${ctx.tone ?? "casual"}. No quotation marks around captions. No explanatory text.`;

  const userPrompt = `Write 3 captions for a ${ctx.platform ?? "social media"} post about: "${ctx.topic}"
${ctx.niche ? `Creator niche: ${ctx.niche}` : ""}`;

  return { systemPrompt, userPrompt };
}

// ─── Hashtag Generation ───────────────────────────────────────────────────────

export function buildHashtagPrompt(ctx: BasePromptContext) {
  const counts: Record<Platform, number> = {
    youtube: 5,
    tiktok: 8,
    instagram: 25,
    twitter: 4,
    linkedin: 5,
    generic: 15,
  };

  const count = counts[ctx.platform ?? "generic"];

  const systemPrompt = `You are an SEO and social media strategist who creates optimised hashtag packs.
Output exactly ${count} hashtags on a single line, separated by spaces, starting with #.
Mix: 2 broad (high volume) + ${Math.floor(count * 0.5)} mid-range + ${Math.ceil(count * 0.3)} niche-specific.
No explanatory text. Just the hashtags.`;

  const userPrompt = `Generate ${count} ${ctx.platform ?? "social media"} hashtags for: "${ctx.topic}"
${ctx.niche ? `Niche: ${ctx.niche}` : ""}`;

  return { systemPrompt, userPrompt };
}

// ─── Title Variants ───────────────────────────────────────────────────────────

export function buildTitlePrompt(ctx: BasePromptContext) {
  const systemPrompt = `You are a YouTube/social media title specialist who writes click-worthy, honest titles.
Output exactly 5 title variants, each on its own line, numbered 1–5.
Mix styles: curiosity gap, number-led, how-to, bold statement, question.
No quotation marks. No explanatory text. Each title under 70 characters.
Tone: ${ctx.tone ?? "casual"}.`;

  const userPrompt = `Write 5 title variants for: "${ctx.topic}"
${ctx.niche ? `Niche: ${ctx.niche}` : ""}
${ctx.platform ? `Optimised for: ${ctx.platform}` : ""}`;

  return { systemPrompt, userPrompt };
}

// ─── Content Ideas ────────────────────────────────────────────────────────────

export function buildContentIdeasPrompt(ctx: BasePromptContext) {
  const systemPrompt = `You are a content strategist who generates high-engagement content ideas for creators.
Output exactly 7 content ideas as a numbered list.
Each idea: one line, title + one-sentence hook explaining why it'll perform.
Format: "N. [Title] — [Why it works / hook]"
Tone: ${ctx.tone ?? "casual"}. No filler text.`;

  const userPrompt = `Generate 7 content ideas for a creator in: "${ctx.topic}"
${ctx.niche ? `Niche: ${ctx.niche}` : ""}
${ctx.platform ? `Primary platform: ${ctx.platform}` : ""}
${ctx.audienceNote ? `Audience: ${ctx.audienceNote}` : ""}`;

  return { systemPrompt, userPrompt };
}

// ─── Affiliate Campaign Copy ──────────────────────────────────────────────────

export function buildAffiliateCampaignPrompt(ctx: AffiliateContext) {
  const systemPrompt = `You are a direct-response copywriter who creates high-converting affiliate campaign content.
Output a campaign pack with these clearly labelled sections:
  HOOK: One compelling opening sentence for the product
  SHORT PITCH (social): 2–3 sentences for social media
  EMAIL SUBJECT: 3 subject line variants
  CTA: 3 call-to-action button/link text variants
  KEY BENEFITS: 4 bullet points
Tone: ${ctx.tone ?? "casual"}. Be benefit-focused, not feature-focused. No hype words.`;

  const userPrompt = `Create an affiliate campaign pack for: ${ctx.productName}
${ctx.productDescription ? `Description: ${ctx.productDescription}` : ""}
${ctx.productUrl ? `URL: ${ctx.productUrl}` : ""}
${ctx.niche ? `Creator niche: ${ctx.niche}` : ""}
Topic context: "${ctx.topic}"`;

  return { systemPrompt, userPrompt };
}

// ─── Short Video Script ───────────────────────────────────────────────────────

export function buildShortVideoScriptPrompt(ctx: BasePromptContext) {
  const systemPrompt = `You are a short-form video script writer for TikTok and Instagram Reels.
Scripts must be under 60 seconds when read aloud (≈150 words).
Output format:
  HOOK (first 3 seconds): One sentence that stops the scroll
  BODY: 3–4 punchy sentences delivering the value
  PAYOFF + CTA: One closing line + follow/subscribe prompt
Tone: ${ctx.tone ?? "energetic"}. Conversational, direct, no stiffness.`;

  const userPrompt = `Write a 60-second short video script about: "${ctx.topic}"
${ctx.niche ? `Niche: ${ctx.niche}` : ""}`;

  return { systemPrompt, userPrompt };
}

// ─── Weekly Summary (automation) ─────────────────────────────────────────────

export function buildWeeklySummaryPrompt(ctx: SummaryContext) {
  const systemPrompt = `You are a business analyst writing a concise weekly performance narrative for a content creator.
Write 3 short paragraphs (no headers):
  1. What happened this week (streams, viewers, growth) — facts first.
  2. What's working — highlight the top performer and why.
  3. One clear recommendation for next week.
Be direct, data-driven, and encouraging. Under 200 words total.`;

  const userPrompt = `Weekly performance for the period: ${ctx.periodLabel}
Streams this week: ${ctx.streamCount}
Total viewers: ${ctx.totalViewers}
Top stream: "${ctx.topStreamTitle}"
Subscriber growth: ${ctx.subscriberGrowth > 0 ? `+${ctx.subscriberGrowth}` : ctx.subscriberGrowth}

Write the weekly summary.`;

  return { systemPrompt, userPrompt };
}

// ─── Prompt router ────────────────────────────────────────────────────────────

export function getPromptForTask(
  taskType: TaskType,
  input: Record<string, unknown>,
): { systemPrompt: string; userPrompt: string } | null {
  const ctx = input as unknown as BasePromptContext & AffiliateContext & Partial<SummaryContext>;

  switch (taskType) {
    case "script_gen":          return buildScriptPrompt(ctx);
    case "caption_gen":         return buildCaptionPrompt(ctx);
    case "hashtag_gen":         return buildHashtagPrompt(ctx);
    case "title_gen":           return buildTitlePrompt(ctx);
    case "content_ideas":       return buildContentIdeasPrompt(ctx);
    case "affiliate_campaign":  return buildAffiliateCampaignPrompt(ctx);
    case "short_video_script":  return buildShortVideoScriptPrompt(ctx);
    case "weekly_summary":
      if (ctx.periodLabel) return buildWeeklySummaryPrompt(ctx as unknown as SummaryContext);
      return null;
    default:
      return null;
  }
}
