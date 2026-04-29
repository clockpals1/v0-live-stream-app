/**
 * lib/ai/parse-video-script.ts
 *
 * Robust parser for AI-generated short video scripts.
 *
 * Handles every realistic LLM output variation:
 *   • Plain:    HOOK (first 3 seconds): text
 *   • Bold:     **HOOK (first 3 seconds):** text
 *   • Header:   ## HOOK\ntext
 *   • No qual:  HOOK: text
 *   • Any case: hook: text
 *
 * Guarantees non-empty scenes even on partial parse failures:
 *   1. Tries structured section extraction.
 *   2. Falls back to chunking the raw text if sections are empty.
 *   3. Returns template placeholder scenes as a last resort.
 */

export interface VideoScene {
  id: string;
  order: number;
  duration: number;
  type: "hook" | "setup" | "main" | "cta" | "outro";
  script: string;
  visual_prompt: string;
  shot_type: "close-up" | "mid-shot" | "wide";
  on_screen_text: string;
  notes: string;
}

export interface ParsedVideoScript {
  hook: string;
  concept: string;
  script_body: string;
  cta: string;
  caption: string;
  scenes: VideoScene[];
}

// ─── Text normalisation ────────────────────────────────────────────────────────

/**
 * Strip markdown formatting so the regex doesn't need to handle it inline.
 * Handles: **bold**, *italic*, ## headers, --- dividers, leading bullets.
 */
