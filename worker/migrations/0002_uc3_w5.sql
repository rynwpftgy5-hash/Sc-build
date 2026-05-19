-- §8.4a.21 W5 — drafting + verification state
-- Apply: npx wrangler d1 migrations apply uc3_fundamentals --remote
-- Adds: module_sections (per-beat drafts), section_claims (per-claim verification),
--       verification_passes (S6 aggregate + S7 holistic verdicts).

CREATE TABLE IF NOT EXISTS module_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER NOT NULL REFERENCES learning_modules(id),
  position INTEGER NOT NULL,
  section_type TEXT NOT NULL,                -- hook | core | sub_concept | integration | self_check
  draft_text TEXT,
  citations_json TEXT,                       -- per-beat citation list
  status TEXT NOT NULL,                      -- queued | drafted | rewrite_pending | verified | failed
  draft_iteration INTEGER NOT NULL DEFAULT 1,
  drafted_at INTEGER,
  polished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sections_module ON module_sections(module_id);
CREATE INDEX IF NOT EXISTS idx_sections_status ON module_sections(status);

CREATE TABLE IF NOT EXISTS section_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES module_sections(id),
  module_id INTEGER NOT NULL REFERENCES learning_modules(id),
  claim_text TEXT NOT NULL,
  cited_source_url TEXT,
  cited_source_name TEXT,
  verified_pass1 INTEGER,                    -- null=pending, 1=ok, 0=failed
  verified_pass1_at INTEGER,
  verification_notes TEXT,
  rewrite_count INTEGER NOT NULL DEFAULT 0,
  needs_human_review INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_claims_section ON section_claims(section_id);
CREATE INDEX IF NOT EXISTS idx_claims_module ON section_claims(module_id);

CREATE TABLE IF NOT EXISTS verification_passes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER NOT NULL REFERENCES learning_modules(id),
  pass_number INTEGER NOT NULL,              -- 1=S6 per-claim aggregate, 2=S7 holistic
  pass_type TEXT NOT NULL,                   -- per_claim | cross_source | internal_consistency | pedagogy
  model TEXT NOT NULL,
  verdict TEXT NOT NULL,                     -- approved | revise | reject
  rationale TEXT,
  decided_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vp_module ON verification_passes(module_id);
