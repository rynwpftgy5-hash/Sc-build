# 0021. UC3 Fundamentals Learning Modules — build dispatch

- **Status:** ACCEPTED
- **Date:** 2026-05-16
- **Supersedes:** none
- **Superseded by:** none
- **Tags:** uc3, pedagogical-artifacts, tier-4, cloudflare-workflows, always-on

## Context

§8.4a.19 shipped the article-playback half of UC3 (the Commute Player).
The latent educational dimension of UC3 — originally framed at
`[2026-05-05 §8-design-research]` as *"ambient self-education during
commute / downtime"* — remained un-built. The motivating workflow is:
Campbell captures a knowledge gap while listening to corpus content;
the system generates a week-series of \~10-min audio-native learning
modules grounded in authoritative external sources and anchored to
corpus material Campbell has already engaged with; Campbell reviews
each module via a \~4–6 min audio review brief with voice feedback;
approved modules join the §8.4a.19 Commute Player library.

This dispatch is also the proof-of-pattern for the cloud-side substrate
(Cloudflare Workflows + D1 + R2 + Queues) that a later dispatch
(§8.4a.22) will replicate to migrate the Mac-bound il-server and
rn-server SQLite components off the desktop. The decision here is
therefore not only a Tier 4 capability — it is the bridge to a more
independent always-on system.

## Decision

SpaceSC adopts a three-capability architecture (**Capture · Generate ·
Consume**) for UC3 Fundamentals Learning Modules, runs the generation
pipeline on Cloudflare Workflows with D1 + R2 + Queues, and establishes
**Tier 4 — Pedagogical Artifacts** in the §8.8.8 canonical model.

### Hard requirements

1. **Audio-native end-to-end.** Capture is voice; review is audio + voice
   feedback; consumption is audio. The generation pipeline produces
   audio-native scripts, not prose-then-TTS.
2. **Verification with Campbell review-gate.** Multi-pass source-grounded
   verification + Campbell audio review brief approval. No module reaches
   the playable library uncurated.
3. **Always-on.** Cloud-side substrate end-to-end. No dependency on Mac
   availability. Per §8.11 Always-On Architecture Principle (captured
   below; pending `OPS_PLAYBOOK` promotion).
4. **Corpus-anchored.** Modules reference corpus material Campbell has
   engaged with by name. Listen/read signal from §8.4a.19 (probed at
   W0); fallback to full corpus if signal absent.
5. **iPhone Safari + Claude iPhone app render-check acceptance-blocking**
   per Phase D standard.
6. **Plan-mode discipline** per §8.4a.5 at all seven pause-for-Campbell
   gates.

### Three capabilities

**Capture.** Three entry points feed one new *Learning Gaps Queue*
(Notion DB):

- Voice command in the §8.4a.19 Commute Player (primary surface —
  *"Claude, I want to learn about X"*)
- Fifth CurationChat affordance — 📚 *"Capture as learning gap"* —
  added to UC1 SKR Workspace + UC2 Query (UC4 future)
- CLI `ml add` (mirrors existing `il add` / `rn add` skill patterns)

**Generate.** A Cloudflare Workflow orchestrator runs a 12-stage
pipeline:

- **S1** — Topic decomposition (system-suggested module count +
  reasoning; Campbell can override at capture or review)
- **S2** — Source discovery: Bedrock shelf + on-demand authoritative web
  search *(parallel with S3)*
- **S2.5** — Analog retrieval & ranking against the 4-criterion rubric
  (structural fit / confidence / epistemic strength / constitutive role)
- **S3** — Corpus retrieval: engagement-biased; falls back to full
  corpus *(parallel with S2 / S2.5)*
- **S4** — Outline generation: audio-native scaffolded structure
- **S5** — Section drafting *(parallel across sections via Queue fan-out)*
- **S6** — Verification Pass 1: per-claim cite-verification by a
  different model *(parallel across claims)*
- **S7** — Verification Pass 2: cross-source consistency + internal
  consistency + pedagogical soundness rubric
- **S8** — Review brief assembly: 5-segment audio brief (\~4–6 min)
- **S9** — Voice feedback NLU: small Claude call parses spoken feedback
  into structured revision actions
- **S10** — Revision dispatch: routes actions back to appropriate
  Workflow stages
- **S11** — Full-module TTS via ElevenLabs + R2 cache (reuses §8.4a.19)
- **S12** — Library registration in Commute Player + optional
  spaced-repetition schedule (+3d / +1w / +3w)

