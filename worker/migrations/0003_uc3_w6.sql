-- §8.4a.21 W6 — review brief metadata (S8 stage)
-- Apply: npx wrangler d1 migrations apply uc3_fundamentals --remote --config worker/wrangler.jsonc

CREATE TABLE IF NOT EXISTS review_briefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER NOT NULL UNIQUE REFERENCES learning_modules(id),
  script_r2_key TEXT,
  audio_r2_key TEXT,
  voice_id TEXT,
  model TEXT,                                -- 'claude-sonnet-4-6' for script
  char_count INTEGER,                        -- script char count
  audio_bytes INTEGER,                       -- mp3 size
  status TEXT NOT NULL,                      -- pending | script-generated | audio-generated | failed
  generated_at INTEGER,
  audio_generated_at INTEGER,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_briefs_module ON review_briefs(module_id);
CREATE INDEX IF NOT EXISTS idx_briefs_status ON review_briefs(status);
