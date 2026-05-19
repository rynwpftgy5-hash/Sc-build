// SpaceSC use-case-tree.docx generator
// Mirrors the data in worker/src/assets/system-map.html, rendered as an
// editable working document for Campbell. Status markers ([BUILT], [PARTIAL],
// etc.) are intentionally find-and-replaceable.

const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, LevelFormat, PageOrientation,
  Table, TableRow, TableCell, WidthType, ShadingType,
} = require("docx");

const UCS = [
  {
    num: "UC1", color: "185FA5", name: "Ingest Curation",
    job: "Get the right material into the corpus — understood, annotated, committed.",
    device: "Desktop", pct: 85,
    next: {
      title: "Trigger §8.4a.1 + §8.4a.2 retrieval upgrade cycle",
      why: "The Research Session pattern shipped across UC1–UC4 (§8.4a.17/.18/.19/.20). The pipeline + triage + annotation + structured-capture stack is built. The remaining gap is retrieval quality — contextual retrieval and recursive 512-token chunking. These couple naturally with a reindex cycle to amortize re-embedding cost.",
    },
    phases: [
      { label: "Automatic ingest pipeline", features: [
        { status: "built",   title: "Email ingest pipeline",            badge: "Live",     ref: "Workflow BNBjoqXt", desc: "Gmail trigger (hourly) → MIME router → text extraction → SKR page creation → Pinecone upsert. Handles PDF, XLSX, CSV natively; DOCX/PPTX via Drive convert." },
        { status: "built",   title: "Smart inbox handler",              badge: "Live",     ref: "§8.4a.7",            desc: "gpt-4o-mini LLM-as-router classifies each email: ingest / review / skip / spam. Conservative default routing on parse failure (§2.18) — ambiguous items go to review, never silently dropped." },
        { status: "built",   title: "Idempotency dedupe",               badge: "Live",     ref: "email_message_id",   desc: "Dedupe check on email_message_id prevents double-ingest when the same email is forwarded twice." },
        { status: "built",   title: "Cowork nightly retrieval",         badge: "Live",     ref: "§8.4a.11",           desc: "Authenticated browser session pulls full article text for items marked Retrieve Tomorrow. Solves the paywall problem. Runs overnight so full text is ready when you open the article next morning." },
        { status: "built",   title: "SpaceNews Curated Ingest Redesign", badge: "Live",    ref: "§8.4a.11",           desc: "Reading Parking Lot Notion DB + three-shape detection (CkFleWzr) + Curated Action Webhook (9QKgeDSw) + Polling worker (iqiNBClT) + Fire Now buttons + Audio stub. Ingestion is the last decision in the pipeline, not the first." },
      ]},
      { label: "Triage & annotation", features: [
        { status: "built",   title: "Triage / SKR Workspace v2",        badge: "Live",     ref: "§8.4a.16", desc: "11-status lifecycle (New → Retrieve Tomorrow → Retrieved → Listened → Ingest → Insight → Done / Skip). Inline domain and topic chip annotation. Bulk status and priority updates. Merged with Reading Review per §8.4a.16 SKR Workspace (Items 6+7 merged 2026-05-06)." },
        { status: "built",   title: "Reading Review",                   badge: "Live",     ref: "§8.4a.14", desc: "Full article text + annotation panel. Status, priority, domain, topic, source reliability, Reframe (your framing), freeform notes. Mobile-responsive with section toggle." },
        { status: "partial", title: "Reframe field",                    badge: "Partial",  ref: "", desc: "Your analytical framing of each source document. Captured in Reading Review. Free-text today — not yet structured or indexed for product drafting feed." },
      ]},
      { label: "Research Session (UC1 surface)", features: [
        { status: "built",   title: "Article Research Session",         badge: "Live",     ref: "§8.4a.17 W7", desc: "SKR Workspace v2 detail view: chat panel with article body + auto-corpus-query of top 3–5 related chunks pre-loaded. Four inline-capture affordances. Read an article and query the corpus against it in one surface; commit with framing already attached. The horizontal Research Session pattern, UC1 instance." },
        { status: "built",   title: "CurationChat module",              badge: "Live",     ref: "§8.4a.17", desc: "Shared React module consumed by UC1–UC4 surfaces. Chat panel + four capture affordance buttons: Ingest as linked source · Capture as research note · Save as open question · Capture as insight." },
        { status: "built",   title: "Tier-3 Research Notes",            badge: "Live",     ref: "absorbed §8.4a.12", desc: "Bundled question + reasoning + cited_sources + assessment + optional falsifiable_tests. SQLite tables in il-server insights.db; CLI rn; webhook /webhook/research-note-capture; SKR source_type=research-note extension; Pinecone vectorization. Cited URL fan-out to Reading Parking Lot." },
        { status: "built",   title: "Open Questions Queue",             badge: "Live",     ref: "§8.4a.17", desc: "Tier-3-pending sibling. New Notion DB; CLI oq; webhook /webhook/open-question-capture; status lifecycle (Open / Researching / Answered / Won't-Answer / Stale). Infrastructure shipped; autonomous agent consumer deferred." },
        { status: "partial", title: "Pre-loaded auto-observations",     badge: "v1.1",     ref: "", desc: "v1 ships article-level auto-corpus-query at chat open. Auto-generated key-claim observations, domain tags, and corpus-contradiction prompts deferred to v1.1." },
      ]},
      { label: "Retrieval quality", features: [
        { status: "queued",  title: "§8.4a.1 Contextual retrieval",     badge: "Queued",   ref: "Phase 3 entry", desc: "Per-chunk LLM context summaries + hybrid BM25/dense search + reranker. Up to 67% retrieval error reduction. Improves quality of corpus-against-article queries in the Research Session." },
        { status: "queued",  title: "§8.4a.2 Recursive chunking",       badge: "Queued",   ref: "Phase 3 entry", desc: "Heading-aware 512-token splits better suited to policy/doctrine corpus. Naturally lands alongside §8.4a.1 during a reindex cycle to amortize re-embedding cost." },
      ]},
    ],
  },
  {
    num: "UC2", color: "3B6D11", name: "Query",
    job: "Ask questions of everything you know — corpus and your own prior framings.",
    device: "Desktop", pct: 85,
    next: {
      title: "Queue §8.4a.1 + §8.4a.2 for the next reindex cycle",
      why: "The query pipeline + Research Session pattern are fully operational across the result panel. The next meaningful improvement is retrieval quality — contextual retrieval + recursive chunking. These are Phase 3 entry points that land together to amortize re-embedding cost. No UI work needed; backend build triggered by the next reindex cycle.",
    },
    phases: [
      { label: "Query pipeline", features: [
        { status: "built",   title: "Query workflow",                    badge: "Live", ref: "Workflow 6g1FBLIe", desc: "Natural-language query → embed → Pinecone search → Notion hydrate → ranked chunks with source provenance. 5/5 smoke tests green." },
        { status: "built",   title: "Corpus Query artifact",             badge: "Live", ref: "", desc: "Query input, result cards showing retrieved chunks with SKR page ID and document title per chunk. Source provenance visible on every result." },
      ]},
      { label: "Insight capture & curation", features: [
        { status: "built",   title: "CaptureModal",                      badge: "Live", ref: "", desc: "Fires from any query result chunk. Pre-populates source doc IDs, domain chips (Policy/Economics/Technology/Cross-cutting), claim type (observation/hypothesis/synthesis/framing-shift), confidence. Calls capture_insight via SpaceSC MCP." },
        { status: "built",   title: "Insight Curation artifact",         badge: "Live", ref: "§8.4a.9", desc: "Pending approval queue with approve/reject (double-click confirm). Slide animation on action. Archive tab with RRF relevance scoring and domain filter. AI drafts; you approve." },
      ]},
      { label: "Research Session (UC2 surface)", features: [
        { status: "built",   title: "Corpus Query v2 chat extension",    badge: "Live", ref: "§8.4a.18", desc: "CurationChat panel added to the result panel. Just-retrieved ranked chunks pre-loaded into chat context. Same four capture affordances (link source · research note · open question · insight). Extends the existing query surface rather than replacing it." },
        { status: "built",   title: "Worker /api/chat route",            badge: "Live", ref: "§8.4a.17 W3", desc: "Proxies to Anthropic Claude with context-injected system prompt. Worker secret ANTHROPIC_API_KEY. 35s timeout via native AbortController (same pattern as /api/openai-classify). Shared infrastructure across UC1–UC4 surfaces — built once, consumed four times." },
      ]},
      { label: "Analytical posture", features: [
        { status: "built",   title: "Strategic Posture artifact",        badge: "Live", ref: "", desc: "KPIs: approved insight count, pending, SKR doc count, hypothesis count. Three-domain balance chart. Insight velocity over time. Open hypothesis tracker. Time window: 30d / 90d / 1y / all." },
      ]},
      { label: "Quality upgrades", features: [
        { status: "queued",  title: "§8.4a.1 Contextual retrieval",      badge: "Queued", ref: "Phase 3 entry", desc: "Per-chunk LLM summaries + hybrid BM25/dense + reranker. Up to 67% retrieval error reduction. Coupled to §8.4a.2 to amortize re-embedding." },
        { status: "queued",  title: "§8.4a.2 Recursive chunking",        badge: "Queued", ref: "Phase 3 entry", desc: "A/B test against current chunker. Heading-aware splits for policy/doctrine corpus. Lands with §8.4a.1 during reindex cycle." },
      ]},
      { label: "Phase 3 analytics", features: [
        { status: "future",  title: "Cross-domain causal tracing",       badge: "Future", ref: "The centerpiece", desc: "When topic X in domain A shifts, do related topics in B and C shift too, and in what order? Serves the welfare-theorem framework applied to policy × economics × technology. Requires snapshot/versioning machinery (§9.7 SCD Type 2 pattern)." },
        { status: "future",  title: "Within-domain topic drift",         badge: "Future", ref: "Phase 3", desc: "How has discourse on X shifted from 2020 to 2026? Cluster vectors by topic across time-stamped snapshots, surface anomalies. Requires the versioning substrate first." },
      ]},
    ],
  },
  {
    num: "UC3", color: "854F0B", name: "Commute Mode",
    job: "Stay current, capture thoughts hands-free, and learn fundamentals during downtime.",
    device: "iPhone", pct: 90,
    next: {
      title: "Execute §8.4a.21 W9 dogfood — final pause-for-Campbell",
      why: "W7 (voice-feedback NLU + revision dispatch) + W7.1 (flag_claim three-tier resolution) + W8 (full-module TTS + library + spaced-rep + search_modules MCP) + W8.1 (CF Queue auto-fire-on-approve) all LANDED 2026-05-18. The pipeline is functionally complete on the Worker side: capture → S1-S8 → review brief → voice feedback → approve → full module TTS auto-fires → audio plays. W9 dogfood is the final pause: capture a real Learning Gap, run S0→S12 E2E, listen + react via voice feedback, iPhone Commute Player render-check.",
    },
    phases: [
      { label: "iPhone capture infrastructure", features: [
        { status: "built",   title: "§8.4a.10 Opus iPhone Capture Loop", badge: "Live", ref: "LANDED 2026-05-05", desc: "Custom MCP server on Cloudflare Workers (spacesc-mcp) + Mac FastAPI il_server.py via Tailscale Funnel. Four tools: query_corpus, capture_insight, search_insights, approve_insight. Anthropic Custom Connector registered on iPhone Claude app." },
        { status: "built",   title: "§8.4a.13 Opus log-append MCP",     badge: "Live", ref: "LANDED 2026-05-05", desc: "Cloudflare Worker spacesc-opus-log-mcp. Wraps §2.16.4 webhook as 1-tool MCP server (append_to_log). MCP-tool-as-auth-bridge pattern. Lets Opus on claude.ai web + iPhone append to PROJECT_LOG durably regardless of page size." },
        { status: "built",   title: "il dictate CLI",                    badge: "Desktop", ref: "§8.4a.9", desc: "Desktop voice capture for the Insight Ledger via transcript. Same capture flow as commute mode — provides redundancy when the iPhone path is unavailable." },
      ]},
      { label: "Commute Player (listen + hands-free capture)", features: [
        { status: "built",   title: "§8.4a.19 Commute Player",            badge: "Live", ref: "/uc3", desc: "Phone-bookmarkable. Article playback via ElevenLabs TTS. R2 audio cache. Served by spacesc-mcp Worker at /uc3 (cache-control 5 min; bust with ?v=N). Auth via hardcoded bearer in commute-api.js (single-user posture)." },
        { status: "built",   title: "CurationChat — 5 affordances",       badge: "Live", ref: "§8.4a.19", desc: "Hands-free capture during playback: capture-insight · capture-research-note · capture-open-question · capture-learning-gap · flag-claim. Voice command path layered on the same /api/chat route used by UC1–UC4." },
        { status: "built",   title: "Recent ingest playback",             badge: "Live", ref: "§8.4a.19", desc: "Pulls from Newsletter Parking Lot (Status=Listened) and recent SKR ingests. Article body → TTS via /api/uc3/* routes. Cached in R2 to amortize ElevenLabs cost across replays." },
      ]},
      { label: "Fundamentals Learning Modules · §8.4a.21", features: [
        { status: "built",   title: "W0–W6 · Pipeline S0–S8",             badge: "Live", ref: "2026-05-16 → 05-18", desc: "Cloudflare Workflow uc3-fundamentals-pipeline. D1 db uc3_fundamentals + 7 tables. CF Queue uc3-s5-section-drafting + DLQ. R2 transcripts at transcripts/module-{id}.txt. Stages: S0 init → S1 topic decomp → S2 source discovery → S2.5 analog ranking → S3 corpus retrieval → S4 outline → S5a/b drafting+polish → S6 batched verify → S7 LLM-as-judge → revision loop (cap 2) → S8 review brief + ElevenLabs TTS. 5 modules per gap, ~28 min E2E wall." },
        { status: "built",   title: "W7 · S9 + S10 voice feedback NLU + revision dispatch", badge: "Live", ref: "LANDED 2026-05-18", desc: "POST /api/uc3/module-feedback accepts a transcript; Sonnet 4.6 parses into structured actions (approve, revise_module, regenerate_brief, flag_claim, change_voice, defer); dispatcher routes each action sequentially with per-action try/catch + HTTP 207 multi-status. Dry-run on module 82: transcript with 3 issues → flag_claim + revise_module + approve → revise succeeded, approve succeeded, 119s total. D1 migration 0004 + module_feedback table; libs feedback-parser.ts + feedback-dispatch.ts." },
        { status: "built",   title: "W7.1 · flag_claim three-tier resolution", badge: "Live", ref: "LANDED 2026-05-18", desc: "Resolution order: (1) claim_id direct lookup, (2) Tier-1 verbatim transcript substring match (inserts new section_claims row on hit), (3) fuzzy_claim against existing claims with tightened ≥3 distinctive-token threshold, (4) Tier-2 fuzzy paraphrase in transcript. S9 prompt now receives POLISHED_TRANSCRIPT so it can emit verbatim quotes. Token-filter split: tighter for claim-matching, looser for transcript-matching. Catches the W7 false-positive case where SEC founding year lived in narrative not in tracked claims." },
        { status: "built",   title: "W8 · S11 full-module TTS + S12 library + search_modules MCP", badge: "Live", ref: "LANDED 2026-05-18", desc: "S11 generateModuleAudio: reads polished transcript from R2, chunks (5×2500 chars), pipes ElevenLabs, stores at R2 key modules/module-{id}.mp3. Module Errata: D1 + optional Notion mirror (env-gated). Spaced-rep: 3 rows at +3d/+1w/+3w on approve, idempotent. search_modules MCP tool registered (1.2.0): filters by query+status+gap_id, returns audio_url + brief_audio_url + flagged_claim_count + errata_count + latest_s7_verdict. D1 migration 0005; 6 new REST routes." },
        { status: "built",   title: "W8.1 · CF Queue auto-fire-on-approve (reliability fix)", badge: "Live", ref: "LANDED 2026-05-18", desc: "ctx.waitUntil from fetch handler did not reliably keep isolate alive for ~2min ElevenLabs work. W8.1 routes approve→audio through new CF queue uc3-module-tts (max_batch_size=1, max_retries=2, DLQ). Dispatcher in index.ts routes by batch.queue to N consumers. Validation: module 82 approve → audio at T+118s, fully automatic, zero manual second call. Manual /api/uc3/module-tts kept as force-regenerate path." },
        { status: "queued",  title: "W9 · Final dogfood (last pause-for-Campbell)", badge: "Queued", ref: "Closes §8.4a.21", desc: "Capture a real Learning Gap (via ml add CLI or commute-player voice), run S0→S12 end-to-end, listen + react via /api/uc3/module-feedback voice transcript, iPhone Commute Player render-check. The last gate before §8.4a.21 declares fully LANDED and the 30-day soak clock for §8.4a.22 starts." },
        { status: "partial", title: "CLI il dictate → /api/uc3/module-feedback", badge: "Pending", ref: "Mac-side skill change", desc: "Webhook contract live since W7. il dictate Mac-side skill change to POST transcripts to /api/uc3/module-feedback is still pending. Workaround: curl POST with transcript JSON directly works today." },
        { status: "partial", title: "Commute Player UI extension",       badge: "Cowork/Opus", ref: "Webhook contracts ready", desc: "New content types (module audio + review brief), series view (5 modules per gap), flag-this-claim button (POST /api/uc3/module-errata-create), spaced-rep-due surface. All Worker contracts documented; UI hand-off is Cowork or Opus task." },
        { status: "partial", title: "Module Errata Notion DB",           badge: "Campbell action", ref: "D1 works without it", desc: "Errata writes persist to D1 cleanly today. Optional Notion mirror activates when MODULE_ERRATA_DB_ID env secret is set. Campbell creates a new DB (Module Errata) with 7 properties + sets the secret via wrangler." },
      ]},
      { label: "Voice quality · §8.4a.23", features: [
        { status: "queued",  title: "§8.4a.23 Voice rotation",           badge: "Opus design", ref: "Sketched", desc: "Shared voice pool across review briefs (S8), full-module TTS (S11), and Commute Player article playback. Same voice within a single module session for coherence, varied across modules to reduce review fatigue. Integrates after W8 lands single-voice baseline." },
      ]},
      { label: "Briefing mode", features: [
        { status: "future",  title: "Daily audio briefing",              badge: "Future", ref: "Phase 3 capability", desc: "5-minute audio digest assembled from recent ingests + pending insights + open hypotheses. Plays automatically at commute start. Distinct from §8.4a.21 fundamentals modules (which are pre-generated week-series, not daily digests)." },
      ]},
    ],
  },
  {
    num: "UC4", color: "534AB7", name: "Create Product",
    job: "Draft a well-cited analytical output grounded in your corpus and prior framings.",
    device: "Desktop", pct: 50,
    next: {
      title: "Build the full assembly + live citation trail layer",
      why: "§8.4a.20 (UC4 Create Product Research Session) LANDED — drafting outline + section-being-written + source citations live in the chat panel. The next layer is full multi-section synthesis with a citation trail that survives edit cycles. Specify the product (audience / purpose / length) → outline from corpus + Insight Ledger + Tier-3 RNs → section-by-section drafting with traceable claims → export.",
    },
    phases: [
      { label: "Raw material (built)", features: [
        { status: "partial", title: "Reframe annotations",               badge: "Partial", ref: "Reading Review", desc: "Your analytical framing of each source document. Lives in the Reading Review annotation panel. Free-text today — not yet structured or indexed for product drafting feed." },
        { status: "built",   title: "Insight Ledger v1",                 badge: "Live", ref: "§8.4a.9", desc: "Approved insights with claim text, domain tags (Policy/Economics/Technology/Cross-cutting), claim type, confidence, and source doc IDs. Tier-2 building blocks a product drafter cites." },
        { status: "built",   title: "Strategic Posture",                 badge: "Live", ref: "", desc: "Domain balance and open hypothesis tracker provide orientation: where your analytical weight sits across the three domains, what threads are unresolved." },
      ]},
      { label: "Structured capture (Tier-3)", features: [
        { status: "built",   title: "§8.4a.12 → §8.4a.17 Research Note Capture", badge: "Live", ref: "Absorbed + shipped", desc: "Bundled question + reasoning + cited_sources + assessment + optional falsifiable_tests. Built into the Research Session pattern across UC1–UC4 (§8.4a.17 W1–W5). SKR source_type=research-note; Pinecone-vectorized; rn CLI; webhook /webhook/research-note-capture." },
      ]},
      { label: "Research Session (UC4 surface)", features: [
        { status: "built",   title: "§8.4a.20 UC4 Create Product Research Session", badge: "Live", ref: "LANDED", desc: "Drafting surface synthesizing T2 insights + T3 research notes into publishable Tier-4 artifacts. Chat panel pre-loaded with drafting outline + section being written + source citations. Four capture affordances. Upstream gate for §8.4a.21 fundamentals-learning pipeline." },
      ]},
      { label: "Full assembly surface", features: [
        { status: "partial", title: "Product drafting surface",          badge: "Partial", ref: "§8.4a.20 ships per-section drafting", desc: "§8.4a.20 ships the Research Session drafting surface (per-section). Full multi-section assembly — describe product → outline from corpus + Insight Ledger + Tier-3 RNs → section-by-section with citations → edit → export — is the remaining build." },
        { status: "gap",     title: "Live citation trail",               badge: "Gap", ref: "Not yet designed", desc: "Every claim in the draft tagged with its source document(s). Citation trail stays live through edit cycles. Traceable back to SKR page IDs + Tier-3 RN IDs." },
        { status: "future",  title: "Export",                            badge: "Future", ref: "", desc: "Clean Markdown, Word doc, or structured JSON for downstream tools (briefing decks, email templates, KLE preparation packages)." },
      ]},
      { label: "Phase 3 differentiation", features: [
        { status: "future",  title: "Cross-domain causal framing",       badge: "Future", ref: "Phase 3", desc: "Products become distinctive when they can say not just here's what the corpus says but here's how this topic has shifted and what the policy/economics/technology interplay looks like. Requires Phase 3 snapshot machinery." },
      ]},
    ],
  },
  {
    num: "UC5", color: "0F6E56", name: "Monitor",
    job: "Know the system is healthy and understand what each panel is telling you.",
    device: "Desktop", pct: 80,
    next: {
      title: "Trigger §8.4a.3 — Hooks-enforced logging",
      why: "Monitoring surfaces are all built. The reliability gap is that logging is currently prompt-based — Claude Code logs because it's instructed to, not because it's structurally required. A Claude Code Stop/SubagentStop hook makes logging deterministic. Trigger condition (1–2 weeks of stable operation post-Step 3 close) has been met for weeks now.",
    },
    phases: [
      { label: "Pipeline health", features: [
        { status: "built",   title: "Ingestion Health dashboard",        badge: "Live", ref: "", desc: "KPIs: total ingestions, success %, failed count, skipped, median duration, p95 duration. Timeline area chart (24h/7d/30d). Source breakdown by ingest type. Status distribution pie. Failure stage bar chart (where in the pipeline failures cluster). Recent log table with full history string and error detail per row." },
        { status: "built",   title: "Ingestion Log Notion DB",           badge: "Live", ref: "Raw source", desc: "Every ingest attempt: title, status, source, stage (which node failed), pipe-delimited history string, error detail, started/finished timestamps, link to SKR page if created. Use when the dashboard aggregates aren't granular enough." },
      ]},
      { label: "Analytical posture health", features: [
        { status: "built",   title: "Strategic Posture dashboard",       badge: "Live", ref: "", desc: "KPIs: approved insights, pending, SKR doc count, hypothesis count. Domain balance (Policy/Economics/Technology distribution). Insight velocity over time. Open hypothesis tracker (all claim_type: hypothesis insights). Time window: 30d/90d/1y/all." },
      ]},
      { label: "Coordination log", features: [
        { status: "built",   title: "PROJECT_LOG Browser",               badge: "Live", ref: "", desc: "Chronological log of all sessions across Claude Opus, Claude Code, and Cowork. Sidebar navigation by entry. Status-colored left borders. Use for decision archaeology: why was something built a certain way, what was the state at a given point." },
        { status: "built",   title: "Auto-archival",                     badge: "Live", ref: "§8.4a.6 / Workflow 8sHd4N0Y", desc: "n8n cron monitors PROJECT_LOG; archives Phase entries to dated archive page when active log exceeds threshold. Keeps the log readable without manual cleanup." },
        { status: "built",   title: "§2.16.4 Opus REST-write fallback",  badge: "Live", ref: "§8.4a.8", desc: "Workflow T64KTueP. /webhook/notion-append with append-children / append-after-block / update-block modes + atomic Latest-State-Summary refresh. The durable fix for slow update_content on large pages." },
        { status: "built",   title: "Worker /api/log-append",            badge: "Live", ref: "spacesc-mcp", desc: "Block-children API path (~700ms regardless of page size). Bypasses the slow update_content path entirely for appending log entries. Captured in memory as the canonical PROJECT_LOG append path." },
      ]},
      { label: "Corpus integrity", features: [
        { status: "built",   title: "Step 3.5 Reconciliation",           badge: "Live", ref: "LANDED 2026-05-02", desc: "Inventory SKR + Pinecone → orphan vector cleanup → orphan SKR flag → content-hash dedupe (SHA1 of first 1000 chars) → report. Packaged as spacesc-reconciliation Skill. Run on demand." },
      ]},
      { label: "Always-On Architecture · §8.11", features: [
        { status: "built",   title: "§8.11 Principle codified",          badge: "Live", ref: "OPS_PLAYBOOK", desc: "Future system builds default to cloud-side / always-on infrastructure where feasible. Mac-bound components tagged as migration candidates. Provenance: §8.4a.21 v0.3 design conversation 2026-05-16." },
        { status: "queued",  title: "§8.4a.22 Cloud migration",          badge: "Sketched", ref: "30d soak gate", desc: "Migrate Mac-bound components to cloud-native substrate (Workers + D1 + R2 + Queues): il-server SQLite → D1, rn-server SQLite → D1, bulk_loader Python skill → Worker function, reconciliation Python skill → Worker function. Trigger: §8.4a.21 LANDED + 30 days production observation. Estimated ~10–15h Code at trigger." },
        { status: "built",   title: "Repo bootstrap (§8.4a.22-pre)",     badge: "Live", ref: "LANDED 2026-05-17", desc: "Cloud-side Claude Code on web operationalized from iPhone. 5 PRs merged: .gitignore + README, CLAUDE.md orientation, ADR scaffold (§8.4a.21 → ADR-021), @claude GitHub Action, skills scaffold. Worker source / skills / standalones / configs pending separate Mac-push dispatch." },
      ]},
      { label: "Logging reliability", features: [
        { status: "queued",  title: "§8.4a.3 Hooks-enforced logging",    badge: "Triggered", ref: "Awaiting build session", desc: "Replace prompt-based log first, act second with deterministic Claude Code Stop/SubagentStop hook. Logging currently works because Claude Code is instructed to log — the hook makes it structurally impossible to skip. Low build effort; high reliability gain. Trigger condition met (>1 week stable post-Step 3)." },
      ]},
      { label: "Future monitoring", features: [
        { status: "future",  title: "Quality regression monitoring",     badge: "Future", ref: "§8.6", desc: "Periodic synthetic queries with known-good answers detect retrieval regressions over time. A flatline or drop in known-answer retrieval means something changed in the pipeline or corpus. Not yet designed." },
        { status: "future",  title: "Pipeline failure alerts",           badge: "Future", ref: "", desc: "Proactive notification when the email pipeline fails overnight. Currently requires manual review of Ingestion Health. Could be a simple n8n failure-email or webhook-to-notification. Low build effort when needed." },
      ]},
    ],
  },
];

