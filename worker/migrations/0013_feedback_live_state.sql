-- §8.4a.25 F15 — separate "merged to main" from "live on the running Worker".
-- When a PR merges via the auto-fix workflow, we record merged_at. When ANY
-- subsequent deploy happens (manual or auto), the Worker startup self-marks
-- live_at on every still-pending row. /feedback surface shows two states.

ALTER TABLE feedback_fixes ADD COLUMN live_at INTEGER;
ALTER TABLE feedback_fixes ADD COLUMN deploy_version_id TEXT;
