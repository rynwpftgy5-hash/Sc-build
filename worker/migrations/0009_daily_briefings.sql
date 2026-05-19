-- Item 2: Daily Briefing pipeline. One row per briefing-date; cron-triggered
-- generator produces a ~5-min audio digest from cross-domain analytical state.
-- Schema mirrors review_briefs in shape so the player's audio pipeline can
-- reuse the same R2-key + audio_bytes plumbing.

CREATE TABLE IF NOT EXISTS daily_briefings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  briefing_date TEXT NOT NULL UNIQUE,            -- YYYY-MM-DD (local-time day)
  generated_at INTEGER NOT NULL,                 -- unix seconds
  transcript_r2_key TEXT,                        -- R2 key for the script text
  audio_r2_key TEXT,                             -- R2 key for the mp3
  audio_bytes INTEGER,                           -- mp3 size for duration estimate
  source_summary TEXT,                           -- JSON: { ingest_count, insight_count, ... }
  status TEXT NOT NULL DEFAULT 'generating',     -- generating | ready | failed
  last_error TEXT,
  voice_id TEXT                                  -- ElevenLabs voice used
);

CREATE INDEX IF NOT EXISTS idx_daily_briefings_date ON daily_briefings(briefing_date);
CREATE INDEX IF NOT EXISTS idx_daily_briefings_status ON daily_briefings(status);
