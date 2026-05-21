-- §8.4a.21 W4 — UC3 Fundamentals Learning Modules
-- Tier 4 Pedagogical Artifacts state store
-- Apply: npx wrangler d1 migrations apply uc3_fundamentals --remote

CREATE TABLE IF NOT EXISTS learning_modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gap_id TEXT NOT NULL,
  series_id INTEGER,
  position_in_series INTEGER,
  status TEXT NOT NULL,
  learning_objective TEXT NOT NULL,
  dependencies_json TEXT,
  outline_json TEXT,
  audio_r2_key TEXT,
  transcript_r2_key TEXT,
  created_at INTEGER NOT NULL,
  approved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_modules_gap ON learning_modules(gap_id);
CREATE INDEX IF NOT EXISTS idx_modules_status ON learning_modules(status);

CREATE TABLE IF NOT EXISTS module_citations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER NOT NULL REFERENCES learning_modules(id),
  claim_text TEXT,
  source_url TEXT NOT NULL,
  source_name TEXT,
  source_type TEXT,
  source_tier TEXT,
  scope_note_used TEXT,
  candidate INTEGER NOT NULL DEFAULT 1,
  verified_pass1_at INTEGER,
  verified_pass2_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_citations_module ON module_citations(module_id);

CREATE TABLE IF NOT EXISTS verification_trail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER REFERENCES learning_modules(id),
  stage TEXT NOT NULL,
  model TEXT,
  prompt_hash TEXT,
  request_json TEXT,
  response_json TEXT,
  ok INTEGER NOT NULL,
  error_text TEXT,
  decided_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vt_module ON verification_trail(module_id);
CREATE INDEX IF NOT EXISTS idx_vt_stage ON verification_trail(stage);

CREATE TABLE IF NOT EXISTS pipeline_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gap_id TEXT NOT NULL UNIQUE,
  workflow_instance_id TEXT,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS analog_rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER NOT NULL REFERENCES learning_modules(id),
  analog_author TEXT NOT NULL,
  analog_work TEXT NOT NULL,
  structural_fit REAL NOT NULL,
  confidence REAL NOT NULL,
  epistemic_strength REAL NOT NULL,
  epistemic_strength_label TEXT NOT NULL,
  constitutive_role REAL NOT NULL,
  constitutive_role_label TEXT NOT NULL,
  composite REAL NOT NULL,
  advance_to_drafting INTEGER NOT NULL,
  rationale TEXT,
  rubric_notes TEXT,
  ranked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analog_module ON analog_rankings(module_id);

CREATE TABLE IF NOT EXISTS module_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gap_id TEXT NOT NULL UNIQUE,
  module_ids_json TEXT NOT NULL,
  spaced_repeat_3d INTEGER,
  spaced_repeat_1w INTEGER,
  spaced_repeat_3w INTEGER,
  created_at INTEGER NOT NULL
);