// Status → marker text + accent color for the marker run
const STATUS = {
  built:   { label: "BUILT",   color: "3B6D11" },
  partial: { label: "PARTIAL", color: "854F0B" },
  gap:     { label: "GAP",     color: "A32D2D" },
  queued:  { label: "QUEUED",  color: "534AB7" },
  future:  { label: "FUTURE",  color: "888780" },
};

const INK = "1F1D18";
const INK_SOFT = "56544C";
const INK_MUTE = "888780";

function p(opts) { return new Paragraph(opts); }
function t(text, opts) { return new TextRun({ text, ...(opts || {}) }); }

// ---------- Document fragments ----------

const titleBlock = [
  p({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER,
      children: [t("SpaceSC Use Case Build Tree", { font: "Arial", size: 44, bold: true, color: INK })] }),
  p({ alignment: AlignmentType.CENTER, spacing: { after: 60 },
      children: [t("Editable working document · mirrors /system-map", { font: "Arial", size: 22, color: INK_SOFT, italics: true })] }),
  p({ alignment: AlignmentType.CENTER, spacing: { after: 360 },
      children: [t("Five use cases · phases · features · status. Edit freely. Status markers ", { font: "Arial", size: 20, color: INK_MUTE }),
                 t("[BUILT] [PARTIAL] [GAP] [QUEUED] [FUTURE]", { font: "Consolas", size: 20, color: INK_MUTE }),
                 t(" are find-and-replaceable.", { font: "Arial", size: 20, color: INK_MUTE })] }),
];

