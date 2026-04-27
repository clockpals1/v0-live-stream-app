-- 033_ai_config.sql
--
-- AI Automation Hub — provider configuration & agent settings.
--
-- Mirrors the billing_config pattern exactly: one singleton row (id=1)
-- holds all AI provider API keys so they are managed from the admin
-- dashboard without env-var redeployments.
--
-- Keys are stored in the database (admin RLS only, service role for reads).
-- The lib/ai/config.ts loader always uses the admin client — RLS prevents
-- non-admin users from ever selecting these values.
--
-- PROVIDERS COVERED
-- -----------------
-- Text / LLM (FREE tier):
--   groq          — api.groq.com   Llama 3.1 70B/8B, Mixtral, Gemma 2
--   google_gemini — googleapis.com Gemini 1.5 Flash (free tier)
--   mistral       — api.mistral.ai open-mistral-7b (free tier)
--   together      — api.together.xyz Llama 3.1 70B Turbo (free credits)
--
-- Text / LLM (PREMIUM):
--   nvidia_nim    — integrate.api.nvidia.com Llama 3.1 405B, Mistral Large
--   openai        — api.openai.com GPT-4o, o1
--
-- Image (FREE):
--   huggingface   — api-inference.huggingface.co SDXL, FLUX.1
--
-- Image (PREMIUM):
--   stability     — api.stability.ai SDXL, SD3 Ultra
--   replicate     — api.replicate.com any image/video/music model
--
-- Video (FREE):
--   huggingface   — CogVideoX, LTX-Video (slow queue)
--
-- Video (PREMIUM):
--   runway        — runway.ml Gen-3 Alpha Turbo
--
-- Audio / Music (FREE):
--   huggingface   — MusicGen, Riffusion, Whisper transcription
--   elevenlabs    — TTS free tier (10k chars/month)
--   deepgram      — nova-2 transcription (free credits)
--
-- AGENT SETTINGS
-- --------------
-- agent_mode_enabled   — toggle for God-mode background automation
-- agent_max_steps      — how many subtasks one God-mode run can chain
-- agent_auto_publish   — allow agent to post to social without approval
-- agent_daily_ideas    — how many content ideas to generate per day run
--
-- SAFETY
-- ------
-- Additive only. No existing tables modified.
-- Singleton guard (id=1 CHECK) prevents duplicate rows.

CREATE TABLE IF NOT EXISTS ai_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- ─── Text / LLM ──────────────────────────────────────────────────
  groq_api_key           TEXT,
  groq_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  groq_default_model     TEXT    NOT NULL DEFAULT 'llama-3.3-70b-versatile',

  nvidia_api_key         TEXT,
  nvidia_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  nvidia_default_model   TEXT    NOT NULL DEFAULT 'meta/llama-3.1-70b-instruct',

  openai_api_key         TEXT,
  openai_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  openai_default_model   TEXT    NOT NULL DEFAULT 'gpt-4o-mini',

  google_gemini_api_key  TEXT,
  google_gemini_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  google_gemini_model    TEXT    NOT NULL DEFAULT 'gemini-1.5-flash',

  together_api_key       TEXT,
  together_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  together_default_model TEXT    NOT NULL DEFAULT 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',

  mistral_api_key        TEXT,
  mistral_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  mistral_default_model  TEXT    NOT NULL DEFAULT 'open-mistral-7b',

  -- ─── Image ───────────────────────────────────────────────────────
  huggingface_api_key    TEXT,
  huggingface_enabled    BOOLEAN NOT NULL DEFAULT FALSE,

  stability_api_key      TEXT,
  stability_enabled      BOOLEAN NOT NULL DEFAULT FALSE,

  replicate_api_key      TEXT,
  replicate_enabled      BOOLEAN NOT NULL DEFAULT FALSE,

  -- ─── Video ───────────────────────────────────────────────────────
  runway_api_key         TEXT,
  runway_enabled         BOOLEAN NOT NULL DEFAULT FALSE,

  -- ─── Audio / Music / Transcription ───────────────────────────────
  elevenlabs_api_key     TEXT,
  elevenlabs_enabled     BOOLEAN NOT NULL DEFAULT FALSE,

  deepgram_api_key       TEXT,
  deepgram_enabled       BOOLEAN NOT NULL DEFAULT FALSE,

  -- ─── Routing — which provider handles each capability ────────────
  -- Dropdown in admin UI. Must match a provider that has enabled=true.
  primary_text_provider  TEXT NOT NULL DEFAULT 'groq',
  primary_image_provider TEXT NOT NULL DEFAULT 'huggingface',
  primary_video_provider TEXT NOT NULL DEFAULT 'huggingface',
  primary_audio_provider TEXT NOT NULL DEFAULT 'groq',

  -- ─── God-mode Agent Settings ─────────────────────────────────────
  agent_mode_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  agent_max_steps        INTEGER NOT NULL DEFAULT 5
    CHECK (agent_max_steps BETWEEN 1 AND 20),
  -- When true the agent can publish assets without human review step.
  agent_auto_publish     BOOLEAN NOT NULL DEFAULT FALSE,
  -- How many content ideas to produce in the daily automation run.
  agent_daily_ideas      INTEGER NOT NULL DEFAULT 5
    CHECK (agent_daily_ideas BETWEEN 1 AND 20),

  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed with a safe empty row.
INSERT INTO ai_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS ai_config_updated_at ON ai_config;
CREATE TRIGGER ai_config_updated_at
  BEFORE UPDATE ON ai_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── RLS — admin-only (same as billing_config) ──────────────────────
ALTER TABLE ai_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read ai config" ON ai_config;
CREATE POLICY "Admins read ai config" ON ai_config
  FOR SELECT USING (public.is_admin_user());

DROP POLICY IF EXISTS "Admins write ai config" ON ai_config;
CREATE POLICY "Admins write ai config" ON ai_config
  FOR UPDATE
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());
