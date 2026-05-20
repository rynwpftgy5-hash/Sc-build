-- §8.4a.25 — Universal feedback button + adversarial UAT self-audit
--
-- ui_feedback        : everything Campbell taps the 🚩 button to report
-- audit_blindspots   : adversarial pass — why didn't our UAT catch this?
--
-- D1 is source of truth. Notion mirror is best-effort (FEEDBACK_DB_ID secret optional).

CREATE TABLE IF NOT EXISTS ui_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  surface TEXT NOT NULL,                 -- '/uc3', '/desk', '/reading', etc.
  view_state_json TEXT,                  -- {url, currently_playing_module, current_view, ...}
  type TEXT NOT NULL,                    -- 'bug' | 'confusion' | 'feature' | 'question'
  notes_text TEXT,                       -- user-typed or transcribed
  voice_transcript TEXT,                 -- if voice path used; same as notes_text typically
  audio_r2_key TEXT,                     -- optional R2 key for the voice memo
  user_agent TEXT,                       -- browser/device hint
  captured_at INTEGER NOT NULL,          -- unix seconds, client-supplied (clamped server-side)
  status TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'in_progress' | 'resolved' | 'wontfix'
  resolution_note TEXT,
  resolved_at INTEGER,
  notion_page_id TEXT,                   -- best-effort mirror target
  claude_session_ref TEXT                -- optional — session id that picked it up
);
CREATE INDEX IF NOT EXISTS idx_ui_feedback_status ON ui_feedback(status, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ui_feedback_surface ON ui_feedback(surface);

CREATE TABLE IF NOT EXISTS audit_blindspots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id INTEGER NOT NULL REFERENCES ui_feedback(id),
  missed_check TEXT,                     -- which existing F-entry should have caught it
  why_text TEXT NOT NULL,                -- one-paragraph diagnosis
  proposed_new_check TEXT NOT NULL,      -- the verification step we should add
  pattern_category TEXT,                 -- 'F14-style polling' | 'F13-style tests-pass' | 'new'
  status TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'applied' | 'rejected'
  resolution_note TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  applied_to_adr TEXT,                   -- e.g. 'F15' once promoted into ADR-024
  analyzer_model TEXT,                   -- 'claude-sonnet-4-6' etc. for trace
  analyzer_cost_cents INTEGER            -- rough cost trace
);
CREATE INDEX IF NOT EXISTS idx_blindspots_status ON audit_blindspots(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blindspots_feedback ON audit_blindspots(feedback_id);
