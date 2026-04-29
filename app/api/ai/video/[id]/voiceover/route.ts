import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAiConfig } from "@/lib/ai/config";
import { presignUpload } from "@/lib/storage/r2";

/**
 * POST /api/ai/video/[id]/voiceover
 *
 * Generates AI narration audio from the provided text using the
 * configured audio provider (OpenAI TTS or ElevenLabs), uploads
 * the MP3 to R2, and persists the URL in video_projects.metadata.
 *
 * Provider priority: OpenAI TTS → ElevenLabs (first configured wins).
 *
 * Body: { text: string; voice?: string }
 *   voice — OpenAI voice name: alloy|echo|fable|onyx|nova|shimmer
 *           ElevenLabs uses the default Rachel voice (configurable later)
 *
 * Returns: { ok: true, audioUrl: string }
 */

const OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
const ELEVENLABS_DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();
  const { data: host } = await admin
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host)
    return NextResponse.json({ error: "Host not found." }, { status: 404 });

  let body: { text?: string; voice?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* defaults */
  }
  const { text, voice = "alloy" } = body;
  if (!text?.trim())
    return NextResponse.json({ error: "text is required." }, { status: 400 });

  const { data: project } = await admin
    .from("video_projects")
    .select("id, metadata")
    .eq("id", id)
    .eq("host_id", host.id)
    .maybeSingle();
  if (!project)
    return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const cfg = await getAiConfig(admin);

  // ── Try OpenAI TTS ─────────────────────────────────────────────────
  let audioBuffer: ArrayBuffer | null = null;
  let contentType = "audio/mpeg";

  if (cfg?.openai_api_key && cfg.openai_enabled) {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.openai_api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text.trim().slice(0, 4096),
        voice: OPENAI_VOICES.includes(voice) ? voice : "alloy",
      }),
    });
    if (res.ok) {
      audioBuffer = await res.arrayBuffer();
    }
  }

  // ── Fall back to ElevenLabs ────────────────────────────────────────
  if (!audioBuffer && cfg?.elevenlabs_api_key && cfg.elevenlabs_enabled) {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_DEFAULT_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": cfg.elevenlabs_api_key,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: text.trim().slice(0, 5000),
          model_id: "eleven_monolingual_v1",
          voice_settings: { stability: 0.5, similarity_boost: 0.5 },
        }),
      },
    );
    if (res.ok) {
      audioBuffer = await res.arrayBuffer();
    }
  }

  // ── Fall back to StreamElements TTS (free, no key required) ──────
  if (!audioBuffer) {
    try {
      const seText = text.trim().slice(0, 500);
      const seRes = await fetch(
        `https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=${encodeURIComponent(seText)}`,
        { headers: { "User-Agent": "Mozilla/5.0", Accept: "audio/mpeg, audio/*" } },
      );
      if (seRes.ok && (seRes.headers.get("content-type") ?? "").includes("audio")) {
        audioBuffer = await seRes.arrayBuffer();
        contentType = "audio/mpeg";
      }
    } catch {
      /* fall through */
    }
  }

  if (!audioBuffer) {
    return NextResponse.json(
      {
        error: "no_provider",
        message:
          "No audio provider available. Add an OpenAI or ElevenLabs key in Admin → AI Configuration, or use the Record tab to narrate the script yourself.",
        noProvider: true,
      },
      { status: 400 },
    );
  }

  // ── Upload to R2 ───────────────────────────────────────────────────
  const objectKey = `video-projects/${id}/voiceover.mp3`;
  let audioUrl: string;

  try {
    const { uploadUrl, headers, publicUrl } = await presignUpload({
      objectKey,
      contentType,
    });
    const r2 = await fetch(uploadUrl, {
      method: "PUT",
      headers,
      body: audioBuffer,
    });
    if (r2.ok && publicUrl) {
      audioUrl = publicUrl;
    } else {
      // No public URL — encode as data URL so the client can play it
      throw new Error("no-public-url");
    }
  } catch {
    // R2 not configured — return as data URL for preview
    const bytes = new Uint8Array(audioBuffer);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    audioUrl = `data:${contentType};base64,${btoa(bin)}`;
  }

  // ── Persist to project metadata ────────────────────────────────────
  await admin
    .from("video_projects")
    .update({
      voiceover_status: "ready",
      metadata: {
        ...(project.metadata as Record<string, unknown>),
        voiceover_url: audioUrl,
      },
    })
    .eq("id", id);

  return NextResponse.json({ ok: true, audioUrl });
}
