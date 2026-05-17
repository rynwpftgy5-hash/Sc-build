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

- **Plan-mode discipline at every pause-for-Campbell gate** (per ADR-005
  once authored). Long-running or structural changes propose before they
  execute; the gate exists so the human review surface stays narrow.
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