function statusLegendTable() {
  const rows = Object.entries(STATUS).map(([key, s]) => new TableRow({
    children: [
      new TableCell({
        width: { size: 1600, type: WidthType.DXA },
        margins: { top: 100, bottom: 100, left: 140, right: 140 },
        shading: { fill: s.color, type: ShadingType.CLEAR },
        children: [p({ alignment: AlignmentType.CENTER,
          children: [t(s.label, { font: "Arial", size: 20, bold: true, color: "FFFFFF" })] })],
      }),
      new TableCell({
        width: { size: 7760, type: WidthType.DXA },
        margins: { top: 100, bottom: 100, left: 160, right: 140 },
        children: [p({ children: [t(legendDescription(key), { font: "Arial", size: 22, color: INK })] })],
      }),
    ],
  }));
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1600, 7760],
    rows,
  });
}

function legendDescription(key) {
  switch (key) {
    case "built":   return "Live in production. Smoke-tested. End-to-end user outcome reaches.";
    case "partial": return "Working but incomplete — a v1 ship with a named v1.1 follow-on.";
    case "gap":     return "Needed, not yet built. Often blocks an end-state from being whole.";
    case "queued":  return "Spec locked. Build sequenced behind a named trigger (next reindex, soak gate, etc.).";
    case "future":  return "Deferred. Phase 3 or beyond. Captured so it isn't lost; not yet load-bearing.";
    default:        return "";
  }
}

