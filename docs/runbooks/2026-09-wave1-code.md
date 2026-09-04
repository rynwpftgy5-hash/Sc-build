# RESTART_PLAN_2026-09 — Wave 1, Claude Code items

Execution record for the Code half of Wave 1 (Notion: RESTART_PLAN_2026-09 —
Cowork synthesis, page `3d148344-93df-8137-8c15-ccd39eae98d0`). Cowork items
W1-K1…K6 are tracked in Notion, not here. Every landed item also has a
PROJECT_LOG entry via `/api/log-append`.

## Pre-flight (2026-09-04)

| Check | Result |
|---|---|
| `npx wrangler whoami` | OK via OAuth re-login of 2026-09-04 (auto-refreshes). No `CLOUDFLARE_API_TOKEN` in the Code shell; not needed for local wrangler. |
| Live Worker version | `c9d5f99b-5f2a-4eaa-9ea3-c4508b824906`, deployed 2026-05-22T01:19:09Z, 100% traffic, 10 deployments total |
| n8n API key | Verified over REST: 23 workflows (19 active). The n8n MCP server inside Claude Code still holds the old key → update `~/.claude.json` and restart. |
| `MCP_CLIENT_TOKEN` | Not in any shell env; recover from browser `localStorage["spacesc_mcp_token"]` on `/desk`. It is NOT the n8n JWT. |

## W1-C1 — checkout reset ✅ landed 2026-09-04

1. Local diff saved: branch `wip/local-diff-2026-09-04` (commit c270187) + `~/code/spacesc-mcp-patches/2026-09-04-local-diff/` (tracked patch, vs-main patch, untracked tarball, stash list).
2. Four clean worktrees removed (`admiring-jang`, `funny-chatterjee`, `happy-mestorf`, scratchpad `main-wt`); `git worktree prune`.
3. `main` fast-forwarded to origin; `.gitignore.local-backup` / `README.md.local-backup` deleted (copies in the tarball).
4. Survey PR #27 merged (merge commit 4a133cd). PRs #7 / #22 were already closed.
5. Gate G (Stop hook to main): PR #28 merged (0773fd8). `.claude/settings.json` + `.claude/hooks/stop-reminder.sh` now on main.

## W1-C2 — UC3 hygiene ✅ code in PR #29; D1 mutation applied

- `worker/src/lib/daily-briefing.ts`: zero-material skip (`status='skipped'`), `isRealIngest` (Status=Complete + doc_id + title not `undefined…`), `force` option.
- `worker/src/handlers/uc3.ts`: `handleUc3ElevenLabsQuota` (`GET /api/uc3/elevenlabs-quota`), `force` on generate.
- `worker/src/assets/commute-player.html`: UTC weekday label, voice-budget banner, "No briefing today" tile, Generate-anyway passes `force:true`.
- `worker/src/index.ts`: quota route, cron log line for skips, stall-detector dedupe against open reports.
- Gate G (D1 bulk resolve) applied 2026-09-04 via Cloudflare MCP: 15 stall reports → `resolved`, 11 blindspots → `rejected`. Snapshots: session scratchpad `snapshot-ui_feedback-stall-rows.json`, `snapshot-audit_blindspots-open.json`.

## W1-C3 — Step 3 triage repair ⏳ blocked on evidence

Symptom (live, hourly): Ingestion Log rows titled `undefined [triage:undefined]`, Source=email, Stage=triage, Status=Review, Error Message `Triage classification: . Rationale:` — the classifier output is empty when the Notion write runs.

Evidence pull (read-only), run with `N8N_API_KEY` exported:

```bash
bash <scratchpad>/n8n-dump.sh
```

Dumps workflow JSON for `BNBjoqXtPylHcMjs`, `CkFleWzrsKzXL5kh`, `9QKgeDSw4UXLZNcH`, `iqiNBClTdbfWCcB1`, `8sHd4N0YPG25ug1k`, `6g1FBLIexdpzXkcJ` and the last executions of Step 3. Then: locate the state loss after the §8.4a.11 W2 edit, fix, smoke with one PDF + one newsletter. Fallback per plan, PRE-BUILT 2026-09-04 while blocked: `POST /api/triage-classify` (`worker/src/lib/triage-classify.ts`, Sonnet 5, bearer auth). Input `{subject, from, to, date, message_id, body_excerpt, attachments:[{name,mime,size}]}`; output always well-formed: `classification` in ingest|review|skip|spam, `rationale`, `confidence`, `suggested_title`, `domain_primary`, `is_newsletter_digest`, plus ready-to-write `notion_title` ("<title> [triage:<class>]"), `error_message`, `stage`. Unparseable model output degrades to `review` with `degraded: true`, so it can never write `undefined`. To adopt: point Step 3's classifier step at this route (HTTP Request node with the bearer token) and map `notion_title` / `error_message` / `stage` into the existing Notion write node. Gate G before reclassifying the 234 Review rows.

## W1-C4 — archival workflow + summary mode ✅ code in PR #29; Notion mutation applied; n8n deactivation pending

- `/api/log-append` `mode:"summary"` (marker scan / `block_id`) in PR #29.
- Seven `PROJECT_LOG_ARCHIVE_*_AUTO` marker pages (05-11, 05-18, 06-01, 06-08, 07-06, 08-03, 08-10) moved from under PROJECT_LOG to 🗑️ Cleanup Archive (`34e48344-93df-8171-b63d-e4d4bbfba1d3`). Each held one paragraph; nothing was ever archived. Trash from the Notion UI if wanted.
- Deactivate `8sHd4N0YPG25ug1k` (needs the n8n key):

```bash
curl -sS -X POST -H "X-N8N-API-KEY: $N8N_API_KEY" https://campbellkane.app.n8n.cloud/api/v1/workflows/8sHd4N0YPG25ug1k/deactivate -o /dev/null -w "HTTP %{http_code}\n"
```

## W1-C5 — read-path fixes ✅ code in PR #29

- `/api/project-log-recent`: full walk under a 24s budget, true tail, `tail_reliable`, heading_3 `[…]` entries recognised.
- `/api/query`: `normalizeQueryChunk` lifts `title` / `skr_page_id` / `source_doc_id` / `content` from varying keys or `metadata`.
- Unknown paths → 404 JSON; root banner only on `/`.
- Removed: `reading|corpus|insights|posture|pipeline|buildlog-v3-legacy.html`, `commute-player-v23.html`.

## W1-C6 — deploy ⛔ held until Campbell says go

```bash
npm run deploy
```

Then record the new version in PROJECT_LOG and run the ADR-024 self-audit on `/uc3` and `/desk`. Post-deploy checks are listed in PR #29's test plan.
