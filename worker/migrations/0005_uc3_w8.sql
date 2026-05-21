-- §8.4a.21 W8 — Full-module TTS (S11) + Library (S12) + Errata + spaced-rep.
-- Apply: npx wrangler d1 migrations apply uc3_fundamentals --remote --config worker/wrangler.jsonc

-- ── Module Errata: in-flight claim flags during playback ─────────────────
CREATE TABLE IF NOT EXISTS module_errata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER NOT NULL REFERENCES learning_modules(id),
  claim_id INTEGER REFERENCES section_claims(id),     -- nullable; ad-hoc claim refs
  timestamp_seconds INTEGER,                          -- where in audio Campbell flagged
  audio_context_url TEXT,                             -- optional 30s clip URL (W8.1)
  notes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',                -- 'open' | 'investigating' | 'resolved'
  notion_page_id TEXT,                                -- Notion mirror; null if write failed
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_errata_module ON module_errata(module_id);
CREATE INDEX IF NOT EXISTS idx_errata_status ON module_errata(status);

-- ── Spaced-repetition: 3 scheduled re-listen slots per approved module ───
CREATE TABLE IF NOT EXISTS spaced_rep_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER NOT NULL REFERENCES learning_modules(id),
  due_at INTEGER NOT NULL,                            -- unix seconds
  cadence TEXT NOT NULL,                              -- '+3d' | '+1w' | '+3w'
  fired INTEGER NOT NULL DEFAULT 0,                   -- 1 once Campbell re-listens
  fired_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedule_due ON spaced_rep_schedule(fired, due_at);
CREATE INDEX IF NOT EXISTS idx_schedule_module ON spaced_rep_schedule(module_id);