function ucBlock(uc) {
  const blocks = [];

  // UC heading line
  blocks.push(p({ pageBreakBefore: true, spacing: { before: 240, after: 60 },
    children: [
      t(`${uc.num} — ${uc.name}`, { font: "Arial", size: 36, bold: true, color: uc.color }),
    ],
    heading: HeadingLevel.HEADING_1,
  }));

  // Meta line: device · pct
  blocks.push(p({ spacing: { after: 180 },
    children: [
      t(`${uc.device}  ·  ${uc.pct}% complete`, { font: "Arial", size: 22, color: INK_MUTE, italics: true }),
    ],
  }));

  // Job
  blocks.push(p({ spacing: { after: 240 },
    children: [
      t("Job: ", { font: "Arial", size: 24, bold: true, color: INK }),
      t(uc.job, { font: "Arial", size: 24, color: INK }),
    ],
  }));

  // Next build action callout — a single-cell shaded table acts as a callout box
  blocks.push(new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: 9360, type: WidthType.DXA },
        shading: { fill: "F1EFE8", type: ShadingType.CLEAR },
        margins: { top: 200, bottom: 200, left: 220, right: 220 },
        borders: {
          left:   { style: BorderStyle.SINGLE, size: 18, color: uc.color },
          top:    { style: BorderStyle.SINGLE, size: 4,  color: "E7E5DC" },
          right:  { style: BorderStyle.SINGLE, size: 4,  color: "E7E5DC" },
          bottom: { style: BorderStyle.SINGLE, size: 4,  color: "E7E5DC" },
        },
        children: [
          p({ spacing: { after: 80 },
            children: [t("NEXT BUILD ACTION", { font: "Arial", size: 18, bold: true, color: INK_MUTE })] }),
          p({ spacing: { after: 100 },
            children: [t(uc.next.title, { font: "Arial", size: 26, bold: true, color: INK })] }),
          p({ children: [t(uc.next.why, { font: "Arial", size: 22, color: INK_SOFT })] }),
        ],
      })],
    })],
  }));

  // Fundamental end states scaffold — Campbell fills in to define the
  // acceptance criteria for "this UC is fully supported".
  blocks.push(p({ heading: HeadingLevel.HEADING_2, spacing: { before: 360, after: 80 },
    children: [t("Fundamental end states", { font: "Arial", size: 28, bold: true, color: INK })] }));
  blocks.push(p({ spacing: { after: 160 },
    children: [t(
      "Edit each placeholder below with a user-outcome statement of the form “I can …”. These are the criteria the build is graded against to answer “does the system fully support this UC?”",
      { font: "Arial", size: 22, italics: true, color: INK_SOFT })] }));
  for (let i = 1; i <= 5; i++) {
    blocks.push(p({ numbering: { reference: "endstates", level: 0 }, spacing: { after: 80 },
      children: [
        t(`(end state ${i} — replace with a user-outcome statement)`, { font: "Arial", size: 22, italics: true, color: INK_MUTE }),
      ],
    }));
  }

  // Phases + features
  uc.phases.forEach((phase) => {
    blocks.push(p({ heading: HeadingLevel.HEADING_2, spacing: { before: 320, after: 100 },
      children: [t(phase.label, { font: "Arial", size: 28, bold: true, color: INK })] }));

    phase.features.forEach((feat) => {
      const s = STATUS[feat.status];
      // Marker + title line
      blocks.push(p({ spacing: { before: 200, after: 40 },
        children: [
          t(`[${s.label}]`, { font: "Consolas", size: 22, bold: true, color: s.color }),
          t("  ", { font: "Arial", size: 22 }),
          t(feat.title, { font: "Arial", size: 24, bold: true, color: INK }),
        ],
      }));
      // Badge + ref line
      const metaParts = [];
      if (feat.badge) metaParts.push(`Badge: ${feat.badge}`);
      if (feat.ref) metaParts.push(`Ref: ${feat.ref}`);
      if (metaParts.length > 0) {
        blocks.push(p({ spacing: { after: 60 },
          children: [t(metaParts.join("  ·  "), { font: "Arial", size: 18, italics: true, color: INK_MUTE })] }));
      }
      // Description
      blocks.push(p({ spacing: { after: 120 },
        children: [t(feat.desc, { font: "Arial", size: 22, color: INK })] }));
    });
  });

  return blocks;
}

