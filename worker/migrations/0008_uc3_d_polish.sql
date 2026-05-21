-- D-list polish: gap-specific Notion deep link (D3) + audio failure surface (D1)
--
-- D3: store the full Notion page UUID alongside gap_title during the lazy
-- backfill in list-gaps. Lets pipeline-status emit notion_page_id so the
-- player's "Where this came from" can deep-link to the specific gap row
-- instead of dumping the user into the whole Learning Gaps Queue.
ALTER TABLE pipeline_state ADD COLUMN notion_page_id TEXT;

-- D1: surface audio cooking failures. W8.1 consumer writes audio_last_error
-- on retry/failure; pipeline-status emits it; player polling can distinguish
-- "still cooking" from "failed N times" and surface a retry path. Closes
-- the F14 root cause (was patched at the UI symptom level only).
ALTER TABLE learning_modules ADD COLUMN audio_last_error TEXT;
ALTER TABLE learning_modules ADD COLUMN audio_attempts_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE learning_modules ADD COLUMN audio_last_attempt_at INTEGER;
