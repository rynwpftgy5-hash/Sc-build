-- §8.4a.25c — Auto-fix loop with tiered hybrid (T1 auto-merge / T2 wait / T3 punt)
--
-- One row per fix attempt. A feedback can have multiple attempts (re-propose
-- after rejection). Status state machine:
--   pending → proposing → proposed (T1|T2|T3)
--   T1: proposed → applying → ci-running → merged
--   T2: proposed → (awaiting human) → applying → ci-running → merged
--   T3: proposed (status='punted', no PR opened)
--   Failure modes: failed (with error_text), rejected (user dismissed)

CREATE TABLE IF NOT EXISTS feedback_fixes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id INTEGER NOT NULL REFERENCES ui_feedback(id),
  tier TEXT,                            -- 'T1' | 'T2' | 'T3' (null while pending)
  tier_rationale TEXT,
  proposed_diff TEXT,                   -- unified diff
  proposed_rationale TEXT,
  files_touched TEXT,                   -- JSON array of relative paths
  pr_url TEXT,
  pr_number INTEGER,
  branch_name TEXT,
  workflow_run_id TEXT,
  workflow_run_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  ci_state TEXT,                        -- 'pending' | 'success' | 'failure'
  error_text TEXT,
  created_at INTEGER NOT NULL,
  proposed_at INTEGER,
  applied_at INTEGER,
  merged_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fixes_feedback ON feedback_fixes(feedback_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fixes_status ON feedback_fixes(status);
