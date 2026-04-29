/**
 * lib/ai/parse-video-script.ts
 *
 * Parses the raw AI text output from short_video_script / short_video_ad tasks
 * into a structured video project: discrete content fields + an ordered scene list.
 *
 * The parser handles the labelled-section format used by buildShortVideoScriptPrompt:
 *   HOOK (first 3 seconds): ...
 *   CONCEPT: ...
 *   SCRIPT BODY: ...
 *   CTA: ...
 *   CAPTION: ...
 *
 * For the ad variant it also handles:
 *   PROBLEM: ...  SOLUTION: ...  PROOF POINT: ...  VISUAL DIRECTION: ...
 *
 * Scenes are auto-derived from the parsed sections based on video length.
 * This gives an immediately useful storyboard without requiring a second AI call.
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

// ─── Section extraction ────────────────────────────────────────────────────────

const SECTION_LABELS = [
  "HOOK", "CONCEPT", "SCRIPT BODY", "CTA", "CAPTION",
  "PROBLEM", "SOLUTION", "PROOF POINT", "VISUAL DIRECTION",
];

function extractSection(text: string, label: string): string {
  // Match label (with optional qualifier like "(first 3 seconds)"), colon, then content
  // until the next known section label or end of string
  const labelsAlt = SECTION_LABELS.join("|");
  const re = new RegExp(
    `${label}(?:\\s*\\([^)]*\\))?\\s*:\\s*([\\s\\S]+?)(?=\\n(?:${labelsAlt})(?:\\s*\\([^)]*\\))?\\s*:|$)`,
    "i",
  );
  const m = text.match(re);
  if (m?.[1]?.trim()) return m[1].trim();

  // Fallback: single-line extraction
  const reLine = new RegExp(`${label}(?:\\s*\\([^)]*\\))?\\s*:\\s*(.+)`, "i");
  const ml = text.match(reLine);
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

// ─── Public API ────────────────────────────────────────────────────────────────

export function parseVideoScript(
  rawText: string,
  videoLength: string = "30",
): ParsedVideoScript {
  const hook       = extractSection(rawText, "HOOK");
  const concept    = extractSection(rawText, "CONCEPT");
  const script_body = extractSection(rawText, "SCRIPT\\s*BODY");
  const cta        = extractSection(rawText, "CTA");
  const caption    = extractSection(rawText, "CAPTION");

  const partial = { hook, concept, script_body, cta, caption };
  const scenes = deriveScenesFromScript(partial, videoLength);

  return { ...partial, scenes };
}