// ---------- Build the document ----------

const children = [];
children.push(...titleBlock);
children.push(p({ heading: HeadingLevel.HEADING_2, spacing: { before: 60, after: 120 },
  children: [t("Status legend", { font: "Arial", size: 26, bold: true, color: INK })] }));
children.push(statusLegendTable());
children.push(p({ spacing: { before: 240, after: 80 },
  children: [t("How to edit this document", { font: "Arial", size: 22, bold: true, color: INK })] }));
const editTips = [
  "Change a feature's status by replacing the [BUILT]/[PARTIAL]/[GAP]/[QUEUED]/[FUTURE] marker on its title line. Use find-and-replace if you change the status name itself.",
  "Move features between phases by cut-and-paste — each feature is three paragraphs: marker+title, meta line, description.",
  "Update the NEXT BUILD ACTION callout near the top of each UC to redirect what's most urgent. The callout box has the UC color on its left edge.",
  "Add a new UC by copying any UC heading block — H1 title, meta line, Job line, NEXT BUILD ACTION callout, then phases.",
  "Add a new phase by copying any phase H2 + its features. Add a new feature by copying any feature's three-paragraph block.",
];
editTips.forEach(tip => {
  children.push(p({ numbering: { reference: "tips", level: 0 }, spacing: { after: 80 },
    children: [t(tip, { font: "Arial", size: 22, color: INK_SOFT })] }));
});

UCS.forEach(uc => {
  ucBlock(uc).forEach(b => children.push(b));
});

const doc = new Document({
  creator: "SpaceSC Build Tree Generator",
  title: "SpaceSC Use Case Build Tree",
  description: "Editable working document mirroring /system-map",
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
      { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 44, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 } },
    ],
  },
  numbering: {
    config: [
      { reference: "tips",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "endstates",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children,
  }],
});

const OUT = "/Users/campbellkane/code/spacesc-mcp/.claude/worktrees/happy-mestorf-3798db/docs/use-case-tree.docx";
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log("Wrote", OUT, buf.length, "bytes");
});