**Consume.** The §8.4a.19 Commute Player is extended to three content
types — articles (existing), module review briefs (new \~4–6 min
asset), and full modules (new \~10 min asset) — plus a module-series
view and a 🚩 *flag-this-claim* affordance (timestamp + 30s context
→ Module Errata).

### Tier 4 — Pedagogical Artifacts (new in §8.8.8 canonical model)

- **Cloudflare D1** for module records, pipeline state, citations,
  verification trail
- **R2** for audio binaries + large script blobs
- **Notion DB** for the Learning Gaps Queue (Campbell-facing
  browsability)
- **New MCP tool `search_modules`** on the Worker, sibling to existing
  `query_corpus` and `search_insights`

### Storage split by access pattern (not by tier)

- **Tier 1 Sources:** cloud (Pinecone + Notion SKR) — already cloud
- **Tier 2 Insights:** Mac SQLite (il-server) — desk-curated workflow;
  §8.4a.22 migration candidate
- **Tier 3 Research Notes:** Mac SQLite (rn-server) — desk-curated
  workflow; §8.4a.22 migration candidate
- **Tier 4 Pedagogical Artifacts:** cloud (D1 + R2 + Notion DB) —
  async pipeline + mobile consumption; always-on required

### 4-criterion Analog rubric (S2.5)

For each module that uses analogical reasoning, the Analog Retrieval
Engine scores candidate analogs against:

1. **Structural fit** — does the causal mechanism in the source analog
   map onto the target topic?
2. **Confidence** — how confident is the LLM in this mapping?
3. **Epistemic strength** — how well-established is the source analog's
   own causal claim in the literature? (settled / contested / speculative)
4. **Constitutive role** — was the causal element *necessary* to the
   outcome (constitutive, scores higher) or merely *contributory*
   (amplifying, scores lower)?

Top-1 or top-2 by composite score advance to drafting. Weaker analogs
are cut explicitly. Rubric scores appear in the Sources-audit segment
of the review brief (transparency artifact). The default rubric is
calibrated for transformation-style questions; inversion for
enhancement-style questions is v1.1 polish (not v1 scope).

## Consequences

**Positive:**

- Introduces Tier 4 (Pedagogical Artifacts) to the §8.8.8 canonical
  model.
- Proves the cloud-side substrate pattern (Cloudflare Workflows + D1 +
  R2 + Queues) for §8.4a.22.
- Removes Mac-availability dependency for an entire class of
  long-running async work.
- Gives Campbell an audio-native review surface, eliminating
  prose-then-TTS cognitive overhead.

**Negative / new obligations:**

- Adds Cloudflare account-cost line items (D1 + R2 + Worker invocations
  + ElevenLabs increment); W0 includes an estimate.
- Adds a new MCP surface (`search_modules`) and a new Notion DB
  (Learning Gaps Queue + Module Errata) that must be maintained.
- Seven pause-for-Campbell gates totalling \~2 h of Campbell time
  across 5–7 sessions.
- Adds a 30-day soak window before §8.4a.22 can begin.

## Implementation notes

### Build sequence

