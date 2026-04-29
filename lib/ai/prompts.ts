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
  | "short_video_ad"
  | "hook_variants"
  | "ad_copy_full"
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
  // Short video context
  videoLength?: string;        // '15' | '30' | '60'
  monetizationAngle?: string;  // 'organic' | 'product' | 'affiliate' | 'brand'
  angle?: string;              // creative angle / video style
  // Campaign / ad context
  targetAudience?: string;
  productDescription?: string;
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
  const lengthLabel = ctx.videoLength === '15' ? '15 seconds (≈40 words)'
    : ctx.videoLength === '30' ? '30 seconds (≈80 words)'
    : '60 seconds (≈150 words)';
  const angleNote = ctx.angle ? `Video angle / style: ${ctx.angle}.` : '';
  const monetNote = ctx.monetizationAngle && ctx.monetizationAngle !== 'organic'
    ? `Monetization intent: ${ctx.monetizationAngle} — weave this naturally into the CTA.` : '';

  const systemPrompt = `You are a short-form video script writer for TikTok, Instagram Reels, and YouTube Shorts.
Target length: ${lengthLabel}.
${angleNote} ${monetNote}
Output EXACTLY the following five labelled sections in order. Each label must appear at the start of its own line, in ALL CAPS, followed by a colon and a space:

HOOK (first 3 seconds): One sentence that stops the scroll — make it irresistible
CONCEPT: One sentence summary of what this video is really about
SCRIPT BODY: The full script body — punchy, conversational, no fluff
CTA: Closing call to action (follow / buy / click / comment)
CAPTION: A ready-to-post social caption with 2–3 relevant emojis

CRITICAL RULES:
- Output PLAIN TEXT ONLY. Do NOT use markdown (no **, no ##, no bullet points, no dashes).
- Do NOT add any commentary, introduction, or explanation outside the five sections.
- Every section must have real content — never leave a section empty.
Tone: ${ctx.tone ?? 'energetic'}. Write as if speaking directly to camera.`;

  const userPrompt = `Write a short video script about: "${ctx.topic}"
${ctx.niche ? `Creator niche: ${ctx.niche}` : ''}
${ctx.audienceNote ? `Target audience: ${ctx.audienceNote}` : ''}`;

  return { systemPrompt, userPrompt };
}

// ─── Short Video Ad ───────────────────────────────────────────────────────────

export function buildShortVideoAdPrompt(ctx: BasePromptContext) {
  const lengthLabel = ctx.videoLength === '15' ? '15 seconds (≈40 words, hard sell)'
    : ctx.videoLength === '30' ? '30 seconds (≈80 words, problem + solution)'
    : '60 seconds (≈150 words, full story arc)';
  const platform = ctx.platform ?? 'generic';

  const systemPrompt = `You are a performance-focused short-form video ad scriptwriter.
Target: ${lengthLabel} on ${platform}.
This is a PAID AD — every word must work toward conversion. Be direct, benefit-first.
Output EXACTLY the following six labelled sections in order. Each label must appear at the start of its own line, in ALL CAPS, followed by a colon and a space:

HOOK (3 seconds): Pattern-interrupt opening that stops the scroll — surprising or provocative
PROBLEM: One sentence naming the exact pain point your viewer recognises
SOLUTION: Your offer as the solution — 1–2 sentences, focus on the outcome
PROOF POINT: Social proof or result hook (e.g. "Over 10,000 creators have used this…")
CTA: Strong direct call to action — max 8 words, starts with a verb
SCRIPT BODY: Combine PROBLEM + SOLUTION + PROOF into a flowing 2–3 sentence script body

CRITICAL RULES:
- Output PLAIN TEXT ONLY. Do NOT use markdown (no **, no ##, no bullet points, no dashes).
- Do NOT add any commentary, introduction, or explanation outside the sections.
- Every section must have real content — never leave a section empty.
Tone: ${ctx.tone ?? 'energetic'}. No fluff, no hype words, benefit-focused.`;

  const userPrompt = `Write a short video ad for: "${ctx.topic}"
${ctx.productDescription ? `Product/offer description: ${ctx.productDescription}` : ''}
${ctx.niche ? `Creator niche / audience: ${ctx.niche}` : ''}
${ctx.targetAudience ? `Target viewer: ${ctx.targetAudience}` : ''}`;

  return { systemPrompt, userPrompt };
}

// ─── Hook Variants ────────────────────────────────────────────────────────────

export function buildHookVariantsPrompt(ctx: BasePromptContext) {
  const systemPrompt = `You are a viral content strategist specialising in scroll-stopping hooks for short-form video.
Generate exactly 5 different hook approaches for the same concept — each with a distinct psychological angle.
Output format — one per line with the label:
  CURIOSITY HOOK: Teases without revealing — makes viewers need to know what happens
  PAIN HOOK: Names a specific frustration or fear your viewer has right now
  BENEFIT HOOK: Leads with the concrete outcome or transformation
  STORY HOOK: Opens a mini personal narrative in one sentence
  TREND HOOK: Connects to a current trend, cultural moment, or viral format
Each hook must be under 20 words. Make them genuinely scroll-stopping — not generic.
Tone: ${ctx.tone ?? 'energetic'}. Platform style: ${ctx.platform ?? 'short-form video'}.`;

  const userPrompt = `Write 5 hook variants for this concept: "${ctx.topic}"
${ctx.niche ? `Creator niche: ${ctx.niche}` : ''}`;

  return { systemPrompt, userPrompt };
}

// ─── Full Ad Creative Pack ────────────────────────────────────────────────────

export function buildAdCopyFullPrompt(ctx: BasePromptContext & { productName?: string }) {
  const systemPrompt = `You are a performance marketing copywriter who creates complete ad creative packs for social media.
Output a full ad creative pack with these clearly labelled sections:
  HEADLINE: 3 headline variants (one per line, max 10 words each) — mix urgency, curiosity, benefit
  BODY COPY: 3–4 sentences driving the core value proposition — benefit-first, no waffle
  CTA: 3 call-to-action button text variants (2–5 words each)
  OBJECTION HANDLER: One sentence that pre-empts the main objection
  SOCIAL PROOF ANGLE: One hook sentence framing a testimonial or case study ad variant
Tone: ${ctx.tone ?? 'professional'}. Platform: ${ctx.platform ?? 'social media'}. Conversion-focused.`;

  const userPrompt = `Create a full ad creative pack for: "${ctx.topic}"
${ctx.productDescription ? `Product/offer: ${ctx.productDescription}` : ''}
${ctx.targetAudience ? `Target audience: ${ctx.targetAudience}` : ''}
${ctx.niche ? `Creator niche: ${ctx.niche}` : ''}`;

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
    case "short_video_ad":      return buildShortVideoAdPrompt(ctx);
    case "hook_variants":       return buildHookVariantsPrompt(ctx);
    case "ad_copy_full":        return buildAdCopyFullPrompt(ctx);
    case "weekly_summary":
      if (ctx.periodLabel) return buildWeeklySummaryPrompt(ctx as unknown as SummaryContext);
      return null;
    default:
      return null;
  }
}
