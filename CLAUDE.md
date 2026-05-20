# SpaceSC Agent Orientation

You are working in the SpaceSC repository. Read this file first to orient.
It is short by design — deeper context lives behind the pointers in the
"Progressive disclosure" section at the bottom. Pull more only when the
task demands it.

## Why

SpaceSC is a single-user analytical workbench for space security cooperation.
It serves a welfare-theorem analytical layer applied to the intersection of
policy, economics, and technology in space security cooperation — i.e. the
system is structured to support reasoning that treats SSC outcomes as the
product of an institutional welfare problem, not a single-discipline
narrative. SpaceSC is one researcher's instrument; design for a single
principal, not a team or a multi-tenant SaaS product. Defaults that make
sense for one user (long-lived state, hand-tuned prompts, ad-hoc
standalones) are correct here even when they would be wrong for a product.

## What (project map)

- `worker/` — Cloudflare Worker source (spacesc-mcp). Forthcoming.
- `.claude/skills/` — Claude Code skills (spacesc-insight-ledger, bulk-loader,
  and others). Forthcoming when the Mac-side push lands.
- `standalones/` — UC1 / UC2 / UC3 standalone HTML surfaces, i.e.
  use-case-specific pedagogical artifacts published as self-contained
  pages. Forthcoming.
- `docs/` — architecture documentation, design notes, and reference
  material kept inside the repo.
- `docs/adr/` — Architecture Decision Records. The §8.4a.* dispatch
  series is archived here as immutable ADRs (one dispatch → one ADR).

Things that intentionally do NOT live in this repo:

- Notion page content (PROJECT_LOG, OPS_PLAYBOOK) — those are the live
  notebooks; the repo holds code and immutable decisions, not running notes.
- The Mac-side `il-server` / `rn-server` SQLite databases — `.gitignore`
  blocks `*.db` precisely to keep those out.
- Secrets of any kind — see `.gitignore` for the guarded patterns.

## How (build conventions)

- **Session opener — feedback inbox + blindspots** (§8.4a.25). On every
  Claude Code session that touches SpaceSC UI surfaces, **first** call the
  two MCP tools:
  1. `search_feedback({ status: "open" })` — Campbell's 🚩 inbox across
     /uc3, /desk, /reading, /corpus, /insights, /posture, /pipeline, /log,
     /system-map. Each item has the surface, view state at capture, type
     (bug/confusion/feature/question), and notes. Address these *before* he
     has to remember and re-explain.
  2. `list_open_blindspots()` — the adversarial UAT register. Each open
     row is a check our ADR-024 self-audit missed when Campbell had to
     report something. Per ADR-024 Part 3.5, the pre-deploy gate requires
     every blindspot in the touched-surface scope to be resolved (applied
     into the F-register or rejected with rationale) before declaring done.
  These two calls cost a few hundred ms total. The cost of skipping them is
  Campbell's context switch when he has to re-explain what he already
  reported.
- **Plan-mode discipline at every pause-for-Campbell gate** (per ADR-005
  once authored). Long-running or structural changes propose before they
  execute; the gate exists so the human review surface stays narrow.