| Workstream | Scope | Code time |
|------------|-------|-----------|
| **W0** | Pre-flight: probe §8.4a.19 play-event logging surface; confirm Cloudflare Workflows + Queues + D1 feature availability; D1-vs-Durable-Objects decision; account-cost estimate; ElevenLabs quota headroom. **Pause-for-Campbell.** | \~1 h |
| **W1** | Learning Gaps Queue Notion DB + CLI `ml add` skill at `~/.claude/skills/spacesc-learning-modules/` + webhook `POST /api/gap-capture`. **Pause-for-Campbell** on schema. | \~2 h |
| **W2** | Capture surfaces: voice command in Commute Player; 5th CurationChat affordance in UC1/UC2; all surfaces POST to `/api/gap-capture`. | \~3 h |
| **W3** | Source shelves seed + Analog rubric commit. Bedrock shelf curated per domain (finance/economics: SEC, FASB, CFA Institute, IFRS, FRED; defence policy: DoD doctrine, GAO, RAND, NSSP, CRS; space industry: AIAA, ITU, FCC, NASA technical reports). Analog seed bibliography (Schumpeter, Christensen, Carlota Perez, Mokyr, Yergin, Isaacson, Tedlow). Analog rubric committed at `/prompts/analog_ranking.txt`. **Pause-for-Campbell** on shelf. | \~2 h Code + \~2 h Campbell joint + \~30 min Cowork |
| **W4** | Generation pipeline S1–S4: Cloudflare Workflow scaffold; S1 topic decomposition; S2 source discovery (with deny-list for blogs/opinion); S2.5 Analog rubric; S3 corpus retrieval; S4 audio-native outline. **Pause-for-Campbell** on dry-run with test topic ("quarterly earnings statements"). | \~6–8 h |
| **W5** | Section drafting + verification S5–S7. Queue fan-out for parallel drafting; mandatory citation on every factual claim; verification Pass 1 (per-claim, different model) and Pass 2 (cross-source + internal + pedagogical soundness). **Pause-for-Campbell** on verification trail inspection. | \~5–6 h |
| **W6** | Review brief assembly + audio-native template. S8: 5-segment audio brief (sources audit \~45s; outline preview \~75s; corpus connections \~30s; high-stakes claims spot-check \~90s; sample clip \~60s). ElevenLabs TTS for review brief; voice-separation decision pinned here. | \~3–4 h |
| **W7** | Voice feedback NLU + revision dispatch. S9 small Claude call parses transcript into structured actions (`approve` / `re-verify claim N` / `swap source X for Y` / `regenerate section M with constraint Z` / `change voice` / …). S10 dispatcher routes actions back to Workflow stages. Capture path: existing `il dictate` + new `/api/module-feedback` webhook. **Pause-for-Campbell** on simulated voice feedback dry-run. | \~3 h |
| **W8** | TTS + Library + Errata. S11 full-module TTS via existing ElevenLabs + R2 cache. S12 library registration: new "module" + "review-brief" content types in Commute Player + series view + spaced-repetition defaults (+3d / +1w / +3w). 🚩 flag-this-claim affordance + Module Errata Notion DB. New `search_modules` MCP tool on Worker. | \~2 h |
| **W9** | Smoke + iPhone confirm + LANDED. End-to-end smoke on test topic; iPhone confirm Commute Player renders module + review-brief types and flag-this-claim works on touch; series view navigation. LANDED entry to PROJECT_LOG; status flip across `OPS_PLAYBOOK` + HTML roadmap. **Pause-for-Campbell** for final review-gate dogfood. | \~2 h Code + \~30 min Campbell |

**Total build estimate:** \~35–45 h Code + \~2 h Campbell across
5–7 sessions.

### Pause-for-Campbell gates

1. **W0 results** — architecture deltas if any surface (\~10 min)
2. **W1 schema** — Learning Gaps Queue schema review (\~10 min)
3. **W3 shelves** — Bedrock + Analog seed approval (\~30 min joint pass)
4. **W4 dry-run** — outputs at S1/S2/S3/S2.5/S4 on test topic (\~20 min)
5. **W5 dry-run** — verification trail inspection (\~15 min)
6. **W7 dry-run** — simulated voice feedback handling (\~15 min)
7. **W9 dogfood** — real end-to-end on first captured gap (\~30 min)

### Acceptance criteria (W9)

- **AC1.** Voice capture in §8.4a.19 Commute Player creates a Learning
  Gaps Queue row with trigger source linkage.
- **AC2.** CurationChat 5th affordance creates a Learning Gaps Queue
  row from any of UC1/UC2 surfaces.
- **AC3.** CLI `ml add` creates a Learning Gaps Queue row.
- **AC4.** Worker triggered from the Queue runs S1–S7 end-to-end on a
  test topic without manual intervention.
- **AC5.** Module review brief renders in Commute Player as \~4–6 min
  audio with all five segments.
- **AC6.** Voice feedback recorded via `il dictate` → parsed into
  structured actions → triggers revision dispatch.
- **AC7.** Approved full module renders in Commute Player as \~10 min
  audio.
- **AC8.** Module series view groups 5 modules; spaced-repetition
  schedule auto-surfaces re-listen prompts at +3d / +1w / +3w.
- **AC9.** Flag-this-claim during playback creates a Module Errata row
  with timestamp + 30s audio context + linked `module_id`.
- **AC10.** Verification trail per module is queryable via
  `search_modules` MCP tool.
- **AC11.** All four Analog rubric criteria appear in the Sources-audit
  segment of the review brief for any module that uses an Analog.
- **AC12.** iPhone Safari + Claude iPhone app render-check passes for
  the new player content types.

### Trigger conditions for build start

