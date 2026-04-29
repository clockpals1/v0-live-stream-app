import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAiConfig } from "@/lib/ai/config";
import { presignUpload } from "@/lib/storage/r2";

/**
 * POST /api/ai/video/[id]/generate-visuals
 *
 * Generates an AI image for ONE scene using the configured image
 * provider (HuggingFace FLUX.1-schnell or Stability AI SDXL),
 * uploads the result to R2, and persists the URL in the scene's
 * image_url field within the scenes JSONB array.
 *
 * Called once per scene by the client so the UI can update
 * progressively ("Scene 1 / 5 done…") without a single long-running
 * request.
 *
 * Body: { sceneIndex: number }
 *
 * Returns: { ok: true, sceneIndex, sceneId, imageUrl }
 */

const HF_MODEL = "black-forest-labs/FLUX.1-schnell";
const STABILITY_URL =
  "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image";

interface SceneRow {
  id: string;
  visual_prompt?: string;
  image_url?: string;
  [key: string]: unknown;
}

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

  let body: { sceneIndex?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* use defaults */
  }
  const { sceneIndex } = body;
  if (typeof sceneIndex !== "number")
    return NextResponse.json(
      { error: "sceneIndex (number) is required." },
      { status: 400 },
    );

  const { data: project } = await admin
    .from("video_projects")
    .select("id, scenes")
    .eq("id", id)
    .eq("host_id", host.id)
    .maybeSingle();
  if (!project)
    return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const scenes = ((project.scenes as SceneRow[]) ?? []);
  if (sceneIndex < 0 || sceneIndex >= scenes.length)
    return NextResponse.json({ error: "Invalid sceneIndex." }, { status: 400 });

  const scene = scenes[sceneIndex];
  const prompt = scene.visual_prompt;
  if (!prompt?.trim())
    return NextResponse.json(
      { error: "Scene has no visual_prompt." },
      { status: 400 },
    );

  // ── AI config ──────────────────────────────────────────────────────
  const cfg = await getAiConfig(admin);

  // Prefer the admin-configured primary image provider, then fallback
  const preferredProvider = cfg?.primary_image_provider ?? "huggingface";
  let apiKey: string | null = null;
  let useHuggingFace = false;

  if (
    preferredProvider === "huggingface" &&
    cfg?.huggingface_enabled &&
    cfg.huggingface_api_key
  ) {
    apiKey = cfg.huggingface_api_key;
    useHuggingFace = true;
  } else if (
    preferredProvider === "stability" &&
    cfg?.stability_enabled &&
    cfg.stability_api_key
  ) {
    apiKey = cfg.stability_api_key;
  } else if (cfg?.huggingface_api_key && cfg.huggingface_enabled) {
    apiKey = cfg.huggingface_api_key;
    useHuggingFace = true;
  } else if (cfg?.stability_api_key && cfg.stability_enabled) {
    apiKey = cfg.stability_api_key;
  }

  // ── Generate image ─────────────────────────────────────────────────
  let imageBuffer: ArrayBuffer | null = null;
  let contentType = "image/jpeg";

  // 1. HuggingFace (when configured)
  if (useHuggingFace && apiKey) {
    try {
      const res = await fetch(
        `https://api-inference.huggingface.co/models/${HF_MODEL}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            inputs: prompt,
            parameters: { num_inference_steps: 4 },
          }),
        },
      );
      if (res.ok) {
        const ct = res.headers.get("content-type") ?? "image/jpeg";
        if (!ct.includes("application/json")) {
          imageBuffer = await res.arrayBuffer();
          contentType = ct;
        }
      }
    } catch {
      // fall through to next provider
    }
  }

  // 2. Stability AI (when configured and HF didn't work)
  if (!imageBuffer && apiKey && !useHuggingFace) {
    try {
      const res = await fetch(STABILITY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          text_prompts: [{ text: prompt, weight: 1 }],
          width: 896,
          height: 512,
          steps: 20,
          samples: 1,
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          artifacts?: { base64?: string }[];
        };
        const b64 = json.artifacts?.[0]?.base64;
        if (b64) {
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++)
            bytes[i] = binary.charCodeAt(i);
          imageBuffer = bytes.buffer;
          contentType = "image/png";
        }
      }
    } catch {
      // fall through to Pollinations
    }
  }

  // ── Upload buffer to R2 (only when a provider returned bytes) ─────
  let imageUrl: string | null = null;

  if (imageBuffer) {
    const ext = contentType.includes("png") ? "png" : "jpg";
    const objectKey = `video-projects/${id}/scenes/${scene.id}.${ext}`;
    try {
      const { uploadUrl, headers, publicUrl } = await presignUpload({
        objectKey,
        contentType,
      });
      const r2 = await fetch(uploadUrl, {
        method: "PUT",
        headers,
        body: imageBuffer,
      });
      if (r2.ok) {
        imageUrl = publicUrl ?? objectKey;
      }
    } catch {
      // R2 not configured — encode as data URL
      const bytes = new Uint8Array(imageBuffer);
      let bin = "";
      for (let i = 0; i < bytes.length; i++)
        bin += String.fromCharCode(bytes[i]);
      imageUrl = `data:${contentType};base64,${btoa(bin)}`;
    }
  }

  // 3. Pollinations.ai — free, no API key, no server fetch needed.
  //    Return the URL directly so the browser loads it from Pollinations CDN.
  //    This avoids the Cloudflare Worker 30s wall-clock timeout entirely.
  if (!imageUrl) {
    const encodedPrompt = encodeURIComponent(
      `${prompt}, high quality, cinematic, short video thumbnail`,
    );
    imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=896&height=512&nologo=true&model=flux-schnell&seed=${Date.now()}`;
  }
  const finalImageUrl: string = imageUrl;

  // ── Persist updated scene ──────────────────────────────────────────
  const updatedScenes = scenes.map((s, i) =>
    i === sceneIndex ? { ...s, image_url: finalImageUrl } : s,
  );
  await admin
    .from("video_projects")
    .update({ scenes: updatedScenes, status: "visuals_pending" })
    .eq("id", id);

  return NextResponse.json({
    ok: true,
    sceneIndex,
    sceneId: scene.id,
    imageUrl: finalImageUrl,
  });
}