function normalizeAiOutput(text: string): string {
  return text
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")   // **bold** → bold
    .replace(/^#{1,6}\s*/gm, "")                  // ## Header → Header
    .replace(/^[-─]{3,}\s*$/gm, "")               // --- dividers → empty
    .replace(/^\s*[-•*]\s+/gm, "")                // - bullet → plain
    .replace(/\r\n/g, "\n")
    .trim();
}

// ─── Section extraction ────────────────────────────────────────────────────────

// Alternation used in lookahead — covers every section label as a regex pattern
const SECTION_ALT = "HOOK|CONCEPT|SCRIPT\\s+BODY|CTA|CAPTION|PROBLEM|SOLUTION|PROOF\\s+POINT|VISUAL\\s+DIRECTION";

function extractSection(normalizedText: string, labelPattern: string): string {
  // Strategy 1: LABEL (optional qualifier): content — until next section or EOF
  const re = new RegExp(
    `(?:^|\\n)\\s*${labelPattern}(?:\\s*\\([^)]*\\))?\\s*:[ \\t]*([\\s\\S]+?)(?=\\n\\s*(?:${SECTION_ALT})(?:\\s*\\([^)]*\\))?\\s*:|$)`,
    "i",
  );
  const m = normalizedText.match(re);
  if (m?.[1]?.trim()) return m[1].trim();

  // Strategy 2: LABEL on its own line, content follows on next line
  const reHeader = new RegExp(
    `(?:^|\\n)\\s*${labelPattern}(?:\\s*\\([^)]*\\))?\\s*\\n+([\\s\\S]+?)(?=\\n\\s*(?:${SECTION_ALT})(?:\\s*\\([^)]*\\))?\\s*(?:\\n|:)|$)`,
    "i",
  );
  const mh = normalizedText.match(reHeader);
  if (mh?.[1]?.trim()) return mh[1].trim();

  // Strategy 3: single-line fallback
  const reLine = new RegExp(
    `(?:^|\\n)\\s*${labelPattern}(?:\\s*\\([^)]*\\))?\\s*:[ \\t]*(.+)`,
    "i",
  );
  const ml = normalizedText.match(reLine);
  return ml?.[1]?.trim() ?? "";
}

// ─── Scene derivation ──────────────────────────────────────────────────────────

function makeScene(
  partial: Pick<VideoScene, "id" | "order" | "duration" | "type" | "script" | "visual_prompt" | "shot_type" | "on_screen_text" | "notes">,
): VideoScene {
  return { ...partial };
}

function splitBodyIntoParts(body: string, parts: number): string[] {
  if (!body) return [];
  const sentences = body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= parts) return sentences.length ? [body] : [];
  const chunkSize = Math.ceil(sentences.length / parts);
  const chunks: string[] = [];
  for (let i = 0; i < parts; i++) {
    const chunk = sentences.slice(i * chunkSize, (i + 1) * chunkSize).join(" ");
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function deriveScenesFromScript(
  parsed: Omit<ParsedVideoScript, "scenes">,
  videoLength: string,
): VideoScene[] {
  const duration = parseInt(videoLength, 10) || 30;
  const scenes: VideoScene[] = [];

  if (duration <= 15) {
    // 3 scenes: hook(3s) + main(9s) + cta(3s)
    if (parsed.hook)
      scenes.push(makeScene({
        id: "scene_1", order: 1, duration: 3, type: "hook",
        script: parsed.hook,
        visual_prompt: "Extreme close-up or jump-cut opener — bold, high-energy, scroll-stopping",
        shot_type: "close-up",
        on_screen_text: parsed.hook.slice(0, 50),
        notes: "First 3 seconds — must stop the scroll",
      }));

    if (parsed.script_body)
      scenes.push(makeScene({
        id: "scene_2", order: 2, duration: 9, type: "main",
        script: parsed.script_body,
        visual_prompt: "Mid-shot showing the main point — clear, direct, no clutter",
        shot_type: "mid-shot",
        on_screen_text: parsed.concept?.slice(0, 50) ?? "",
        notes: "Core value delivery",
      }));

    if (parsed.cta)
      scenes.push(makeScene({
        id: "scene_3", order: 3, duration: 3, type: "cta",
        script: parsed.cta,
        visual_prompt: "Direct address to lens — confident, clear CTA visible",
        shot_type: "close-up",
        on_screen_text: parsed.cta.slice(0, 50),
        notes: "Drive the action",
      }));

  } else if (duration <= 30) {
    // 4 scenes: hook(3s) + setup(5s) + main(14s) + cta(8s)
    if (parsed.hook)
      scenes.push(makeScene({
        id: "scene_1", order: 1, duration: 3, type: "hook",
        script: parsed.hook,
        visual_prompt: "Close-up pattern interrupt — unexpected visual or bold reaction that stops the scroll",
        shot_type: "close-up",
        on_screen_text: parsed.hook.slice(0, 50),
        notes: "Hook viewer immediately",
      }));

    if (parsed.concept)
      scenes.push(makeScene({
        id: "scene_2", order: 2, duration: 5, type: "setup",
        script: parsed.concept,
        visual_prompt: "Wide or mid shot establishing context — show the problem or situation",
        shot_type: "wide",
        on_screen_text: parsed.concept.slice(0, 50),
        notes: "Frame the story / problem",
      }));

    if (parsed.script_body)
      scenes.push(makeScene({
        id: "scene_3", order: 3, duration: 14, type: "main",
        script: parsed.script_body,
        visual_prompt: "Mid-shot with movement — demonstrate the solution or insight with energy",
        shot_type: "mid-shot",
        on_screen_text: "",
        notes: "Main value delivery — keep energy up",
      }));

    if (parsed.cta)
      scenes.push(makeScene({
        id: "scene_4", order: 4, duration: 8, type: "cta",
        script: parsed.cta,
        visual_prompt: "Direct address to camera — confident eye contact, CTA text overlay visible",
        shot_type: "close-up",
        on_screen_text: parsed.cta.slice(0, 50),
        notes: "Convert viewer to action",
      }));

  } else {
    // 60s: 6 scenes — hook(3s) + setup(7s) + main×3(~32s each) + cta(10s)
    if (parsed.hook)
      scenes.push(makeScene({
        id: "scene_1", order: 1, duration: 3, type: "hook",
        script: parsed.hook,
        visual_prompt: "Bold close-up opener — high contrast, unexpected moment or reaction",
        shot_type: "close-up",
        on_screen_text: parsed.hook.slice(0, 50),
        notes: "Pattern interrupt — 3 second hook",
      }));

    if (parsed.concept)
      scenes.push(makeScene({
        id: "scene_2", order: 2, duration: 7, type: "setup",
        script: parsed.concept,
        visual_prompt: "Wide establishing shot — set context and frame the core problem/story",
        shot_type: "wide",
        on_screen_text: parsed.concept.slice(0, 50),
        notes: "Establish stakes",
      }));

    const bodyParts = splitBodyIntoParts(parsed.script_body, 3);
    const partDuration = Math.floor(40 / Math.max(bodyParts.length, 1));
    bodyParts.forEach((part, i) => {
      scenes.push(makeScene({
        id: `scene_${i + 3}`, order: i + 3, duration: partDuration, type: "main",
        script: part,
        visual_prompt: `Mid-shot — point ${i + 1} of your argument. Keep energy and pacing up`,
        shot_type: "mid-shot",
        on_screen_text: "",
        notes: `Main content — part ${i + 1} of ${bodyParts.length}`,
      }));
    });

    if (parsed.cta)
      scenes.push(makeScene({
        id: `scene_${scenes.length + 1}`, order: scenes.length + 1, duration: 10, type: "cta",
        script: parsed.cta,
        visual_prompt: "Strong direct address — hold eye contact, product/offer visible in frame",
        shot_type: "close-up",
        on_screen_text: parsed.cta.slice(0, 50),
        notes: "Drive conversion — end with energy",
      }));
  }

  return scenes.filter((s) => s.script.length > 0);
}

// ─── Fallback scene generator ─────────────────────────────────────────────────

/**
 * Creates scenes from raw text chunks when section extraction fails entirely.
 * Splits the raw text into meaningful sentences and maps them to scene types.
 */
function createFallbackScenes(rawText: string, videoLength: string): VideoScene[] {
  const duration = parseInt(videoLength, 10) || 30;

  const cleanText = rawText
    .replace(/\*{1,2}/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^[A-Z\s]+(?:\([^)]*\))?:\s*/gm, "") // strip labels themselves
    .trim();

  const sentences = cleanText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);

  if (sentences.length === 0) {
    return createTemplateScenes(duration);
  }

  const total = duration <= 15 ? 3 : duration <= 30 ? 4 : 6;
  const types: Array<VideoScene["type"]> = ["hook", "setup", "main", "main", "main", "cta"];
  const shots: Array<VideoScene["shot_type"]> = ["close-up", "wide", "mid-shot", "mid-shot", "mid-shot", "close-up"];
  const durations = duration <= 15
    ? [3, 9, 3]
    : duration <= 30
      ? [3, 5, 14, 8]
      : [3, 7, 11, 11, 11, 10];

  const count = Math.min(total, sentences.length);
  const chunkSize = Math.ceil(sentences.length / count);

  return Array.from({ length: count }, (_, i) => {
    const chunk = sentences.slice(i * chunkSize, (i + 1) * chunkSize).join(" ") || sentences[0];
    return makeScene({
      id: `scene_${i + 1}`,
      order: i + 1,
      duration: durations[i] ?? 5,
      type: types[i] ?? "main",
      script: chunk,
      visual_prompt: `${shots[i] ?? "mid-shot"} — ${["Bold opener, stop the scroll", "Establish context", "Core point", "Supporting detail", "Supporting detail", "Drive action"][i] ?? "Supporting visual"}`,
      shot_type: shots[i] ?? "mid-shot",
      on_screen_text: i === 0 ? chunk.slice(0, 50) : "",
      notes: ["Hook opening", "Setup & context", "Main point", "Supporting detail", "Supporting detail", "CTA close"][i] ?? "Edit this scene",
    });
  });
}