- §8.4a.19-EL-LANDED (pending iPhone confirm; likely clears within days)
- `ANTHROPIC_API_KEY` rotation closed (Campbell action via Anthropic
  console → `wrangler secret put ANTHROPIC_API_KEY`)
- Campbell explicit greenlight via fresh Claude Code session

### Roles at build time

- **Claude Code:** builds W0–W9 with plan-mode discipline at all seven
  pause-for-Campbell gates per §8.4a.5. Reports at each chunk boundary.
- **Campbell:** seven pause-for-Campbell decisions (\~2 h total). Final
  review-gate dogfood at W9 on first real captured gap.
- **Cowork:** W3 Analog seed bibliography curation (\~30 min
  browsing-assist). Stand-by otherwise.
- **Claude Opus:** HTML roadmap updates on workstream LANDED events;
  PROJECT_LOG narrative entries at major milestones; `OPS_PLAYBOOK`
  promotion of §8.11 + §8.4a.22 (housekeeping).

## Open questions

All v0.1 → v0.3 open questions resolved at design time. Net residual:

- **W3:** exact Bedrock-shelf seed list per domain — Campbell + Opus
  joint pass at W3.
- **W6:** review-brief voice vs. full-module voice (one voice or two?)
  — design decision at W6.
- **W8:** spaced-repetition schedule defaults (+3d / +1w / +3w as
  proposed; refinable post-launch).
- **W9:** error-reporting affordance UX (flag-this-claim button
  placement on player UI).

## Captured pending `OPS_PLAYBOOK` promotion

Two durable architectural decisions surfaced during §8.4a.21 design.
They are recorded here for traceability and will be lifted into
`OPS_PLAYBOOK` in a follow-up housekeeping pass.

### §8.11 — Always-On Architecture Principle

**Principle.** Future system builds default to cloud-side / always-on
infrastructure where feasible. Mac-bound components (il-server SQLite
for Tier 2 insights; rn-server SQLite for Tier 3 research notes;
`bulk_loader` and reconciliation Python skills) are tagged as
candidates for future migration to cloud-native substrates (Cloudflare
Workers + D1 + R2 + Queues).

**Rationale.** A system whose components require Campbell's Mac to be
on and awake creates compounding single points of failure: pipelines
stop overnight; iPhone capture surfaces depend on Tailscale Funnel to
reach the Mac il-server; long-running async tasks cannot complete
reliably during sleep/restart windows. Cloud-native substrates
eliminate these failure modes.

**Application.** All new build dispatches default to cloud-side
substrate selection unless there is a specific reason to use the Mac
(e.g. desk-bound curation workflows where "off when desktop is off"
semantics are actually desired). When Mac substrate is selected, the
dispatch must justify the choice.

**Migration roadmap.** §8.4a.22 (queued) is the first migration build,
triggered after §8.4a.21 proves the cloud pattern for 30+ days. Future
migration sub-actions in the §8.4a queue may follow as scope warrants.

### §8.4a.22 — Cloud migration of Mac-bound substrates (sketched, deferred)

- **Status:** SKETCHED · BUILD DEFERRED
- **Trigger condition:** §8.4a.21 LANDED + Worker/D1/R2 pattern proven
  in production for 30+ days
- **Scope:** migrate il-server SQLite (Tier 2) → D1; rn-server SQLite
  (Tier 3) → D1; `bulk_loader` Python skill → Worker-triggered cloud
  function; reconciliation Python skill → Worker-triggered cloud
  function.
- **Why incremental at trigger time:** §8.4a.21 will have built and
  proven all the infrastructure (Workflows, D1, R2, Queues, MCP tool
  patterns). §8.4a.22 is data migration + endpoint reconfiguration +
  skill rewrites, not a ground-up build. Estimated scope: \~10–15 h
  Code at trigger time.
- **Why not now:** §8.4a.21's pattern needs production observation
  before committing the rest of the system to it. The 30-day soak
  period is the gate.

---

*Provenance: migrated from Notion dispatch page
`36248344-93df-81c6-9296-c6eb146e75f0` on 2026-05-17. Original title:
"🎓 Dispatch [2026-05-16 §8.4a.21] UC3 Fundamentals Learning Modules
— Build Dispatch". Original status at migration: SPEC LOCKED · BUILD
PENDING TRIGGER. Authored by Claude Opus 2026-05-16 in single-session
design conversation with Campbell; v0.1 → v0.3 iteration trail
captured in PROJECT_LOG entries `[2026-05-16
fundamentals-learning-design-*]`.*
