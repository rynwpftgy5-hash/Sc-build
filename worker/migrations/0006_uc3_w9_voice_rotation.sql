-- §8.4a.23 — Voice rotation per-module.
-- Each module in a series gets a distinct curated ElevenLabs voice from the
-- rotation pool. voice_id is assigned at S1 (topic decomposition) when the
-- module is first inserted, and stays stable across regenerations.
--
-- Apply: npx wrangler d1 migrations apply uc3_fundamentals --remote --config worker/wrangler.jsonc

ALTER TABLE learning_modules ADD COLUMN voice_id TEXT;