- **UI build discipline** (per [ADR-024](docs/adr/0024-ui-build-discipline.md)).
  Before any work that touches a user-facing surface, follow the four-part
  protocol — verbatim, in order:
  1. **Charter + Persona + thinking template** (Part 1). State a
     one-sentence charter (*"explore X with Y to discover whether the user
     can reach end-state Z"*). Name the persona being tested as
     (commute Campbell / desk Campbell). Then answer the six framing
     questions. Fetch the live system map at
     <https://spacesc-mcp.75xnd2784n.workers.dev/system-map> to identify
     which use case owns the work.
  2. **Self-audit checklist** (Part 2) — three sub-parts: integrity
     checks (10), tours (Feature / Money / Landmark / Back-alley /
     Saboteur / All-nighter / Garbage-collector — pick deliberately),
     SFDIPOT coverage walk, and oracles (Claims + Purpose load-bearing).
     Find issues and fix them in the same turn; do not surface a bug list
     as a decision for the user.
  3. **Past-failure register** (Part 3) — scan F1–F14 for repeating
     patterns.
  4. **Session debrief** (Part 4) — paste the structured debrief block
     at the end of the turn. The "User-outcome reach" line is
     load-bearing: *reached / partially reached / blocked.*

  The discipline exists because UI work in this repo has historically
  regressed across iterations when these steps were skipped, and because
  *"tests pass"* is not the same as *"the user actually completed the
  thing they came to do."*
- **§8.11 Always-On Architecture Principle**: cloud-side substrate by
  default. New capabilities live on Cloudflare Workers, not on a laptop
  that has to be awake. Local-only components are a last resort and
  should be documented as such in an ADR.
- **Four-tier canonical model** — every artifact belongs to exactly one
  tier:
  - **T1 Sources** — Pinecone + Notion (immutable corpus, retrieval ground truth)
  - **T2 Insights** — SQLite / D1 (atomic findings, lab-notebook scale)
  - **T3 Research Notes** — SQLite / D1 (synthesized notes built from T2)
  - **T4 Pedagogical Artifacts** — D1 + R2 + Notion (publishable surfaces)
- **Logging**: `PROJECT_LOG` (Notion page
  `34548344-93df-81ed-972f-c524406eeb04`) is the chronological lab notebook.
  Append entries via the Worker `/api/log-append` webhook, **NOT** via the
  slow Notion `update_content` path. The webhook batches and is durable;
  the direct path is rate-limited and stalls on long sessions.
- **OPS_PLAYBOOK** (Notion page `35248344-93df-81a7-9cfa-ece289a95248`)
  is the topic-organized field manual. §1–§11 cover the recurring shapes
  of work (ingestion, RAG, voice, deploys, etc.); consult the matching
  section before reinventing a pattern.
- **UC3 player contracts** (load-bearing, post-2026-05-19 polish):
  - `/api/uc3/pipeline-status` emits per-module `audio_r2_key`, `voice_id`,
    `audio_last_error`, `audio_attempts_count`, `audio_last_attempt_at`,
    plus `notion_page_id` at top level. UI consumers depend on the
    failure-state trio for the F14 surface.
  - `/api/uc3/list-briefs-ready` is the batched home-screen query —
    replaces N-round-trip pipeline-status loop. Returns `brief_audio_bytes`
    so the client can estimate duration (eleven_multilingual_v2 ~128kbps,
    16 KB/s).
  - `/api/uc3/captures-today` aggregates errata + Notion gaps + Notion OQs
    over the last 24h. Insights and RNs land on the Mac-side il-server
    and are *not* yet in this endpoint — see deep links in the player's
    Captures tab.
  - `/api/uc3/module-tts` accepts `{ async: true }` to queue via
    MODULE_TTS_QUEUE and return 202 immediately; default sync mode is
    retained for debug paths. The player's retry button uses async mode.
  - `navigator.mediaSession` is wired at App level so iOS lock screen +
    Control Center drive play/pause/seek. Don't dismantle without keeping
    that flow whole.
  - `localStorage.spacesc_tracking_gaps` persists the gap-capture pipeline
    tracker across reloads; auto-prunes at 24h.
- **ADR-024 failure register** is currently at F1–F14. F13 ("tests pass" ≠
  user-outcome reach) and F14 (polled positive-signal-only state) are the
  most recently added; both came from the UC3 player. Scan before any UI
  build.

## Progressive disclosure (read on demand)

Pull deeper context only when the task demands it:

- `docs/adr/` — active dispatches and decision history. Read the ADR
  matching the area you're working on before proposing structural changes.
- **PROJECT_LOG** (Notion) — current state and most recent entries. Read
  this first if you need to know what just happened.
- **OPS_PLAYBOOK** (Notion) §1–§11 — patterns and runbook. Read the
  section matching the work shape (ingestion, RAG, voice, deploys).
- `README.md` — high-level project overview (no operational data).

Keep this file slim. New orientation material that applies broadly
belongs here; everything topic-specific belongs in the ADR or playbook
section it naturally fits.
