# SYSTEM_SURVEY_2026-09 — Claude Code

- **Dispatch:** SURVEY-2026-09-CODE (authored by Cowork on Campbell's direction, 2026-09-04)
- **Author:** Claude Code (Claude Fable 5.1, `claude-fable-5-1`), running against `spacesc-mcp` on Campbell's Mac
- **Survey window:** 2026-09-04, ~14:30–16:00 UTC
- **Read basis:** PROJECT_LOG through the `[2026-09-04 SURVEY-2026-09 kickoff]` entry (summary block, all entries 2026-05-17 → 2026-05-20, the last five nightly entries, plus keyword sweeps of the full 813 KB dump); OPERATIONS_PLAYBOOK TOC, Index, §1, §5, §8.4a.3, §8.4a.6, §8.4a.21, §8.4a.22, §8.11, §9.9, Appendix A; §8.10 Use Case Architecture in full; ADR-024 (from the `happy-mestorf` worktree, see C-1); CLAUDE.md on both the local checkout and `origin/main`.
- **Independence:** the Cowork survey page was not read.

---

## A. Executive summary

1. **System health in one sentence:** the always-on core (Worker, D1, R2, Queues, Notion, Gmail→parking-lot extraction) is alive and serving, but every unattended loop that was supposed to keep the system *moving* has silently stopped or degraded, and no human or agent has had write access to the Cloudflare account or n8n from this Mac since 2026-05-22.
2. **Access is the gating problem, not code.** Wrangler's OAuth token expired 2026-05-22 (`~/Library/Preferences/.wrangler/config/default.toml`); the n8n API key configured for the n8n MCP is rejected (health OK, `list_workflows` → `AUTHENTICATION_ERROR`); the repo has no `CLOUDFLARE_API_TOKEN` secret so the auto-fix "redeploy after merge" step is a permanent no-op; the GitHub `Feedback fix` scheduled workflow was auto-disabled for inactivity on 2026-07-21 (60 days after the last commit). Nothing can be deployed, migrated, or repaired on the cloud side until Campbell re-authenticates (CODE-R1).
3. **Step 3 email triage has been writing garbage since 2026-05-04.** 234 Ingestion Log rows are titled `undefined [triage:undefined]` with an empty classification; every email since then lands in `Review`. Newsletter → parking-lot extraction (the §8.4a.11 branch of the same workflow) still works (42 rows this month). Onset coincides with §8.4a.11 W2 landing in the Step 3 workflow. Whether any ingest-worthy non-newsletter email has been lost cannot be determined without n8n execution access (CODE-R3).
4. **The §8.4a.6 archival workflow is broken in a way that both fails to trim and corrupts the summary.** Eight runs since 2026-05-02 each created a one-paragraph marker page claiming "N blocks moved", deleted exactly one block from PROJECT_LOG, and overwrote the LATEST STATE SUMMARY with literal `undefined`. PROJECT_LOG is 813 KB / 818 headings and still contains everything from 2026-04-30. The Monday cron also skipped 9 of 17 weeks (CODE-R4).
5. **Morning triage of the Reading Parking Lot is a manual Campbell step, never automated.** 632 rows sit in `New` (139 added this month alone); last `Listened` 2026-05-26, last `Retrieved` 2026-05-27. The nightly Cowork retrieval is healthy but starved. This is a workflow-design gap, not a fault (CODE-R5).
6. **The UC3 learning-module pipeline is quiet and its inbox is stale.** D1 holds 17 known series / 125 modules: 16 series cancelled with all 120 modules archived (the May dry-runs), one series (`17993a8f`, satellite comms) with 5 approved modules and full audio. The 15 open `/pipeline` feedback rows are "pipeline-stall" alerts for series that are now cancelled; they should be resolved in bulk. 11 open blindspots. The daily briefing cron has generated a ~3.7 MB briefing every day since ~2026-05-21 with "2 ingests, 0 insights" to narrate: unattended ElevenLabs spend with no listener (CODE-R6, E-2).
7. **The repo on disk is not the repo.** The local checkout sits on `restructure/worker-subdirectory` (1 ahead, 16 behind `origin/main`) with 1,182 lines of uncommitted May-19 edits that `main` has since superseded. ADR-006 (Evidence-Based DoD) and the `Stop` hook that enforces it exist **only** as untracked local files; `main`'s CLAUDE.md does not mention ADR-006. Three stale detached worktrees and two `*.local-backup` files sit in the tree. `origin/main` itself typechecks clean, lint has 3 dead-code errors (fixed in this survey), deps are 1–2 majors behind.
8. **The Mac-bound tier is smaller than the docs say and unreachable from the cloud.** il-server runs (launchd, port 7777, healthy) with 18 insights (9 approved / 9 pending, last 2026-05-20) and 2 research notes (last 2026-05-11) in one `insights.db`. There is no `rn-server` or `research_notes.db` anywhere on the Mac. Tailscale is stopped and the Funnel hostname no longer resolves, so the Worker's `search_insights` / `approve_insight` / `rn-capture` paths are dead. The migration §8.4a.22 gates on is ~20 rows.
9. **Docs describe a system two builds behind reality.** PROJECT_LOG has no entry for §8.4a.25 (feedback button, adversarial UAT, tiered auto-fix, PRs #9–#25, 2026-05-20 → 05-22) or for ADR-006; §8.10 still says UC3 is "Not yet built"; the playbook's Appendix A predates the Worker entirely; `/system-map`'s next-action banner still says "Execute §8.4a.21 W9 dogfood".
10. **Three findings that most change the plan:** (i) re-authentication and secret hygiene must precede every other item; (ii) the two n8n workflows that matter (Step 3 triage, §8.4a.6 archival) need repair or replacement, and Claude Code Routines are now a credible always-on replacement for both plus morning triage; (iii) §8.4a.22's "30-day soak" trigger was met in June, the pattern is proven, and the data to migrate is tiny, so the migration is cheap and unblocks retiring Tailscale Funnel.

---

## B. Inventory and health table

Verdicts: **Healthy / Degraded / Broken / Unknown / Retired**. Evidence commands and raw counts are in §I.

### 4.1 Worker codebase and deploy state

| Component | Expected (doc ref) | Observed (evidence) | Verdict |
|---|---|---|---|
| Live Worker version | `7b2f0d7d-…` (PROJECT_LOG 2026-05-20) | Cannot run `wrangler deployments list`: wrangler 4.79 reports "Not logged in" (OAuth `expiration_time` 2026-05-22T02:04Z). Live bundle serves `/feedback` (51 KB) and `feedback-button.js`, i.e. post-§8.4a.25 code; PR #25 merged 2026-05-22 13:18 with CI green and the deploy step skipped, so live ≠ `main` HEAD is likely but unverifiable. | **Unknown** (version) / **Degraded** (deploy access) |
| Repo HEAD vs `origin/main` | CLAUDE.md Rule 1: deploy from `main` | Local checkout on `restructure/worker-subdirectory` @ `913c005`, 1 ahead / 16 behind `origin/main` @ `94c5997`. 7 modified files (+1,182/−43) and 22 untracked files; all Worker-side untracked files already exist on `main`; ADR-006 + `.claude/settings.json` + `.claude/hooks/stop-reminder.sh` do not. Two stashes. Three detached worktrees under `.claude/worktrees/` (two at `e6c6ace`, one at `b2bcb3d` = 2 commits already merged via #24). | **Degraded** |
| Open PRs | — | #26 auto-fix feedback #27 (T2, daily-brief voice rotation, opened 2026-05-22, still open); #22 F15 auto-deploy (content already on `main` except a `posture.html` retry button; mergeable-clean); #8 ADR-006 propagation doc; #7 `restructure/worker-subdirectory` (superseded by #9). Issue #6 "@claude smoke test" open. | **Degraded** (stale queue) |
| Typecheck / lint / tests | CI = `npm run type-check` only (`ci.yml`) | `tsc --noEmit` clean on `origin/main`. `oxlint worker/src`: 3 errors, all `no-unused-vars` in `feedback-button.js` (fixed, see D-3). No test suite exists; `worker/smoke.mjs` is a manual §8.4a.10 probe script. | **Healthy** (typecheck) / **Degraded** (no tests) |
| Wrangler config | §8.4a.21 W-series entries | `worker/wrangler.jsonc`: D1 `uc3_fundamentals` (`67501587-…`), R2 `spacesc-tts-cache`, DO `SpaceSCMCP`, Workflow `uc3-fundamentals-pipeline`, Queues `uc3-s5-section-drafting` (+DLQ) and `uc3-module-tts` (+DLQ), crons `0 11 * * *` and `*/2 * * * *`, observability on. 13 D1 migrations (0001–0013). Secrets by name (from `Env`): `WEBHOOK_SECRET, IL_SERVER_TOKEN, IL_SERVER_FUNNEL_URL, MCP_CLIENT_TOKEN, NOTION_TOKEN, OPENAI_API_KEY, ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, BRAVE_SEARCH_API_KEY` plus GitHub dispatch credentials. Presence on the live Worker unverifiable without wrangler. | **Healthy** (config) / **Unknown** (secrets present) |
| REST route inventory | CLAUDE.md "UC3 player contracts" | 62 route literals in `index.ts` (§I.3). Authenticated smoke: `list-briefs-ready` 200 (0 briefs pending review, correct: all modules approved/archived), `captures-today` 200, `feedback-list` 200 (27 items), `feedback-fixes-pending` 200 (0), `list-gaps` 200, `pipeline-status` 200 ×17, `spaced-rep-due` 200, `module-errata-list` 200 (1 open erratum on module 82), `blindspots-list` 200 (12), `project-log-recent` 200 (Notion token alive), `parking-lot-list` 200, `ingest-log` 200, `today-briefing` 200. `/api/uc3/elevenlabs-quota` → 405 (task #20 never built). `module-audio` rejects HEAD (405) — minor. | **Healthy** |
| MCP tools | §2.16.6 + W8 (`search_modules` 1.2.0) | `/mcp` initialize OK, server `spacesc` 1.2.0, 8 tools: `query_corpus, capture_insight, search_insights, approve_insight, search_modules, search_feedback, list_open_blindspots, resolve_blindspot`. `search_insights`/`approve_insight`/`capture_insight` depend on il-server via Funnel → dead (see 4.4). | **Degraded** |
| Hosted surfaces | §8.4a.24 nav pill set | `/`, `/uc3` (143 KB), `/desk`, `/corpus`, `/insights`, `/posture`, `/pipeline`, `/log`, `/system-map`, `/feedback`, `/health` all HTTP 200 in <0.6 s. Six `*-v3-legacy.html` assets still bundled and referenced; `commute-player-v23.html` bundled and unreferenced (dead asset). | **Healthy** (load) |
| `/system-map` vs reality | ADR-024: "canonical live source of truth" | Static data embedded in HTML; latest date literal 2026-05-20; UC pct 85/85/90/50/80; next-action banners: "Execute §8.4a.21 W9 dogfood", "Trigger §8.4a.3 hooks-enforced logging", "Trigger §8.4a.1+.2". Reality: W9 dogfood ran (module 82 / gap 7b295be2 per 05-20 entry), §8.4a.25 landed, all 16 dry-run series cancelled, hooks exist locally. | **Degraded** (stale) |
| Cron `0 11 * * *` daily briefing | migration 0009 | `today-briefing` → 2026-09-04 ready, 3,752,943 bytes, voice `ErXwobaYiN…` (Antoni), `source_summary {ingest_count: 2, insight_count: 0}`. Generates daily with nothing to say. | **Degraded** (cost, see E-2) |
| Cron `*/2 * * * *` feedback drain | §8.4a.25c | Calls `api.github.com/…/feedback-fix.yml/dispatches` every 2 min; the target workflow is `disabled_inactivity` since 2026-07-21, so every tick since then fails (unobservable without Cloudflare logs). Queue is empty anyway (`feedback-fixes-pending` = 0). | **Broken** (silently) |
| GitHub Actions | `feedback-fix.yml` schedule `*/3`; `ci.yml`; `claude.yml` | `gh workflow list`: CI active, Claude Code active, **Feedback fix `disabled_inactivity`**. Last run 2026-07-21T14:58Z (exactly 60 days after last commit 2026-05-22). Repo secrets: `ANTHROPIC_API_KEY` (2026-05-17), `MCP_CLIENT_TOKEN` (2026-05-20). **No `CLOUDFLARE_API_TOKEN`** → the F15 auto-deploy step has always been skipped. | **Broken** |
| Open tasks #6, #7, #20 | PROJECT_LOG 2026-05-20 | #20 (ElevenLabs quota endpoint + banner): still relevant, not built (405). #6/#7: not recoverable from any reachable source (they lived in a Code session's task list); see H-4. | **Unknown** |

### 4.2 Data stores

| Component | Expected | Observed | Verdict |
|---|---|---|---|
| Pinecone `space-sc-memory`/`SpaceSC` | ~4,543 vectors at Step 2 close; reconciliation 2026-05-02 cleaned 303 orphans + 923 dedup vectors (App. A) | **Not reachable.** `PINECONE_API_KEY` lives only in n8n Variables and Worker secrets; neither is readable from this Mac today. `reconcile.py` needs `NOTION_TOKEN` + `PINECONE_API_KEY` env vars and defaults to DRY-RUN; a read-only run is one command once keys are exported (§I.9). Expected order of magnitude from SKR: 251 pages. | **Unknown** |
| Notion SKR (`2a348344-…80c4`) | 244–245 pages (App. A) | 251 pages; 241 `Complete`, 10 `Pending`, 0 `Failed`; last page created 2026-05-18 12:45Z; `Chunk Count` reads NULL for all 251 rows via SQL (either never written back or a trailing-space column artefact, see H-3). Schema matches Worker/n8n expectations. **No new SKR page in 109 days.** | **Healthy** (store) / **Degraded** (idle) |
| Notion Ingestion Log (`d7494f8b-…`) | one row per attempt | 980 rows; last 2026-09-04 14:15Z. Since 2026-06-01: 191 `email/Review` rows all titled `undefined [triage:undefined]`, 188 `spacenews-parking/Complete`, 5 `claude`. First `undefined` row 2026-05-04 01:00Z; last well-formed email row 2026-05-04 23:00Z; 234 malformed rows total. Archival rows: 8 × "PROJECT_LOG archival undefined — 1 blocks moved" (Stage mis-set to `pinecone_upsert`). Schema has 13 sources / 13 stages, matching Worker `handleIngestLog`. | **Degraded** |
| Notion Reading Parking Lot (`f3a2418b-…`) | Cowork + Worker + §8.4a.17/21 schema additions | 714 rows: `New` 632, `Listened` 48, `Retrieved` 21, `Done` 6, `Skip` 5, `Ingest` 2, **`Retrieve Tomorrow` 0**. Per month created: May 141 (59 still New), Jun 119, Jul 157, Aug 158, Sep 139 — 100 % still `New` from June on. Last `Listened At` 2026-05-26, last `Retrieved At` 2026-05-27. Schema includes `Listened At`, `Reframe`, `Source Research Note ID`, `Source Parent Article ID`, `Learning Gaps Referencing` — matches Worker. | **Healthy** (store) / **Broken** (flow) |
| Notion Open Questions (`35d48344-…8104`) | §8.4a.17 W5 | 3 rows (2 Open, 1 Answered); last created 2026-05-11. Schema matches `oq.py` / `/api/oq-create`. | **Healthy** (idle) |
| Notion Learning Gaps Queue (`35ebac9a-…`) | §8.4a.21 W1 | 25 rows: Captured 6, Drafted 7, Revision-Requested 12; last 2026-05-21 19:54. Statuses are stale relative to D1 (the 16 cancelled series are not reflected). | **Degraded** (drift vs D1) |
| D1 `uc3_fundamentals` | migrations 0001–0013 | Via Worker API only. 17 known series → 125 modules: 120 `archived`, 5 `approved`; pipelines 16 `cancelled` (7 @S8, 6 @S7, 3 @S4), 1 `paused` @S8 (`17993a8f`); `audio_last_error` = none on all 125; 11 modules have `audio_r2_key`; 1 open erratum; spaced-rep rows due for modules 91–95. `ui_feedback`: 27 rows (15 open, 2 in progress, 10 resolved); `blindspots`: 12 (11 open); `feedback_fixes` pending: 0; `daily_briefings`: ≥1 row/day since 0009 landed. Direct schema/row-count query impossible without wrangler. | **Healthy** (store) / **Degraded** (stale state) |
| R2 `spacesc-tts-cache` | audio for briefs, modules, daily briefings, TTS cache | Not listable. Lower bound from D1: 11 module MP3s (~12–18 MB each ≈ 150 MB), 5 brief MP3s (~5 MB each), ~106 daily briefings × ~3.7 MB ≈ 390 MB, plus `/api/tts-cache/*` objects. Estimate ≥ 0.5 GB. | **Unknown** |

### 4.3 n8n workflows

| Component | Expected | Observed | Verdict |
|---|---|---|---|
| n8n MCP / API access | §5: Code has full REST PUT | `n8n_health_check` OK (`campbellkane.app.n8n.cloud`, n8n-mcp 2.82.1); `n8n_list_workflows` → `AUTHENTICATION_ERROR`. A direct probe of the key was blocked by the auto-mode classifier. Key is either expired or revoked. | **Broken** |
| Workflow inventory / last exec / error rate | App. A lists 5 workflows | Cannot enumerate. Indirect: `POST /webhook/query` and `/webhook/phase0-test` both answer HTTP 401 `Unauthorized` with `receivedAuthHeader: true` (the MCP bearer ≠ `WEBHOOK_SECRET`, as designed) → instance up, workflows `6g1FBLIe…` and `6az4AOs3…` active. | **Unknown** |
| Step 3 email ingest `BNBjoqXt…` (hourly) | §8.1 + §8.4a.7 smart handler + §8.4a.11 parking-lot branch | Fires hourly (rows at :00 every hour, last 2026-09-04 14:00Z). Parking-lot branch healthy (`inserts:ok`, e.g. "articles=6; inserted=6"). Triage branch broken since 2026-05-04 01:00Z: `Title = undefined [triage:undefined]`, `Error Message = "Triage classification: . Rationale:"`, Status `Review`. Consistent with the §2.5 / §2.14 state-loss patterns after the W2 edit. Whether non-newsletter mail is being classified at all is unknowable without execution data. | **Broken** (triage) / **Healthy** (parking) |
| §8.4a.6 archival `8sHd4N0Y…` (Mon 04:00 ET) | archive when >300 KB or >80 entries; log a row per fire | Fired 2026-05-02 (×3 smoke), 05-04 (no-op), 05-11, 05-18, 06-01, 06-08, 07-06, 08-03, 08-10 — no fire on 9 Mondays (06-15…06-29, 07-13…07-27, 08-17, 08-24, 08-31). Each real run: history `threshold:over|create_archive:ok|delete_blocks:1/1|update_summary:ok`, creates `PROJECT_LOG_ARCHIVE_<date>_AUTO` containing **one paragraph** ("4897 blocks moved"), deletes exactly one block, and rewrites the LATEST STATE SUMMARY with `undefined` fields. 7 marker pages exist under PROJECT_LOG. Net: no trimming, summary corrupted, possibly 8 orphaned block deletions (H-2). | **Broken** |
| Morning triage (New → Retrieve Tomorrow) | §8.4a.11: "Campbell sets during morning triage" (Parking Lot `Priority` description); Cowork prompt: "rows Campbell marked" | Lives nowhere but the `🌅 Morning Triage` Notion view and Campbell's hands. No n8n, Worker, or Cowork automation exists. Stopped 2026-05-26 when Campbell paused. | **Retired** (never automated) |
| SpaceNews curated-action webhook + polling (§8.4a.11) | `Fire Ingest Now` / `Fire Insight Now` buttons; polling worker | Status `Ingest` rows last created 2026-05-19 (2), `Insight` 0. Whether the poller still runs is unverifiable (n8n). No `spacenews-curated` Ingestion Log rows since May (9 in May). | **Unknown** |
| Cowork nightly retrieval (§8.4a.11 W3) | nightly | Runs nightly (entries through 2026-09-04), self-reports schema verified; 0 retrieved every night since 2026-05-27 because the queue is empty. | **Healthy** (starved) |

### 4.4 Mac-bound components

| Component | Expected | Observed | Verdict |
|---|---|---|---|
| il-server | FastAPI via launchd, exposed by Tailscale Funnel (§8.4a.10) | `com.spacesc.il-server` loaded, pid 1460, `GET 127.0.0.1:7777/health` → `{"ok":true,"insight_count":18,"last_insight_at":"2026-05-20T12:30:30Z","version":"1.2.0"}`. Routes: `/approve /capture /health /rn/approve /rn/capture /rn/search /search`. `insights.db` 12.9 MB, mtime 2026-05-20. 18 insights (9 approved, 9 pending). The launchd plist embeds `IL_SERVER_TOKEN` and an OpenAI key in plaintext (mode 0600). | **Healthy** (local) |
| rn-server / `research_notes.db` | §8.11 lists as separate component | Does not exist. Research notes are tables in `insights.db` served by il-server `/rn/*` (as §8.10 actually states). 2 research notes, last 2026-05-11. | **Retired** (never existed as described) |
| Tailscale Funnel | Worker `IL_SERVER_FUNNEL_URL` → `campbells-macbook-air.tailf2ed6d.ts.net` | Tailscale app running but "Tailscale is stopped"; "No serve config"; hostname does not resolve (`curl: (6)`). Worker paths `capture_insight`, `search_insights`, `approve_insight`, `/api/rn-capture`, `/api/search`, `/api/approve` are dead from the cloud. | **Broken** |
| `spacesc-bulk-loader` skill | §8.4a.4 | Present, `.venv` present, files dated 2026-04-20/05-02; no run artefacts after 2026-05-02. Runnable once `WEBHOOK_SECRET` is exported. | **Healthy** (idle) |
| `spacesc-reconciliation` skill | §8.4a.4, DRY-RUN default | Present; last outputs `reconciliation_report_2026-05-02.json`. Needs `NOTION_TOKEN` + `PINECONE_API_KEY` env. | **Healthy** (idle, keys missing) |
| `spacesc-spacenews-retrieval` skill | Cowork nightly helper | Present (`retrieve_helper.py`, `COWORK_TASK_PROMPT.md`, `BUTTON_SETUP.md`). | **Healthy** |
| Other skills (`insight-ledger`, `learning-modules`, `open-questions`, `research-note-ledger`) | §8.4a.9/17/21 | Present. `insight-ledger` is the il-server host. | **Healthy** |
| `~/Downloads/*.standalone.html`, `patch_*.py` | ADR-024 F2 mentions them | None remain (only an unrelated `malteser-panel-guide.html`). All UC surfaces are Worker-hosted. | **Retired** |
| `.claude/worktrees/*` (3) | — | Detached, all content already on `main`. | **Retired** (delete is gated) |

### 4.5 Repo hygiene and engineering debt

| Item | Observed | Verdict |
|---|---|---|
| ADR inventory | On `main`: 0000 template, 0021, 0024. Local only: 0006 (ACCEPTED 2026-05-19). Referenced but absent: ADR-005 (plan-mode, "once authored"), ADR-025 (§8.4a.25 has no ADR), ADR-022/023. ADR-024 honored on `main` CLAUDE.md; ADR-006 honored only on this Mac via the Stop hook. | **Degraded** |
| Hooks (§8.4a.3) | `.claude/settings.json` wires a reminder-only `Stop` hook (`stop-reminder.sh`, exit 0). Fires locally; **not on `main`**, so cloud/other-machine sessions never see it. The §8.4a.3 design (block until a PROJECT_LOG append happened) was never implemented. `/system-map` still lists §8.4a.3 as the UC5 next action. | **Degraded** |
| Dead code / duplication | `index.ts` is 3,258 lines and hosts routing + MCP + log-append + Notion proxies + cron; 6 `*-v3-legacy.html` assets still shipped; `commute-player-v23.html` shipped and unreferenced; 3 unused symbols in `feedback-button.js` (lint-clean after D-3); zero `TODO/FIXME` markers. Duplicate endpoint logic: `/api/uc3/module-tts` sync path vs queue path; `/api/search` + `search_insights` both proxy il-server. | **Degraded** |
| Secret posture (§6) | Repo secrets: `ANTHROPIC_API_KEY` set 2026-05-17, `MCP_CLIENT_TOKEN` 2026-05-20 (110 / 107 days). Wrangler OAuth expired. n8n API key rejected. The MCP bearer appears in plaintext inside `.claude/settings.local.json` (gitignored, 5 allowlist entries). il-server plist embeds OpenAI key + token. PROJECT_LOG 2026-05-16 noted "ANTHROPIC_API_KEY rotation … currently open". ElevenLabs credits unknown (0/406 k on 2026-05-19; topped up 05-20; ~106 daily briefings since). Nothing rotated in this survey. | **Degraded** |
| Dependency freshness | `agents` 0.9.0 → 0.22.0, `wrangler` 4.79 → 4.129, `typescript` 6.0.2 → 7.0.2, `zod` 4.3.6 → 4.5.4, `oxlint` 1.58 → 1.81, `oxfmt` 0.43 → 0.66. `compatibility_date` 2025-03-10. | **Degraded** |
| Backups / junk | `.gitignore.local-backup`, `README.md.local-backup` (2026-05-17) untracked in the checkout. | **Retired** |

### 4.6 Capability delta

See §F.

---

## C. Doc-versus-reality gaps

| # | Document | Says | Reality | Fix in |
|---|---|---|---|---|
| C-1 | Dispatch §2 / CLAUDE.md (`main`) | ADR-024 at `docs/adr/0024-ui-build-discipline.md` | Present on `main`; absent from the local checkout's branch (found via worktree). Local checkout is stale. | Local checkout → switch to `main` (CODE-R2) |
| C-2 | PROJECT_LOG LATEST STATE SUMMARY | "Updated 2026-04-30 … Phase 2 Step 3 … Most recent log entry: [undefined]" | 4 months and 7 dispatches stale; overwritten with `undefined` by the archival workflow 8 times. | PROJECT_LOG (this survey appends a dated summary; top block needs a targeted block rewrite, CODE-R4) |
| C-3 | PROJECT_LOG | No entry for §8.4a.25 (feedback button, adversarial UAT, tiered auto-fix loop, `/feedback` surface, F15/F16, three CLAUDE.md rules), PRs #9–#25 | Landed 2026-05-20 → 05-22 per git history and ADR-024 F15. | PROJECT_LOG (retro entry) + new ADR-025 |
| C-4 | PROJECT_LOG | No entry for ADR-006 / Evidence-Based DoD landing | ADR-006 authored 2026-05-19, playbook §10 child page exists, hook wired locally only. | PROJECT_LOG + commit ADR-006 (done, D-2) |
| C-5 | OPERATIONS_PLAYBOOK Appendix A | Live inventory = 5 n8n workflows, 4 credentials, 12 n8n Variables, 2 skills, 4 Notion DBs | Missing: the Worker and its 62 routes / 8 MCP tools, D1, R2, 2 Queues + DLQs, Workflow, 2 crons, Reading Parking Lot / Open Questions / Learning Gaps DBs, 5 more skills, il-server launchd + Funnel, GitHub Actions + repo secrets. Pinecone count is from April. | OPERATIONS_PLAYBOOK App. A (rewrite) |
| C-6 | OPERATIONS_PLAYBOOK §8.11, §8.4a.22 | Mac-bound: il-server SQLite, **rn-server SQLite `research_notes.db`**, bulk_loader, reconciliation | No rn-server exists; RNs live in `insights.db` under il-server. | OPERATIONS_PLAYBOOK §8.11 + §8.4a.22 |
| C-7 | OPERATIONS_PLAYBOOK §8.4a.21 | "SPEC LOCKED · BUILD PENDING TRIGGER" | W0–W9 LANDED 2026-05-17 → 05-20. | OPERATIONS_PLAYBOOK §8.4a.21 status line |
| C-8 | OPERATIONS_PLAYBOOK §8.4a.6 | "Active … until then runs as no-op" | Runs over-threshold every fire, creates marker pages, trims nothing, corrupts summary. | §8.4a.6 status + §3 runbook entry |
| C-9 | OPERATIONS_PLAYBOOK §5, §9.9 | Capability baseline April 2026; "Cowork scheduled tasks require Desktop app to remain active"; Code = "n8n REST PUT + local scripts" | Superseded: Routines run cloud-side without the Mac; Cowork nightly task has run 100+ nights; Code owns the Worker. | §9.9 + §5 (see §F) |
| C-10 | §8.10 Use Case Architecture | UC3 "Not yet built"; §8.4a.10 "SPEC LOCKED, BUILD DEFERRED"; §8.4a.3 queued as UC5 gap; last edited 2026-05-11 | UC3 has Commute Player v2.2 + learning modules + daily briefing; §8.4a.10 LANDED 2026-05-05; Article Research Session landed as §8.4a.17 W7. | §8.10 page |
| C-11 | `/system-map` | Next actions: W9 dogfood, §8.4a.3, §8.4a.1+2; pct 85/85/90/50/80; no §8.4a.25 phase | W9 done, §8.4a.25 landed, 16 series cancelled, feedback loop exists. | `worker/src/assets/system-map.html` |
| C-12 | CLAUDE.md (`main`) project map | `worker/` "Forthcoming", `.claude/skills/` "Forthcoming", `standalones/` "Forthcoming" | `worker/` has been on `main` since #9; skills live in `~/.claude/skills/` (repo has only `SKILLS.md`); `standalones/` never created and superseded by Worker routes. | CLAUDE.md (fixed, D-4) |
| C-13 | CLAUDE.md (`main`) | "ADR-024 failure register is currently at F1–F15" | ADR-024 on `main` documents F1–F15 and §3.5; F16 (streaming) is referenced in PR #24 title but not in the register. | ADR-024 Part 3 (append F16) |
| C-14 | CLAUDE.md (`main`) Rule 1 | "run `npm run deploy` from the worktree root" | Impossible on this Mac (OAuth expired) and in CI (no token). | CLAUDE.md after CODE-R1 |
| C-15 | README.md (`main`) | "Forthcoming as content lands" project structure | Same as C-12. | README.md (fixed, D-4) |
| C-16 | Cowork nightly entries / dispatch §1 | "626 rows in New" | 632 at survey time (6 more added 14:15Z today). | none (informational) |
| C-17 | Dispatch §1 | "last substantive build entry 2026-05-20" | True for PROJECT_LOG; the last substantive *build* was 2026-05-22 (PR #25) and is unlogged. | PROJECT_LOG (C-3) |
| C-18 | Memory `claude_code_wrangler_deploy_blocked.md` | "`npm run deploy` works" | No longer: not logged in. | Memory (updated, D-6) |

---

## D. Fixes applied during the survey

Every item below is reversible and ungated under §3 of the dispatch (doc-only, lint-only, or additive). Nothing was written to Pinecone, D1, R2, any Notion database, n8n, GitHub Actions state, or secrets.

| # | What | Why | Before | After | Reversible | Gated |
|---|---|---|---|---|---|---|
| D-1 | Report committed at `docs/surveys/2026-09-survey-claude-code.md` on branch `survey/2026-09-code` (from `origin/main`) and pushed. Opening the PR was blocked by the auto-mode classifier (publishing action); Campbell opens it with `gh pr create --base main --head survey/2026-09-code` | Dispatch §5 | no `docs/surveys/` | file on pushed branch | yes (delete branch) | no |
| D-2 | `docs/adr/0006-definition-of-done.md` added to the same branch | Doc-only; ADR existed only as an untracked local file (C-4) | absent on `main` | present on branch | yes | no |
| D-3 | `worker/src/assets/feedback-button.js`: removed the dead constant `TOKEN_TTL_DAYS`; kept the unwired `startVoice`/`stopVoice` scaffold (it carries a §8.4a.25.1 TODO) behind `oxlint-disable-next-line` directives | `oxlint` errors; symbols never referenced (grep-verified), so no behavior change | 3 lint errors | 0 lint errors, typecheck clean | yes | no |
| D-4 | CLAUDE.md + README.md project-map lines corrected ("Forthcoming" → actual state; `standalones/` marked superseded) | Doc-only (C-12, C-15) | stale | current | yes | no |
| D-5 | Notion page `SYSTEM_SURVEY_2026-09 — Claude Code` created as child of the Ingestion Log page | Dispatch §5 | — | page exists | yes (archive) | no |
| D-6 | PROJECT_LOG entry appended via `/api/log-append` with heading `[2026-09-04 SURVEY-2026-09-CODE] Claude Code — system survey complete`, including a dated replacement LATEST STATE SUMMARY block in the body | Dispatch §5; top-of-page rewrite is prohibited by CLAUDE.md, so the refreshed summary is appended and pointed to | stale summary | dated summary exists at the tail | yes | no |
| D-7 | Memory note updated: wrangler on this Mac is not logged in (OAuth expired 2026-05-22); n8n MCP key rejected | Prevent the next session from assuming deploy works | "`npm run deploy` works" | corrected | yes | no |

**Deliberately not done (gated):** wrangler re-login, n8n workflow edits/activation, re-enabling the `Feedback fix` GitHub workflow, resolving the 15 stale `/pipeline` feedback rows and 11 blindspots in D1, deleting stale worktrees/backup files/legacy assets, closing PRs #7/#22, rotating any secret, rewriting the PROJECT_LOG top summary block in place, starting Tailscale.

---

## E. Risks

| # | Risk | Mechanism | Severity |
|---|---|---|---|
| E-1 | **Loss of cloud write access** | Wrangler OAuth expired; no CI deploy token; n8n key rejected. If the Cloudflare account, n8n Cloud subscription, or ElevenLabs plan lapses, nobody notices until a surface 500s. No health probe exists for auth validity. | High |
| E-2 | **Unattended ElevenLabs spend and quota exhaustion (F14 pattern)** | Daily briefing cron has synthesized ~4 min of audio every day since ~2026-05-21 for a briefing that summarises "2 ingests, 0 insights". No `elevenlabs-quota` endpoint (task #20), so the next 401-quota-exceeded will again surface only as silent regen failures. | High |
| E-3 | **Silent data loss in PROJECT_LOG** | Archival workflow deletes one block per run and stores no copy (archive pages hold one paragraph). Eight deletions so far; which blocks is unknown (H-2). Next run is next Monday if the cron fires. | Medium |
| E-4 | **Ingest-worthy email swallowed** | Since 2026-05-04 every email row is `Review` with empty classification. Forwarded PDFs/documents (UC1 passive mode) would sit unlabelled in Gmail. 234 rows affected. | Medium-High |
| E-5 | **Corpus staleness** | 0 SKR pages and 0 Pinecone upserts since 2026-05-18; 632 unread newsletter items. UC2 answers are frozen at May. | Medium |
| E-6 | **Cloud→Mac path silently dead** | Tailscale stopped; `capture_insight` from iPhone/Opus and `/api/rn-capture` fail. The `captures-today` endpoint already excludes insights/RNs, so the Commute Player shows nothing wrong. | Medium |
| E-7 | **Secret sprawl** | Bearer token in `settings.local.json` (5 copies), OpenAI key in launchd plist, `MCP_CLIENT_TOKEN` shared by CI, Worker cron, phone, and local curl; no rotation since May; §6 covers only the n8n-era secrets. | Medium |
| E-8 | **Notion is the single point of truth for four DBs and two 250–800 KB pages** with no export; `/api/log-append` is the only safe write path and it is append-only. A Notion integration revocation stops ingest, logging, and the `/log` surface at once. | Medium |
| E-9 | **Auto-fix loop cannot ship** | `feedback-fix.yml` disabled; even when re-enabled it cannot deploy (no token) and would resume generating PRs from a 3-month-old inbox. Re-enabling before triaging the inbox risks 15 junk PRs. | Medium |
| E-10 | **GitHub inactivity timer** | Any scheduled workflow is disabled again after 60 days without a commit. A cron-only repo needs a keepalive or a Routine. | Low |
| E-11 | **Local checkout drift** | A future session that runs `npm run deploy` from `/Users/campbellkane/code/spacesc-mcp` as CLAUDE.md Rule 1 instructs would ship the May-19 pre-§8.4a.25 tree (after re-login). | High until CODE-R2 |
| E-12 | **Notion Learning Gaps / D1 divergence** | 25 Notion gaps vs 17 D1 series; Notion statuses never reflect cancellation. Any agent reading Notion will restart cancelled work. | Low |

---

## F. Capability delta (§4.6)

Verified 2026-09-04 against `code.claude.com/docs`, `platform.claude.com`, and `developers.cloudflare.com/agent-setup/claude-code/` by a research subagent; statuses are as the docs state them today. Session model: **Claude Fable 5.1** (`claude-fable-5-1`). Neither `.claude/settings.json`, `.claude/settings.local.json`, nor `feedback-fix.yml` pins a model (the Action uses its default).

| Capability | Status | Where it applies here | Cost / risk |
|---|---|---|---|
| **Routines** (cloud-scheduled Code sessions, cron/event triggers, ≥1 h interval, Pro/Max/Team/Ent, repo cloned fresh, secrets via env) | GA (docs still say research preview in places) | Direct replacement for: morning triage (score `New` rows, promote top N to `Retrieve Tomorrow`), the §8.4a.6 archival job, a weekly SKR↔Pinecone reconciliation dry-run, and a daily auth/health probe. Also the natural home for the `Feedback fix` scheduler, immune to GitHub's 60-day inactivity kill. Needs a cloud-stored `MCP_CLIENT_TOKEN` + Notion token. | Counts against plan usage; minimum 1 h cadence (fine for all four); a Routine writing to Notion needs the same gate discipline as n8n. |
| **/loop** (session-scoped, ≥1 min, expires 7 d, only while session open) | GA | Watching a long D1 migration, a Workflow run, or an ElevenLabs regen batch during a build session. Not a substitute for unattended crons. | Trivial. |
| **Channels** (Telegram/Discord/iMessage push into a running session; needs Bun) | Research preview | Event-driven wake-up when the Worker posts a feedback 🚩 or a pipeline stall: replaces the `*/2` cron + GitHub dispatch chain. | Requires a machine to stay up (violates §8.11 unless paired with Remote Control on an always-on host); preview stability. |
| **Cloud sessions + Remote Control** | GA | Cloud sessions give Campbell a phone-driven Code session against the repo with no Mac awake; Remote Control lets him steer a Mac session from the phone. Cloud sessions are where `wrangler deploy` should run once a `CLOUDFLARE_API_TOKEN` is stored cloud-side. | Cloud sessions cannot reach il-server (another argument for §8.4a.22). |
| **Cloudflare MCP / agent setup** (Workers, D1, R2, Queues, Workflows via API; "Code mode") | GA | Lets Code query D1 row counts, list R2 objects, read cron/queue metrics and Worker logs directly, replacing today's "probe via Worker API" workaround. Vectorize is not listed in the agent-setup docs; under §8.11 it is a credible *future* substrate (same account, no extra key, Workers binding) but the SKR↔Pinecone reconciliation logic, metadata shape, and n8n query workflow would all need porting. Not recommending a migration now. | Requires an API token with D1/R2 scopes stored locally or cloud-side — this is the token the system lacks today. |
| **Auto permission mode** (classifier; blocks force-push, prod deploys, exfiltration by default) | GA | This survey ran under it: read-only work flowed; it blocked one credential probe. Suitable default for surveys and doc work; builds that deploy should use `acceptEdits` + explicit allow rules. | Classifier false positives on `curl` with bearer headers; add `autoMode.environment` prose for the Worker host. |
| **/goal** (evaluator-driven Stop hook) | GA | The ADR-006 Completion Receipt is a goal condition. `/goal "PROJECT_LOG entry appended and receipt produced"` would implement §8.4a.3 without a bash hook. | Evaluator model cost per turn; clears on auth errors. |
| **ultraplan** | Not found in docs | Unverified; do not cite in the playbook until documented. | — |
| **/ultrareview, /code-review ultra** | Research preview; $5–25/run after 3 free | Pre-merge review of §8.4a.25 auto-fix PRs (T2) and of any n8n-replacement Workflow code. | Not under ZDR; cost per run. |
| **/doctor** | Built-in CLI command, no doc page | Diagnoses MCP/auth state; would have surfaced the expired wrangler and n8n credentials on session start. | None. |
| **Subagents** (background, fork), **agent teams** (experimental), **dynamic Workflow tool** | GA / experimental / GA | Parallel reads (this survey used one background researcher); a Workflow script for "reconcile 250 SKR pages against Pinecone in parallel shards"; fork mode for a shared-context build session. | Agent teams need org enablement; Workflow token cost scales with agents. |
| **Published artifacts** (live MCP data via viewer's connectors; comments Team/Ent only; no backend DB) | GA (Pro/Max/Team/Ent) | Replacement for hand-patched standalone HTML: `/posture`, `/pipeline`, `/system-map` as artifacts reading D1/Notion live. Not for `/uc3` (needs audio + localStorage + mediaSession). | Comments unavailable on a personal plan; connector auth is per viewer (fine for one user). |
| **Model: Fable 5.1 GA in Code** (needs v2.1.255+); Opus 5 `claude-opus-5`, Sonnet 5 `claude-sonnet-5`; Fast mode GA | GA | This session. The Worker's own calls pin older Sonnet/Opus strings in `lib/anthropic.ts` and the S-stage prompts; a model refresh is a separate build. | Re-run the S6/S7 judge calibration after any model change. |
| **Hooks** (Stop can block; SessionStart; MCP tool hooks) | GA | A `SessionStart` hook can now run the CLAUDE.md "session opener" (`search_feedback`, `list_open_blindspots`, `/doctor`) deterministically; a blocking Stop hook implements §8.4a.3. | Blocking hooks need an escape hatch for read-only sessions. |
| **claude-code-action v1** (interactive + automation modes; runs under GitHub `schedule:`) | GA | Already used by `feedback-fix.yml`. Subject to the 60-day inactivity disable (E-10). | Consider moving the scheduler to a Routine. |

---

## G. Prioritized recommendations

Ranked by value to the system. Effort: S < 2 h, M half day, L multi-day.

| ID | Title | Owner | Effort | Depends on | Concurrent with | Confidence |
|---|---|---|---|---|---|---|
| CODE-R1 | Restore cloud write access and record it | Campbell + Code | S | none | R2, R5 | High |
| CODE-R2 | Reset the local checkout to `main`; land ADR-006 + hook; close superseded PRs/worktrees | Code | S | none | R1, R5 | High |
| CODE-R3 | Repair Step 3 email triage (or replace the LLM branch) | Code | M | R1 | R4 | Medium |
| CODE-R4 | Retire the n8n archival workflow; implement summary + archival as a Worker/Routine job | Code | M | R1 | R3 | High |
| CODE-R5 | Automate morning triage as a Routine (score `New`, promote N/day) | Code (build) + Campbell (rubric) | M | R1 (token storage) | R2, R3 | Medium |
| CODE-R6 | UC3 hygiene: bulk-resolve stale feedback/blindspots, pause or gate the daily briefing, build the ElevenLabs quota endpoint (#20) | Code | S–M | R1 | R7 | High |
| CODE-R7 | Documentation reconciliation pass (PROJECT_LOG retro entries, ADR-025, Appendix A, §8.10, system-map) | Either | M | none (content); R1 for system-map deploy | R3–R6 | High |
| CODE-R8 | §8.4a.22 migration: il-server `insights.db` (18 insights, 2 RNs) → D1; retire Tailscale Funnel | Code | M | R1 | R6 | High |
| CODE-R9 | Auth/health probe + secret rotation runbook v2 | Code | S | R1 | R8 | Medium |
| CODE-R10 | Dependency + compatibility-date bump and a minimal smoke test in CI | Code | S | R1 (to deploy) | R7 | Medium |
| CODE-R11 | Re-scope the roadmap: defer §8.4a.1/.2 reindex until ingest resumes; drop "rn-server"; decide the auto-fix loop's future | Cowork synthesis + Campbell | S | R7 | — | Medium |

**CODE-R1 — Restore cloud write access.** Nothing else on the cloud side can be repaired until this lands. Campbell runs `wrangler login` (interactive, browser) on the Mac or, better under §8.11, creates a scoped Cloudflare API token (Workers Scripts, D1, R2, Queues, Workflows: edit) and stores it three places: GitHub secret `CLOUDFLARE_API_TOKEN` (makes the existing F15 redeploy step real), the Code cloud environment (for Routines and cloud sessions), and the local keychain. Regenerate the n8n API key and update the n8n MCP server config. Then Code runs `wrangler deployments list` and `wrangler d1 execute … "SELECT count(*)"` to close the Unknowns in §B. Record the before/after in PROJECT_LOG.

**CODE-R2 — Make the checkout match the repo.** Check out `main` in `/Users/campbellkane/code/spacesc-mcp`, keep the 1,182 lines of local diff only as a patch file for the record (all of it is on `main`), merge the survey branch (report, ADR-006, CLAUDE.md fixes, lint), decide on committing `.claude/settings.json` + the Stop hook (gated: it changes unattended behavior for every clone), close PR #7 (superseded by #9) and PR #22 (merge only the posture retry button or close), prune the three worktrees and two backup files. This removes E-11.

**CODE-R3 — Step 3 triage.** With n8n access, pull the last 5 executions of `BNBjoqXt…`, inspect the triage Code node output after the §8.4a.11 W2 edit; expected cause is the §2.5/§2.14 state-loss family (the parking-lot branch changed item shape upstream of the triage-row writer). Fix, smoke with one forwarded PDF and one newsletter, and reclassify the 234 `Review` rows in bulk (gated Notion DB write). If the LLM branch is unfixable in n8n's sandbox, move triage to the Worker (`/api/openai-classify` already exists) and let n8n call it.

**CODE-R4 — Archival + summary.** The n8n job is doing net harm. Deactivate it (gated), delete the 7 marker pages (gated), and implement archival where the block API is already wrapped: a Worker cron or a weekly Routine that (a) walks PROJECT_LOG blocks, (b) copies entries older than N days into a real archive page, (c) verifies the copy before deleting, (d) rewrites the LATEST STATE SUMMARY block in place with a `mode: "summary"` extension to `/api/log-append`. This also gives every agent a sanctioned way to refresh the summary, which today is impossible under CLAUDE.md's rules.

**CODE-R5 — Morning triage.** The Parking Lot lifecycle assumes a daily human step that has not happened since May 26 and will not survive the next busy month. A Routine (≥1 h cadence, run at 06:00 ET) that reads `New` rows, scores them against Campbell's domain/topic priorities and the Insight Ledger, promotes the top N to `Retrieve Tomorrow`, and marks the rest `Skip` after 14 days would keep Cowork's nightly retrieval fed. Campbell owns the rubric and the N. Backlog decision (632 rows) is H-1.

**CODE-R6 — UC3 hygiene.** Resolve the 15 stale pipeline-stall rows and 11 blindspots via the MCP tools (gated D1 writes, one batch); pause the `0 11` daily briefing until there is something to brief on, or make it conditional on `ingest_count + insight_count > 0`; build `/api/uc3/elevenlabs-quota` (ElevenLabs `/v1/user/subscription`) and the home-screen banner from task #20 so E-2 becomes visible; set Antoni-rotation via PR #26 or close it.

**CODE-R7 — Documentation reconciliation.** Append retro PROJECT_LOG entries for §8.4a.25 and ADR-006; write ADR-025 from PRs #9–#25 and CLAUDE.md's three rules; rewrite Appendix A to include the Worker tier; correct §8.11/§8.4a.22 (no rn-server); refresh §8.10 UC statuses; regenerate `system-map.html` (the `docs/use-case-tree.gen.js` generator exists). Most of this is Cowork-shaped; the system-map deploy is Code's.

**CODE-R8 — §8.4a.22 now.** The trigger ("§8.4a.21 LANDED + 30-day soak") was satisfied 2026-06-18. The data is 18 insights + 2 RNs; the Worker already has D1, the MCP tools, and `/api/search`/`/api/approve` proxies. Migrating removes the Funnel, the launchd job, the plaintext plist secrets, and the dead `capture_insight` path, and makes `captures-today` complete. Leave bulk_loader/reconciliation as skills for now; they run on demand.

**CODE-R9 — Auth/health probe.** A `/api/health/deep` route (or a Routine) that checks Notion token, ElevenLabs subscription, GitHub dispatch token, n8n webhook (expect 401 with `receivedAuthHeader:true`), and Funnel/D1 reachability, and a §6 v2 that lists all nine Worker secrets plus repo secrets with set dates.

**CODE-R10 — Deps and smoke test.** `wrangler` is 50 minors behind, `agents` 13 minors; bump, set `compatibility_date` to a 2026 value, and add a 20-second smoke job to `ci.yml` that hits `/health`, `/api/uc3/list-gaps`, and `/mcp tools/list` post-deploy.

**CODE-R11 — Challenge the roadmap.** §8.4a.1/.2 (contextual retrieval + rechunking) is a reindex of a corpus that has not grown since May; it should wait until ingest resumes and the reconciliation shows a clean baseline. "rn-server" should be struck from §8.11. The §8.4a.25 auto-fix loop should be either wired properly (token, Routine scheduler, ultrareview gate) or explicitly parked; running it half-wired produces "Shipped" lies (F15) again. §8.4a.3 hooks-enforced logging is best implemented as `/goal` + a SessionStart hook rather than the 2026-04 bash design.

---

## H. Open questions for Campbell

1. **Parking Lot backlog:** should the 632 `New` rows be triaged, bulk-skipped by age, or left for the triage Routine to work down? (Determines CODE-R5 scope.)
2. **Archival deletions:** the n8n job reports `delete_blocks:1/1` on 8 runs and the archive pages hold no content. Do you recall what the deleted block is (the old summary block, or an entry)? If unknown, I will diff PROJECT_LOG headings against the 2026-05-02 baseline once n8n execution data is readable.
3. **SKR `Chunk Count`:** all 251 rows read NULL via Notion SQL. Was this field ever populated after the Phase 1 debug arc, or is the column name (trailing space) the reason the writer misses it?
4. **Tasks #6 and #7:** these lived only in a May Code session's task list and are not recoverable from PROJECT_LOG or the repo. Do you remember what they were, or should they be declared lost?
5. **Daily briefing:** keep generating daily (cost) or pause until ingest resumes?
6. **Auto-fix loop:** revive (needs token + scheduler) or park?
7. **Who owns the n8n instance credentials now** (the API key and the `WEBHOOK_SECRET`)? I could not find either outside n8n Variables and Worker secrets.

---

## I. Evidence appendix

### I.1 Git and repo

```
git rev-list --left-right --count HEAD...origin/main    → 1	16   (HEAD 913c005 on restructure/worker-subdirectory; origin/main 94c5997)
git worktree list → main + 3 detached (admiring-jang e6c6ace, funny-chatterjee e6c6ace, happy-mestorf b2bcb3d)
git diff --stat → 7 files, 1182 insertions(+), 43 deletions(-)
git stash list → 2 stashes (fix/audit-cron-typecheck, fix/audit-recovery)
gh pr list --state open → #26, #22, #8, #7 ; gh issue list → #6
gh workflow list --all → CI active · Claude Code active · Feedback fix disabled_inactivity
gh run list --limit 25 → last run 2026-07-21T14:58:30Z (schedule, success, 11s)
gh secret list → ANTHROPIC_API_KEY 2026-05-17 · MCP_CLIENT_TOKEN 2026-05-20
npm ci && npm run type-check → clean ; npx oxlint worker/src → 3 errors (feedback-button.js:23,144,154)
npm outdated → agents 0.9.0→0.22.0, wrangler 4.79.0→4.129.0, typescript 6.0.2→7.0.2, zod 4.3.6→4.5.4, oxlint 1.58→1.81, oxfmt 0.43→0.66
```

### I.2 Cloudflare / wrangler

```
npx wrangler whoami → "Failed to fetch auth token: 400 Bad Request" / "Not logged in."
~/Library/Preferences/.wrangler/config/default.toml → keys oauth_token, expiration_time=2026-05-22T02:04:29.985Z, refresh_token, scopes
~/Library/Preferences/.wrangler/logs → 502 log files in 2026-05, 2 in 2026-09
```

### I.3 Worker routes (from `worker/src/index.ts` on `origin/main`)

`/api/approve /api/article /api/blindspot /api/blindspot-reanalyze /api/blindspot-resolve /api/blindspots-list /api/capture /api/chat /api/feedback-apply /api/feedback-capture /api/feedback-fix-callback /api/feedback-fix-status /api/feedback-fixes-pending /api/feedback-list /api/feedback-propose-fix /api/feedback-resolve /api/gap-capture /api/ingest-log /api/link-source /api/log-append /api/openai-classify /api/openai-parse-rn /api/oq-create /api/parking-lot-list /api/parking-lot-update /api/project-log-recent /api/query /api/rn-capture /api/search /api/tts /api/tts-cache/* /api/tts-chunked /api/uc3/brief-audio /api/uc3/briefing-audio /api/uc3/captures-today /api/uc3/daily-briefing-generate /api/uc3/list-briefs-ready /api/uc3/list-gaps /api/uc3/module-approve /api/uc3/module-archive /api/uc3/module-audio /api/uc3/module-brief /api/uc3/module-errata-create /api/uc3/module-errata-list /api/uc3/module-feedback /api/uc3/module-revise /api/uc3/module-tts /api/uc3/module-unarchive /api/uc3/pipeline-cancel /api/uc3/pipeline-run /api/uc3/pipeline-status /api/uc3/series-archive /api/uc3/spaced-rep-due /api/uc3/spaced-rep-mark-listened /api/uc3/today-briefing /feedback-button.js /mcp /sse/message /uc3/*` plus surfaces `/ /uc3 /desk /reading /corpus /insights /posture /pipeline /log /system-map /feedback /health`.

Unauthenticated `curl -o /dev/null -w "%{http_code}"`: all 11 surfaces 200 (sizes: `/uc3` 143,506 B; `/feedback` 51,478 B; `/system-map` 47,653 B; `/desk` 45,676 B).

Authenticated (bearer from `.claude/settings.local.json`, never echoed): see §B 4.1 row "REST route inventory". MCP `initialize` → `serverInfo {name: spacesc, version: 1.2.0}`; `tools/list` → 8 tools.

### I.4 D1 via Worker API

```
GET /api/uc3/list-gaps → 1 gap (17993a8f, 5/5 approved, brief+full audio 5/5, stage S8, status paused)
GET /api/uc3/pipeline-status?gap_id=<17 ids> →
  57d8725c S8 cancelled 10 archived · bf48a046 S8 cancelled 10 · 78f0a4cb S4 cancelled 10 · 95b31c50 S8 cancelled 10
  dbae16e6 S8 cancelled 10 · 1bfbbbd8 S8 cancelled 10 · d9ea0746 S8 cancelled 10 · 95a8e5ab S7 cancelled 5
  435ff1a0 S7 cancelled 5 · e9c6e9ff S4 cancelled 10 · 8f6ae3c4 S7 cancelled 5 · 3e68e59e S7 cancelled 5
  ce63ead7 S7 cancelled 5 · 6d107462 S7 cancelled 5 · fbe55c2c S8 cancelled 5 · 7b295be2 S4 cancelled 5 archived
  17993a8f S8 paused 5 approved
  totals: 125 modules (120 archived, 5 approved); audio_last_error none ×125; audio_r2_key present ×11
GET /api/feedback-list → total 27, open 15, in_progress 2, resolved 10, blindspots_open 11; by surface /pipeline 15, /uc3 6, /desk 2, /posture 2, /feedback 1, /insights 1; latest created 1779456197 (2026-05-22)
GET /api/blindspots-list → 12 · GET /api/uc3/module-errata-list → 1 open (module 82, claim 777)
GET /api/uc3/today-briefing → 2026-09-04 ready 3,752,943 B voice ErXwobaYiN019PkySvjV, source_summary {ingest_count 2, insight_count 0}
GET /api/uc3/list-briefs-ready → 0 (query is WHERE rb.audio_r2_key IS NOT NULL AND lm.status != 'approved')
```

### I.5 Notion SQL (data-source queries, read-only)

```
SKR: pages 251, complete 241, pending 10, failed 0, null "Chunk Count " 251, last_created 2026-05-18 12:45:10Z
Ingestion Log: rows 980, last 2026-09-04 14:15:21Z, since 2026-06-01 384 (email 191), last email 2026-09-04 14:00:07Z
  first 'undefined [triage' 2026-05-04 01:00:06Z · n_undefined 234 · last well-formed email row 2026-05-04 23:00:06Z
  monthly (Source/Status/n): 2026-09 email/Review 42 + parking/Complete 42; 08: 57+57 (+claude 2); 07: 49+49 (+email Skipped 3, claude 1); 06: 40+40 (+claude 2)
  archival rows: 2026-05-02 ×3, 05-04 (no-op 174 KB/47 entries), 05-11, 05-18, 06-01, 06-08, 07-06, 08-03, 08-10 — hist "auth:ok|fetch:ok|compute:ok|threshold:over|create_archive:ok|delete_blocks:1/1|update_summary:ok|"
Parking Lot: New 632 · Listened 48 · Retrieved 21 · Done 6 · Skip 5 · Ingest 2 · Retrieve Tomorrow 0 (total 714)
  by month created: 05 141 (59 New) · 06 119 (119) · 07 157 (157) · 08 158 (158) · 09 139 (139); last Listened At 2026-05-26 12:07Z; last Retrieved At 2026-05-27 03:03Z
Open Questions: Open 2, Answered 1 (last 2026-05-11) · Learning Gaps: Captured 6, Drafted 7, Revision-Requested 12 (last 2026-05-21)
Archive pages (notion-search "PROJECT_LOG archive"): 7 × PROJECT_LOG_ARCHIVE_<date>_AUTO under PROJECT_LOG + PROJECT_LOG_ARCHIVE_2026-04; 2026-08-10 page body = one paragraph ("Trigger: size 741.8KB > 300KB; count 106 > 80 … 4897 blocks moved")
PROJECT_LOG fetch: 813,578 chars, 818 headings, page_last_edited 2026-09-04T13:45:54Z; OPERATIONS_PLAYBOOK 244,258 chars, last edited 2026-05-17; §8.10 last edited 2026-05-11
```

### I.6 n8n

```
n8n_health_check → status ok, apiUrl https://campbellkane.app.n8n.cloud, n8n-mcp 2.82.1
n8n_list_workflows → {"success":false,"code":"AUTHENTICATION_ERROR"}
POST /webhook/query (MCP bearer) → 401 {"ok":false,"error":"Unauthorized"} ; POST /webhook/phase0-test → 401 {"receivedAuthHeader":true}
```

### I.7 Mac

```
launchctl list | grep spacesc → 1460 0 com.spacesc.il-server ; plist mode -rw------- (embeds IL_SERVER_TOKEN + OPENAI_API_KEY)
curl 127.0.0.1:7777/health → {"ok":true,"db_path":".../spacesc-insight-ledger/db/insights.db","last_insight_at":"2026-05-20T12:30:30+00:00","insight_count":18,"version":"1.2.0"}
/openapi.json paths → /approve /capture /health /rn/approve /rn/capture /rn/search /search
/search?q=space&limit=50&include_pending=true → 18 (approved 9, pending 9) ; /rn/search?q=space → 2 (last 2026-05-11T23:32:20Z)
insights.db 12,931,072 B mtime 2026-05-20 08:30 ; no research_notes.db / rn_server.py anywhere under ~ (depth 4, Library excluded)
Tailscale status → "Tailscale is stopped." ; funnel status → "No serve config" ; curl https://campbells-macbook-air.tailf2ed6d.ts.net/health → (6) could not resolve host
~/Downloads → 0 files matching *.standalone.html / patch_*.py / *spacesc*
~/.claude/skills → spacesc-bulk-loader, -insight-ledger, -learning-modules, -open-questions, -reconciliation (last report 2026-05-02), -research-note-ledger, -spacenews-retrieval
```

### I.8 System map

```
/system-map: static data in HTML; date literals ≤ 2026-05-20; feature statuses built 43 / partial 7 / queued 7 / future 7 / live 6 / gap 1; pct 85,85,90,50,80
next-action banners: "Trigger §8.4a.1 + §8.4a.2 retrieval upgrade cycle" · "Queue §8.4a.1 + §8.4a.2 for the next reindex cycle" · "Execute §8.4a.21 W9 dogfood — final pause-for-Campbell" · "Build the full assembly + live citation trail layer" · "Trigger §8.4a.3 — Hooks-enforced logging"
```

### I.9 What a read-only Pinecone reconciliation needs

```
cd ~/.claude/skills/spacesc-reconciliation && NOTION_TOKEN=… PINECONE_API_KEY=… python3 reconcile.py   # DRY-RUN default; PINECONE_HOST defaults to space-sc-memory-ysqtshh.svc.aped-4627-b74a.pinecone.io, namespace SpaceSC
```
Both keys are held only in n8n Variables and Worker secrets; export them from Cloudflare (`wrangler secret` cannot read values; use the dashboard) or n8n after CODE-R1.

### I.10 Capability research

Subagent (`claude-code-guide`) verified against `code.claude.com/docs/en/{routines,scheduled-tasks,channels,remote-control,auto-mode-config,goal,ultrareview,agents,artifacts,model-config,hooks-guide,github-actions}.md`, `platform.claude.com/llms.txt`, `developers.cloudflare.com/agent-setup/claude-code/` on 2026-09-04.

---

## Completion receipt — SURVEY-2026-09-CODE

**Customer end state (restated, testable):** a Markdown report in the fixed A–I skeleton, committed to the repo, mirrored as a Notion child of the Ingestion Log page, and announced in PROJECT_LOG via `/api/log-append`, with every §4 component given a verdict backed by a command or query, and with only ungated fixes applied.

**Acceptance criteria:**
- AC1 Pre-flight reads done in order → ✓ (CLAUDE.md, ADR-024 via worktree, PROJECT_LOG slices, playbook sections, §8.10; §I.5)
- AC2 Every §4.1–4.6 item has expected/observed/verdict → ✓ (§B, 40 rows)
- AC3 Fixes are ungated and reversible → ✓ (§D; no D1/Pinecone/R2/Notion-DB/n8n/secret/hook-behavior writes)
- AC4 Report at `docs/surveys/2026-09-survey-claude-code.md` on a pushed branch → ✓ ; PR → ✗ blocked by auto-mode, command handed to Campbell (D-1)
- AC5 Notion page created under Ingestion Log → ✓ (D-5, URL in PROJECT_LOG entry)
- AC6 PROJECT_LOG entry via log-append with the required heading → ✓ (D-6)
- AC7 Cowork survey not read → ✓ (never fetched)

**Adversarial review (self, hostile reviewer):** (1) "You call Step 3 triage broken but every newsletter is handled." — Conceded in wording: the parking branch is Healthy; the triage *log row* is malformed for 100 % of emails and no `Complete`/`Skipped`-by-classifier email row exists since 05-04, which is the observable contract of §8.4a.7. (2) "Archival 'deletes one block' might be the summary block, so no loss." — Flagged as H-2 and E-3 with both hypotheses; not asserted as loss. (3) "You couldn't see n8n or D1 directly; most of 4.3 is inference." — Marked Unknown where inference is the only basis; the Worker-API census is authoritative for D1 state of the 17 series. (4) "Verdicts on the daily briefing cost are estimates." — Stated as lower bounds with the per-file size from today's row.

**What was NOT tested, and why:** Pinecone vector count (no key reachable); D1 schema/table counts and R2 object counts (no wrangler auth); n8n workflow list, executions, and error rates (API key rejected); live Worker version id (same); ElevenLabs remaining credits (key in Worker only); whether non-newsletter email is arriving in Gmail (no Gmail access from this session); the Cowork nightly task's own logs; iOS rendering of `/uc3`; any POST/mutating Worker route.

**Top three ways this is likely still broken:** 1. The triage failure onset (05-04) may predate the §8.4a.11 W2 change by hours, making the causal attribution wrong; checked only by timestamp correlation. 2. The 8 deleted PROJECT_LOG blocks may be real entries; not checked against a baseline. 3. `list-gaps` may hide series beyond the 17 I know from the feedback inbox; D1 could hold more cancelled runs; checked only via those ids.

**Self-grade:** 8/10 — the report is complete in structure and every verdict cites evidence, but three of the highest-value rows (Pinecone, n8n executions, live version) are Unknown because of the access failures the survey itself diagnosed.
