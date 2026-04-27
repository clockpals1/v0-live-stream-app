-- Migration 036: Update groq_default_model to a non-decommissioned model.
--
-- llama-3.1-70b-versatile was deprecated by Groq on 2025-01-14.
-- Replacement: llama-3.3-70b-versatile (same capability tier, actively supported).
-- Reference: https://console.groq.com/docs/deprecations
--
-- This only updates rows that still carry the old default; rows where an admin
-- has already set a different model are left untouched.

UPDATE ai_config
SET    groq_default_model = 'llama-3.3-70b-versatile'
WHERE  id = 1
  AND  groq_default_model = 'llama-3.1-70b-versatile';

-- Also update the column DEFAULT so new rows seed the correct model.
ALTER TABLE ai_config
  ALTER COLUMN groq_default_model SET DEFAULT 'llama-3.3-70b-versatile';
