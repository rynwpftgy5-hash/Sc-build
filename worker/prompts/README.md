# §8.4a.21 prompts/ directory

LLM prompt templates + curated reference data consumed by the §8.4a.21
module generation pipeline (Cloudflare Workflow stages S1–S12).

## Files

### `analog_ranking.txt`
Prompt template for **S2.5 — Analog Retrieval & Ranking**. Implements the
4-criterion rubric (structural fit / confidence / epistemic strength /
constitutive role). Input variables marked `<<TOKEN>>`; consumer (Worker
Workflow) substitutes before LLM call.

Output is strict JSON — composite score, per-criterion scores, advance/cut
decision, rationale. Rubric scores surface in the Sources-audit segment of
the review brief (transparency artifact).

### `bedrock_shelf.json`
Per-domain authoritative-source list for **S2 — Source Discovery**. The LLM
consults this shelf before falling through to on-demand web search.
Schema: `{domain: {description, sources: [{name, full_name, url,
source_type, trust, url_patterns, notes}]}}`.

Deny-list section excludes blog/opinion content patterns from S2 retrieval.

**Status:** v0.1 starter. Per dispatch §8.4a.21 W3 — Campbell + Opus joint
curation pass needed before W4 dependency locks.

### `analog_seed_bibliography.json`
Authoritative texts whose causal frameworks frequently appear as analogs in
fundamentals-learning modules. S2.5 starts retrieval here, then may expand
via web search per the 4-criterion rubric. Schema: `{entries: [{author,
work, year, framework, framework_summary, epistemic_strength,
common_analog_targets}]}`.

**Status:** v0.1 starter — 7 entries per dispatch v0.3 list. Cowork
W3 browsing-assist pass should expand domain coverage (notable gaps:
monetary history, network-economics theory, military procurement history).

## Curation workflow

Per dispatch §8.4a.21 W3:
- **Bedrock shelf:** Campbell + Opus joint pass. Opus proposes additions
  based on Campbell's domain priorities; Campbell ratifies.
- **Analog seed bibliography:** Cowork browsing-assist (~30min) finds
  additional texts; Campbell reviews additions in PR-style flow.
- **Analog ranking rubric:** stable; only revise based on observed S2.5
  output quality after dry-runs at W4.

## Consumer wiring (W4+)

When the Cloudflare Workflow lands at W4, these files are bundled into the
Worker deployment (via `wrangler.jsonc` `[[assets]]` or imported at build
time) and read at S2/S2.5. No runtime fetch — these are deployment artifacts.

## Versioning

- `schema_version` field in JSON files tracks breaking schema changes.
- Bump on any field rename/removal/type change. Worker consumers must
  pin to a `schema_version` they understand.
