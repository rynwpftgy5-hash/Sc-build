-- Self-bootstrap A: runtime_config holds Worker-managed state that doesn't
-- belong in env secrets and isn't tied to any specific business object.
--
-- First use: auto-created Notion mirror DB IDs. The Worker creates the
-- Insight Mirror + Research Note Mirror DBs on first capture (parented under
-- PROJECT_LOG, using the existing NOTION_TOKEN's access), persists the IDs
-- here, and reads them on subsequent writes + on captures-today queries.
-- Env-secret override (INSIGHT_MIRROR_DB_ID / RESEARCH_NOTE_MIRROR_DB_ID)
-- still wins where set; runtime_config is the no-touch fallback.

CREATE TABLE IF NOT EXISTS runtime_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