/**
 * Absolute last resort: 4 template scenes the user can fill in.
 */
function createTemplateScenes(duration: number): VideoScene[] {
  const configs: Array<Omit<VideoScene, "id" | "order">> = [
    { duration: 3,  type: "hook",  script: "✏️ Write your hook here — the first 3 seconds must stop the scroll.", visual_prompt: "Bold close-up opener — high contrast, unexpected moment", shot_type: "close-up", on_screen_text: "Edit hook text", notes: "Critical — hook the viewer immediately" },
    { duration: 5,  type: "setup", script: "✏️ Set up your story, problem, or topic here.", visual_prompt: "Wide or mid shot establishing context", shot_type: "wide",     on_screen_text: "", notes: "Frame the story / problem" },
    { duration: Math.max(duration - 16, 8), type: "main", script: "✏️ Deliver your main content, insight, or demonstration here.", visual_prompt: "Mid-shot with energy — show the solution or key point", shot_type: "mid-shot", on_screen_text: "", notes: "Core value delivery" },
    { duration: 8,  type: "cta",   script: "✏️ Write your call to action — follow, buy, click, or comment.", visual_prompt: "Direct eye contact to camera — confident, clear CTA visible", shot_type: "close-up", on_screen_text: "Edit CTA text", notes: "Drive the action" },
  ];
  return configs.map((c, i) => makeScene({ id: `scene_${i + 1}`, order: i + 1, ...c }));
}

// ─── Public API ────────────────────────────────────────────────────────────────

export function parseVideoScript(
  rawText: string,
  videoLength: string = "30",
): ParsedVideoScript {
  const normalized = normalizeAiOutput(rawText);

  const hook        = extractSection(normalized, "HOOK");
  const concept     = extractSection(normalized, "CONCEPT");
  const script_body = extractSection(normalized, "SCRIPT\\s+BODY");
  const cta         = extractSection(normalized, "CTA");
  const caption     = extractSection(normalized, "CAPTION");

  // For ad variant: if concept/script_body are empty, try ad-specific labels
  const effectiveConcept    = concept    || extractSection(normalized, "PROBLEM");
  const effectiveScriptBody = script_body || [
    extractSection(normalized, "SOLUTION"),
    extractSection(normalized, "PROOF\\s+POINT"),
  ].filter(Boolean).join("\n\n");

  const partial = {
    hook,
    concept:     effectiveConcept,
    script_body: effectiveScriptBody,
    cta,
    caption:     caption || extractSection(normalized, "VISUAL\\s+DIRECTION"),
  };

  // Derive scenes from parsed content
  let scenes = deriveScenesFromScript(partial, videoLength);

  // Guaranteed fallback: never return 0 scenes
  if (scenes.length === 0) {
    const hasAnyContent = Object.values(partial).some((v) => v.length > 0);
    scenes = hasAnyContent
      ? createFallbackScenes(rawText, videoLength)
      : createTemplateScenes(parseInt(videoLength, 10) || 30);
  }

  return { ...partial, scenes };
}
