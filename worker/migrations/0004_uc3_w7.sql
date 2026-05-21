-- §8.4a.21 W7 — voice feedback NLU (S9) + revision dispatch (S10)
-- Apply: npx wrangler d1 migrations apply uc3_fundamentals --remote --config worker/wrangler.jsonc

CREATE TABLE IF NOT EXISTS module_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER NOT NULL REFERENCES learning_modules(id),
  voice_transcript TEXT NOT NULL,
  parsed_actions_json TEXT,                  -- JSON array of S9-emitted actions
  parser_model TEXT,                          -- 'claude-sonnet-4-6'
  parser_prompt_hash TEXT,
  parser_confidence TEXT,                     -- 'high' | 'medium' | 'low'
  parser_summary TEXT,                        -- one-sentence summary from S9
  dispatch_status TEXT NOT NULL,              -- pending | dispatched | partial | failed
  dispatch_results_json TEXT,                 -- JSON array of per-action results
  created_at INTEGER NOT NULL,
  dispatched_at INTEGER,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_feedback_module ON module_feedback(module_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON module_feedback(dispatch_status);
