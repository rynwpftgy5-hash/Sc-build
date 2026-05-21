import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
// @ts-expect-error — Wrangler Text rule (wrangler.jsonc)
import COMMUTE_PLAYER_HTML from "./assets/commute-player.html";
// v5.1: SpaceSC tool surfaces co-hosted with the player so the NavMenu resolves
// @ts-expect-error — Wrangler Text rule
import DESK_HTML from "./assets/desk.html";
// 2026-05-19: classic reading workspace (was /desk in v5.1; now standalone)
// @ts-expect-error — Wrangler Text rule
import READING_HTML from "./assets/reading.html";
// Item 3 Phase 1: v3 bundle preserved as fallback until Phase 2 ports the
// CurationChat Research Session panel into the hand-coded successor.
// @ts-expect-error — Wrangler Text rule
import READING_V3_LEGACY_HTML from "./assets/reading-v3-legacy.html";
// @ts-expect-error — Wrangler Text rule
import CORPUS_HTML from "./assets/corpus.html";
// Item 3 /corpus Phase 1: v3 bundle preserved as fallback during soak.
// @ts-expect-error — Wrangler Text rule
import CORPUS_V3_LEGACY_HTML from "./assets/corpus-v3-legacy.html";
// @ts-expect-error — Wrangler Text rule
import INSIGHTS_HTML from "./assets/insights.html";
// Item 3 /insights Phase 1: v3 bundle preserved as fallback during soak.
// @ts-expect-error — Wrangler Text rule
import INSIGHTS_V3_LEGACY_HTML from "./assets/insights-v3-legacy.html";
// @ts-expect-error — Wrangler Text rule
import POSTURE_HTML from "./assets/posture.html";
// Item 3 monitoring: v3 bundle preserved as fallback during soak.
// @ts-expect-error — Wrangler Text rule
import POSTURE_V3_LEGACY_HTML from "./assets/posture-v3-legacy.html";
// @ts-expect-error — Wrangler Text rule
import PIPELINE_HTML from "./assets/pipeline.html";
// @ts-expect-error — Wrangler Text rule
import PIPELINE_V3_LEGACY_HTML from "./assets/pipeline-v3-legacy.html";
// @ts-expect-error — Wrangler Text rule
import BUILDLOG_HTML from "./assets/log.html";
// @ts-expect-error — Wrangler Text rule
import BUILDLOG_V3_LEGACY_HTML from "./assets/buildlog-v3-legacy.html";
// ADR-024: live system map (use case build tree) — canonical reference for every Claude session
// @ts-expect-error — Wrangler Text rule
import SYSTEM_MAP_HTML from "./assets/system-map.html";
// §8.4a.25b: Reports — your 🚩 captures + what the system did with each one
// @ts-expect-error — Wrangler Text rule
import FEEDBACK_HTML from "./assets/feedback.html";
// §8.4a.25 — universal feedback button asset (vanilla JS, framework-agnostic)
// @ts-expect-error — Wrangler Text rule
import FEEDBACK_BUTTON_JS from "./assets/feedback-button.js";
import {
	handleFeedbackCapture,
	handleFeedbackList,
	handleFeedbackResolve,
	handleBlindspotsList,
	handleBlindspotReanalyze,
	handleBlindspotResolve,
	handleFeedbackProposeFix,
	handleFeedbackApply,
	handleFeedbackFixStatus,
	handleFeedbackFixCallback,
	handleFeedbackFixesPending,
} from "./handlers/feedback";
import { listFeedback } from "./lib/feedback";
import { listBlindspots, resolveBlindspot } from "./lib/blindspot-analyzer";
import {
	handleUc3PipelineRun,
	handleUc3PipelineCancel,
	handleUc3PipelineStatus,
	handleUc3ModuleRevise,
	handleUc3ModuleBrief,
	handleUc3BriefAudio,
	handleUc3ModuleFeedback,
	handleUc3ModuleApprove,
	handleUc3ModuleTts,
	handleUc3ModuleAudio,
	handleUc3ModuleErrataCreate,
	handleUc3ModuleErrataList,
	handleUc3SpacedRepDue,
	handleUc3SpacedRepMarkListened,
	handleUc3ListGaps,
	handleUc3ListBriefsReady,
	handleUc3CapturesToday,
	handleUc3TodayBriefing,
	handleUc3DailyBriefingGenerate,
	handleUc3BriefingAudio,
} from "./handlers/uc3";
import { handleS5Queue } from "./queue/s5-consumer";
import { handleModuleTtsQueue } from "./queue/module-tts-consumer";
import type { S5DraftMessage, ModuleTtsMessage } from "./lib/queues";
import { generateDailyBriefing } from "./lib/daily-briefing";
import { getOrCreateMirrorDbId } from "./lib/notion-mirror";

export { Uc3FundamentalsPipeline } from "./workflows/uc3-pipeline";

declare global {
	interface Env {
		WEBHOOK_SECRET: string;
		IL_SERVER_TOKEN: string;
		N8N_BASE_URL: string;
		IL_SERVER_FUNNEL_URL: string;
		MCP_CLIENT_TOKEN: string;
		NOTION_TOKEN: string;
		OPENAI_API_KEY: string;
		ANTHROPIC_API_KEY: string;
		ELEVENLABS_API_KEY: string;
		ELEVENLABS_DEFAULT_VOICE_ID?: string;
		TTS_CACHE: R2Bucket;
		// §8.4a.21 W4 additions
		UC3_DB: D1Database;
		UC3_PIPELINE: Workflow;
		BRAVE_SEARCH_API_KEY: string;
		// §8.4a.21 W5 additions
		S5_DRAFT_QUEUE: Queue<S5DraftMessage>;
		// §8.4a.21 W8 additions
		// Optional secret — when set, /api/uc3/module-errata-create mirrors to Notion.
		// When unset, errata writes succeed in D1 and skip Notion silently.
		MODULE_ERRATA_DB_ID?: string;
		// Item 1 — Cross-source captures-today completeness.
		// Optional env overrides. The Worker self-bootstraps these DBs under
		// PROJECT_LOG on first capture (see worker/src/lib/notion-mirror.ts),
		// stores the IDs in the D1 runtime_config table, and reads from
		// there on subsequent writes + captures-today reads. Setting one of
		// these env vars manually forces the Worker to use that ID instead
		// (useful if Campbell wants the DBs in a specific Notion workspace
		// location). Schema is defined in lib/notion-mirror.ts MIRROR_SCHEMA.
		INSIGHT_MIRROR_DB_ID?: string;
		RESEARCH_NOTE_MIRROR_DB_ID?: string;
		// §8.4a.21 W8.1 additions — Module TTS queue (replaces ctx.waitUntil for
		// the slow generateModuleAudio path; each message gets its own fresh
		// Worker invocation with full subrequest + wall-time budget).
		MODULE_TTS_QUEUE: Queue<ModuleTtsMessage>;
		// §8.4a.25c — Worker GitHub auth for reliable Cloudflare-cron drain.
		GITHUB_TOKEN?: string;
		GITHUB_OWNER?: string;
		GITHUB_REPO?: string;
		// §8.4a.25 — optional Notion mirror for ui_feedback (best-effort).
		FEEDBACK_DB_ID?: string;
	}
}

const INGESTION_LOG_DB_ID = "d7494f8b-3768-4ea0-b314-dbaf1a162f93";
const READING_PARKING_LOT_DB_ID = "f3a2418b-6c9a-4ac3-92ad-3df613bf5772";
const PROJECT_LOG_PAGE_ID = "34548344-93df-81ed-972f-c524406eeb04";

const ALLOWED_PARKING_LOT_PROPS = new Set([
	"Status",
	"Priority",
	"Domain",
	"Topics",
	"Notes",
	"Reframe",
	"Source Reliability",
]);

const PARKING_LOT_DEFAULT_PENDING_STATUSES = [
	"New",
	"Retrieve Tomorrow",
	"Retrieved",
];

const ALLOWED_DOMAINS = [
	"Policy",
	"Economics",
	"Technology",
	"Cross-cutting",
] as const;
const ALLOWED_TYPES = [
	"observation",
	"hypothesis",
	"synthesis",
	"framing-shift",
] as const;
const ALLOWED_CONFIDENCE = ["low", "medium", "high"] as const;

// ---------- HTTP helpers ----------

async function postJson(
	url: string,
	bearer: string,
	body: unknown,
	timeoutMs = 15_000,
) {
	const resp = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${bearer}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(timeoutMs),
	});
	const text = await resp.text();
	return { status: resp.status, text };
}

async function getJson(url: string, bearer: string, timeoutMs = 8_000) {
	const resp = await fetch(url, {
		headers: { Authorization: `Bearer ${bearer}` },
		signal: AbortSignal.timeout(timeoutMs),
	});
	const text = await resp.text();
	return { status: resp.status, text };
}

const MAC_OFFLINE_RESULT = {
	ok: false,
	error: "mac_offline",
	message:
		"Insight ledger requires Campbell's Mac to be online (it holds the SQLite source of truth). Either ask again from desk, wait for Mac to come back, or — for approve specifically — Campbell can run `il approve <id>` at the desk CLI.",
};

// ---------- Pure handlers (shared by MCP + /api routes) ----------

interface QueryCorpusInput {
	query: string;
	limit?: number;
}

async function handleQueryCorpus(input: QueryCorpusInput, env: Env) {
	try {
		const r = await postJson(
			`${env.N8N_BASE_URL}/webhook/query`,
			env.WEBHOOK_SECRET,
			{ query: input.query, limit: input.limit ?? 5 },
			20_000,
		);
		const text = r.text;
		if (r.status >= 400) {
			return { ok: false, status: r.status, error: text.slice(0, 500) };
		}
		try {
			const parsed = JSON.parse(text);
			return parsed; // already shaped { ok, query, top_k, chunks_returned, chunks: [...] }
		} catch {
			return { ok: false, error: "non-JSON response from query webhook", raw: text.slice(0, 500) };
		}
	} catch (err) {
		return {
			ok: false,
			error: `query_corpus upstream error: ${(err as Error).message}`,
		};
	}
}

interface CaptureInsightInput {
	claim: string;
	claim_type?: (typeof ALLOWED_TYPES)[number];
	domain_primary: (typeof ALLOWED_DOMAINS)[number];
	domain_secondary?: (typeof ALLOWED_DOMAINS)[number] | null;
	confidence?: (typeof ALLOWED_CONFIDENCE)[number];
	source_doc_ids?: string[];
	query_context?: string | null;
}

// Item 1B — best-effort Notion mirror writes. Pattern mirrors module-errata.ts
// and gap-capture: env-gated, never fails the canonical request, returns the
// created notion_page_id on success. Used by handleCaptureInsight and
// handleRnCapture so /api/uc3/captures-today can include both types.

function notionTitleProp(content: string): { title: Array<{ type: "text"; text: { content: string } }> } {
	const safe = (content || "(empty)").trim().slice(0, 200);
	return { title: [{ type: "text", text: { content: safe } }] };
}
function notionRichTextProp(content: string | null | undefined): { rich_text: Array<{ type: "text"; text: { content: string } }> } {
	const s = (content == null ? "" : String(content)).trim();
	if (!s) return { rich_text: [] };
	const chunks: Array<{ type: "text"; text: { content: string } }> = [];
	for (let i = 0; i < s.length; i += 2000) {
		chunks.push({ type: "text", text: { content: s.slice(i, i + 2000) } });
	}
	return { rich_text: chunks };
}
function notionSelectProp(name: string | null | undefined): { select: { name: string } | null } {
	const n = (name || "").trim();
	if (!n) return { select: null };
	return { select: { name: n } };
}

async function writeInsightMirror(input: CaptureInsightInput, env: Env): Promise<string | null> {
	if (!env.NOTION_TOKEN) return null;
	// Self-bootstrap: lookup the mirror DB ID (env-override or D1 runtime_config),
	// or create the DB under PROJECT_LOG on first capture. Returns null if
	// NOTION_TOKEN is unset or the create call fails.
	const dbId = await getOrCreateMirrorDbId(env, "insight");
	if (!dbId) return null;
	const titleText = input.claim.replace(/\s+/g, " ").trim().slice(0, 80) + (input.claim.length > 80 ? "…" : "");
	const properties: Record<string, unknown> = {
		Title: notionTitleProp(titleText),
		Claim: notionRichTextProp(input.claim),
		"Domain Primary": notionSelectProp(input.domain_primary),
		"Domain Secondary": notionSelectProp(input.domain_secondary ?? null),
		"Claim Type": notionSelectProp(input.claim_type ?? "observation"),
		Confidence: notionSelectProp(input.confidence ?? "medium"),
		"Source Doc IDs": notionRichTextProp((input.source_doc_ids ?? []).join(", ")),
		"Query Context": notionRichTextProp(input.query_context ?? ""),
	};
	try {
		const resp = await fetch("https://api.notion.com/v1/pages", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.NOTION_TOKEN}`,
				"Notion-Version": "2022-06-28",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ parent: { database_id: dbId }, properties }),
			signal: AbortSignal.timeout(15_000),
		});
		if (!resp.ok) {
			console.warn(`insight-mirror Notion write ${resp.status}:`, (await resp.text()).slice(0, 300));
			return null;
		}
		const page = (await resp.json()) as { id: string };
		return page.id;
	} catch (err) {
		console.warn("insight-mirror Notion write threw:", (err as Error).message);
		return null;
	}
}

async function handleCaptureInsight(input: CaptureInsightInput, env: Env) {
	const macPayload = {
		claim: input.claim,
		claim_type: input.claim_type ?? "observation",
		domain_primary: input.domain_primary,
		domain_secondary: input.domain_secondary ?? null,
		confidence: input.confidence ?? "medium",
		source_doc_ids: input.source_doc_ids ?? [],
		query_context: input.query_context ?? null,
	};
	const notionPayload = {
		...macPayload,
		source: "mcp-direct",
		recorded_at: new Date().toISOString(),
	};

	const [macResult, notionResult, mirrorResult] = await Promise.allSettled([
		postJson(
			`${env.IL_SERVER_FUNNEL_URL}/capture`,
			env.IL_SERVER_TOKEN,
			macPayload,
			10_000,
		),
		postJson(
			`${env.N8N_BASE_URL}/webhook/insight-capture`,
			env.WEBHOOK_SECRET,
			notionPayload,
			20_000,
		),
		// Item 1B — direct Notion mirror so /api/uc3/captures-today can include
		// insights without depending on the n8n flow's destination DB ID.
		writeInsightMirror(input, env),
	]);
	const mirrorPageId: string | null = mirrorResult.status === "fulfilled" ? mirrorResult.value : null;

	let macLanded = false;
	let insightId: string | null = null;
	let macError: string | null = null;
	if (macResult.status === "fulfilled") {
		const { status, text } = macResult.value;
		if (status >= 200 && status < 300) {
			try {
				const parsed = JSON.parse(text);
				if (parsed.ok) {
					macLanded = true;
					insightId = parsed.insight_id;
				} else {
					macError = `mac /capture returned ok=false: ${text.slice(0, 200)}`;
				}
			} catch {
				macError = `mac /capture non-JSON response: ${text.slice(0, 200)}`;
			}
		} else {
			macError = `mac /capture HTTP ${status}: ${text.slice(0, 200)}`;
		}
	} else {
		const msg = (macResult.reason as Error).message;
		macError =
			msg.includes("timed out") || msg.includes("fetch failed")
				? "mac_offline"
				: `mac /capture network failure: ${msg}`;
	}

	let notionLanded = false;
	let ingestionLogId: string | null = null;
	let notionError: string | null = null;
	if (notionResult.status === "fulfilled") {
		const { status, text } = notionResult.value;
		if (status >= 200 && status < 300) {
			try {
				const parsed = JSON.parse(text);
				if (parsed.ok) {
					notionLanded = true;
					ingestionLogId = parsed.ingestion_log_id ?? null;
				} else {
					notionError = `notion webhook returned ok=false: ${text.slice(0, 200)}`;
				}
			} catch {
				notionError = `notion webhook non-JSON: ${text.slice(0, 200)}`;
			}
		} else {
			notionError = `notion webhook HTTP ${status}: ${text.slice(0, 200)}`;
		}
	} else {
		notionError = `notion webhook network failure: ${(notionResult.reason as Error).message}`;
	}

	const ok = macLanded || notionLanded;
	const message =
		macLanded && notionLanded
			? `Captured to SQLite (pending) and Notion audit log. Approve via approve_insight ${insightId} or il approve ${insightId} at desk.`
			: macLanded
				? `Captured to SQLite (pending) — Notion audit failed (${notionError}). Approve via approve_insight ${insightId}.`
				: notionLanded
					? `Captured to Notion audit log only — Mac SQLite write failed (${macError}). Will require 'il import' at desk to materialize for search/approve via MCP.`
					: `Capture FAILED on both stores. Mac: ${macError}. Notion: ${notionError}.`;

	return {
		ok,
		insight_id: insightId,
		ingestion_log_id: ingestionLogId,
		sqlite_landed: macLanded,
		notion_landed: notionLanded,
		mac_error: macError,
		notion_error: notionError,
		mirror_page_id: mirrorPageId,
		message,
	};
}

interface SearchInsightsInput {
	query: string;
	include_pending?: boolean;
	domain?: (typeof ALLOWED_DOMAINS)[number];
	limit?: number;
}

async function handleSearchInsights(input: SearchInsightsInput, env: Env) {
	// il-server /search rejects limit > 50 with HTTP 422 (matches the MCP
	// search_insights zod max). Clamp here so /api/search HTTP callers
	// can't trip the validation path and surface it as a 502 wrapper.
	const limit = Math.max(1, Math.min(50, input.limit ?? 10));
	const params = new URLSearchParams({
		q: input.query,
		include_pending: String(input.include_pending ?? false),
		limit: String(limit),
	});
	if (input.domain) params.set("domain", input.domain);
	try {
		const r = await getJson(
			`${env.IL_SERVER_FUNNEL_URL}/search?${params.toString()}`,
			env.IL_SERVER_TOKEN,
			10_000,
		);
		if (r.status >= 400) {
			return { ok: false, status: r.status, error: r.text.slice(0, 500) };
		}
		try {
			return JSON.parse(r.text);
		} catch {
			return { ok: false, error: "non-JSON from il-server /search", raw: r.text.slice(0, 500) };
		}
	} catch (err) {
		const msg = (err as Error).message;
		if (msg.includes("timed out") || msg.includes("fetch failed")) {
			return MAC_OFFLINE_RESULT;
		}
		return { ok: false, error: `search_insights upstream error: ${msg}` };
	}
}

interface IngestLogInput {
	days?: number;
	limit?: number;
}

function richText(prop: any): string {
	const arr = (prop?.rich_text || prop?.title || []) as Array<{ plain_text?: string }>;
	return arr.map((t) => t.plain_text || "").join("");
}

function selectName(prop: any): string {
	return prop?.select?.name || "";
}

function dateStart(prop: any): string {
	return prop?.date?.start || "";
}

function multiSelectNames(prop: any): string[] {
	return ((prop?.multi_select || []) as Array<{ name?: string }>)
		.map((o) => o.name || "")
		.filter(Boolean);
}

function urlValue(prop: any): string {
	return prop?.url || "";
}

function normalizeId(id: string): string {
	return id.replace(/-/g, "").toLowerCase();
}

async function handleIngestLog(input: IngestLogInput, env: Env) {
	const days = Math.max(1, Math.min(365, input.days ?? 30));
	const limit = Math.max(1, Math.min(500, input.limit ?? 200));
	const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();

	try {
		const resp = await fetch(
			`https://api.notion.com/v1/databases/${INGESTION_LOG_DB_ID}/query`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${env.NOTION_TOKEN}`,
					"Notion-Version": "2022-06-28",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					page_size: limit,
					sorts: [{ timestamp: "created_time", direction: "descending" }],
					filter: {
						timestamp: "created_time",
						created_time: { on_or_after: cutoff },
					},
				}),
				signal: AbortSignal.timeout(20_000),
			},
		);

		if (!resp.ok) {
			const text = await resp.text();
			return {
				ok: false,
				status: resp.status,
				error: `Notion query ${resp.status}: ${text.slice(0, 300)}`,
			};
		}

		const body = (await resp.json()) as { results: any[] };
		const rows = (body.results || []).map((p) => {
			const props = p.properties || {};
			return {
				t: p.created_time,
				title: richText(props.Title),
				status: selectName(props.Status),
				source: selectName(props.Source),
				stage: selectName(props.Stage),
				hist: richText(props["Stage History"]),
				err: richText(props["Error Message"]),
				doc: richText(props.doc_id),
				started: dateStart(props["Started At"]),
				finished: dateStart(props["Finished At"]),
				url: p.url || "",
			};
		});
		return {
			ok: true,
			days,
			limit,
			fetched_at: new Date().toISOString(),
			rows_returned: rows.length,
			rows,
		};
	} catch (err) {
		return {
			ok: false,
			error: `ingest_log upstream error: ${(err as Error).message}`,
		};
	}
}

interface ApproveInsightInput {
	insight_id: string;
	action: "approve" | "reject";
	notes?: string | null;
}

async function handleApproveInsight(input: ApproveInsightInput, env: Env) {
	try {
		const r = await postJson(
			`${env.IL_SERVER_FUNNEL_URL}/approve`,
			env.IL_SERVER_TOKEN,
			{
				insight_id: input.insight_id,
				action: input.action,
				notes: input.notes ?? null,
			},
			10_000,
		);
		if (r.status >= 400) {
			return { ok: false, status: r.status, error: r.text.slice(0, 500) };
		}
		try {
			return JSON.parse(r.text);
		} catch {
			return { ok: false, error: "non-JSON from il-server /approve", raw: r.text.slice(0, 500) };
		}
	} catch (err) {
		const msg = (err as Error).message;
		if (msg.includes("timed out") || msg.includes("fetch failed")) {
			return MAC_OFFLINE_RESULT;
		}
		return { ok: false, error: `approve_insight upstream error: ${msg}` };
	}
}

// ---------- Reading Parking Lot handlers (§8.4a.14 Item 6) ----------

interface ArticleInput {
	page_id: string;
}

function shapeParkingLotRow(page: any, opts: { includeFullText?: boolean } = { includeFullText: true }) {
	const props = page.properties || {};
	const base = {
		page_id: page.id,
		url: page.url || "",
		created_time: page.created_time,
		last_edited_time: page.last_edited_time,
		title: richText(props.Title),
		article_url: urlValue(props["Article URL"]),
		blurb: richText(props.Blurb),
		source_newsletter: selectName(props["Source Newsletter"]),
		source_email: richText(props["Source Email"]),
		email_received: dateStart(props["Email Received"]),
		retrieved_at: dateStart(props["Retrieved At"]),
		status: selectName(props.Status),
		priority: selectName(props.Priority),
		domain: multiSelectNames(props.Domain),
		topics: multiSelectNames(props.Topics),
		notes: richText(props.Notes),
		reframe: richText(props.Reframe),
		source_reliability: selectName(props["Source Reliability"]),
		doc_id: richText(props["Doc ID"]),
	};
	if (opts.includeFullText) {
		return { ok: true as const, ...base, full_text: richText(props["Full Text"]) };
	}
	return { ok: true as const, ...base };
}

async function fetchParkingLotPage(pageId: string, env: Env) {
	const resp = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
		headers: {
			Authorization: `Bearer ${env.NOTION_TOKEN}`,
			"Notion-Version": "2022-06-28",
		},
		signal: AbortSignal.timeout(15_000),
	});
	if (resp.status === 404) {
		return { ok: false as const, status: 404, error: "page not found" };
	}
	if (!resp.ok) {
		const text = await resp.text();
		return {
			ok: false as const,
			status: resp.status,
			error: `Notion ${resp.status}: ${text.slice(0, 300)}`,
		};
	}
	const page = (await resp.json()) as any;
	const parentDbId = normalizeId(page.parent?.database_id || "");
	if (parentDbId !== normalizeId(READING_PARKING_LOT_DB_ID)) {
		return {
			ok: false as const,
			status: 400,
			error: `page_id is not a Reading Parking Lot row (parent=${parentDbId || "none"})`,
		};
	}
	return { ok: true as const, page };
}

async function handleArticle(input: ArticleInput, env: Env) {
	if (!input.page_id || typeof input.page_id !== "string") {
		return { ok: false, error: "field 'page_id' required" };
	}
	try {
		const r = await fetchParkingLotPage(input.page_id, env);
		if (!r.ok) return r;
		return shapeParkingLotRow(r.page);
	} catch (err) {
		return { ok: false, error: `article upstream error: ${(err as Error).message}` };
	}
}

interface ParkingLotUpdateInput {
	page_id: string;
	properties: Record<string, unknown>;
}

function buildNotionPropertyPayload(
	properties: Record<string, unknown>,
):
	| { ok: true; payload: Record<string, any> }
	| { ok: false; status: number; error: string } {
	const payload: Record<string, any> = {};
	for (const [name, value] of Object.entries(properties)) {
		if (!ALLOWED_PARKING_LOT_PROPS.has(name)) {
			return {
				ok: false,
				status: 400,
				error: `property '${name}' not allowed; must be one of: ${[
					...ALLOWED_PARKING_LOT_PROPS,
				].join(", ")}`,
			};
		}
		if (value === null || value === undefined) continue;

		if (
			name === "Status" ||
			name === "Priority" ||
			name === "Source Reliability"
		) {
			if (typeof value !== "string") {
				return { ok: false, status: 400, error: `'${name}' must be a string` };
			}
			payload[name] = value === "" ? { select: null } : { select: { name: value } };
		} else if (name === "Domain" || name === "Topics") {
			if (!Array.isArray(value)) {
				return {
					ok: false,
					status: 400,
					error: `'${name}' must be an array of strings`,
				};
			}
			payload[name] = {
				multi_select: value
					.filter((v) => v !== null && v !== undefined && v !== "")
					.map((v) => ({ name: String(v) })),
			};
		} else if (name === "Notes" || name === "Reframe") {
			const text = typeof value === "string" ? value : String(value);
			const chunks: any[] = [];
			if (text.length === 0) {
				payload[name] = { rich_text: [] };
			} else {
				for (let i = 0; i < text.length; i += 2000) {
					chunks.push({
						type: "text",
						text: { content: text.slice(i, i + 2000) },
					});
				}
				payload[name] = { rich_text: chunks };
			}
		}
	}
	return { ok: true, payload };
}

async function handleParkingLotUpdate(
	input: ParkingLotUpdateInput,
	env: Env,
) {
	if (!input.page_id || typeof input.page_id !== "string") {
		return { ok: false, error: "field 'page_id' required" };
	}
	if (!input.properties || typeof input.properties !== "object" || Array.isArray(input.properties)) {
		return { ok: false, error: "field 'properties' must be a JSON object" };
	}

	try {
		const guard = await fetchParkingLotPage(input.page_id, env);
		if (!guard.ok) return guard;

		const built = buildNotionPropertyPayload(input.properties);
		if (!built.ok) return built;
		if (Object.keys(built.payload).length === 0) {
			return { ok: false, error: "no valid property updates in request" };
		}

		// §8.4a.21 W2: auto-stamp Listened At when Status flips to Listened.
		// Player calls markListened() with Status=Listened only; we enrich here
		// so engagement-biased corpus retrieval at S3 can rank by recency.
		if (built.payload["Status"]?.select?.name === "Listened") {
			built.payload["Listened At"] = { date: { start: new Date().toISOString() } };
		}

		const patchResp = await fetch(
			`https://api.notion.com/v1/pages/${input.page_id}`,
			{
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${env.NOTION_TOKEN}`,
					"Notion-Version": "2022-06-28",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ properties: built.payload }),
				signal: AbortSignal.timeout(15_000),
			},
		);
		if (!patchResp.ok) {
			const text = await patchResp.text();
			return {
				ok: false,
				status: patchResp.status,
				error: `Notion PATCH ${patchResp.status}: ${text.slice(0, 500)}`,
			};
		}
		const updated = (await patchResp.json()) as any;
		return shapeParkingLotRow(updated);
	} catch (err) {
		return {
			ok: false,
			error: `parking_lot_update upstream error: ${(err as Error).message}`,
		};
	}
}

// ---------- Reading Parking Lot list handler (§8.4a.15 Item 7) ----------

interface ParkingLotListInput {
	status_filter?: string[];
	priority_filter?: string[];
	source_newsletter_filter?: string[];
	domain_filter?: string[];
	limit?: number;
	sort?: "email_received_desc" | "priority_then_email";
}

const PRIORITY_RANK: Record<string, number> = {
	High: 0,
	Medium: 1,
	Low: 2,
	"": 3,
};

function buildParkingLotFilter(input: ParkingLotListInput): any | null {
	const groups: any[] = [];

	const statuses =
		input.status_filter === undefined || input.status_filter === null
			? PARKING_LOT_DEFAULT_PENDING_STATUSES
			: input.status_filter;
	if (statuses.length > 0) {
		groups.push({
			or: statuses.map((v) => ({
				property: "Status",
				select: { equals: v },
			})),
		});
	}

	if (input.priority_filter && input.priority_filter.length > 0) {
		groups.push({
			or: input.priority_filter.map((v) => ({
				property: "Priority",
				select: { equals: v },
			})),
		});
	}

	if (input.source_newsletter_filter && input.source_newsletter_filter.length > 0) {
		groups.push({
			or: input.source_newsletter_filter.map((v) => ({
				property: "Source Newsletter",
				select: { equals: v },
			})),
		});
	}

	if (input.domain_filter && input.domain_filter.length > 0) {
		groups.push({
			or: input.domain_filter.map((v) => ({
				property: "Domain",
				multi_select: { contains: v },
			})),
		});
	}

	if (groups.length === 0) return null;
	if (groups.length === 1) return groups[0];
	return { and: groups };
}

async function handleParkingLotList(input: ParkingLotListInput, env: Env) {
	const limit = Math.max(1, Math.min(200, input.limit ?? 50));
	const sort = input.sort ?? "email_received_desc";

	const filter = buildParkingLotFilter(input);
	const queryBody: Record<string, any> = {
		page_size: limit,
		sorts: [{ property: "Email Received", direction: "descending" }],
	};
	if (filter) queryBody.filter = filter;

	try {
		const resp = await fetch(
			`https://api.notion.com/v1/databases/${READING_PARKING_LOT_DB_ID}/query`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${env.NOTION_TOKEN}`,
					"Notion-Version": "2022-06-28",
					"Content-Type": "application/json",
				},
				body: JSON.stringify(queryBody),
				signal: AbortSignal.timeout(20_000),
			},
		);
		if (!resp.ok) {
			const text = await resp.text();
			return {
				ok: false,
				status: resp.status,
				error: `Notion query ${resp.status}: ${text.slice(0, 300)}`,
			};
		}
		const body = (await resp.json()) as { results: any[]; has_more?: boolean };
		const rows = (body.results || []).map((p) =>
			shapeParkingLotRow(p, { includeFullText: false }),
		);

		if (sort === "priority_then_email") {
			rows.sort((a, b) => {
				const pa = PRIORITY_RANK[a.priority] ?? 3;
				const pb = PRIORITY_RANK[b.priority] ?? 3;
				if (pa !== pb) return pa - pb;
				const ea = a.email_received || "";
				const eb = b.email_received || "";
				return eb.localeCompare(ea);
			});
		}

		return {
			ok: true,
			rows,
			total_returned: rows.length,
			limit,
			has_more: !!body.has_more,
			fetched_at: new Date().toISOString(),
			filter_applied: {
				status_filter:
					input.status_filter === undefined || input.status_filter === null
						? PARKING_LOT_DEFAULT_PENDING_STATUSES
						: input.status_filter,
				priority_filter: input.priority_filter ?? null,
				source_newsletter_filter: input.source_newsletter_filter ?? null,
				domain_filter: input.domain_filter ?? null,
				sort,
			},
		};
	} catch (err) {
		return {
			ok: false,
			error: `parking_lot_list upstream error: ${(err as Error).message}`,
		};
	}
}

// ---------- OpenAI classify proxy (§8.4a.16-NewsletterParking-PlanC-A) ----------
// Moved from n8n LLM Shape Detect — n8n's task-runner sandbox suspends
// in-sandbox timers (setTimeout, httpRequest timeout) during host-bridge
// calls AND doesn't expose AbortController, so no in-sandbox approach
// could enforce a timeout reliably. Worker has native fetch + AbortController
// that interrupt the request at the socket level. n8n becomes a thin proxy.

const OPENAI_CLASSIFY_TIMEOUT_MS = 35_000;

const SPACENEWS_CLASSIFY_SYSTEM_PROMPT = `You extract articles from a SpaceNews newsletter email for Campbell's parking-lot triage system. Campbell works space security cooperation policy.

Detect the email shape:
- notification: pure announcement of a new resource (e.g., 'May 2026 magazine is available'), almost no body. Return shape='notification' and articles=[].
- digest: many short blurbs (FIRST UP / Editor's Choice). Each has headline + 1-3 sentence blurb + link. SpaceNews FIRST UP digests typically have 10-14 articles per issue.
- bulletin: fewer items (3-8), longer per-item (GEOINT Symposium / Military Space / China Report).

**Be exhaustive.** A pre-detection pass identified candidate spacenews.com article URLs; you'll see them in the user message. Account for each: extract metadata if it's a real article, OR explicitly indicate why you're skipping (section header, event listing, magazine archive, etc.). Aim for completeness on digests.

For each article, extract:
- headline: the article title, clean, max 80 chars.
- blurb: the article excerpt VERBATIM from the email (1-3 sentences). Do NOT summarize; copy the original text. Cap at 1500 chars.
- article_url: link to spacenews.com article (NOT bluelena.io trackers, NOT social, NOT magazine archive). Must be https://spacenews.com/<path>/.
- topic_guesses: array of 2-4 tags. Prefer from: Lunar Exploration, GEOINT, Commercial Space, Space Policy, Military Space, NGA, Artemis, Launch, Satellites. May add new topics.
- domain_primary_guess: one of Policy / Economics / Technology / Cross-cutting.
- domain_secondary_guess: one of those four OR null.
- source_newsletter_guess: one of First Up / Military Space / China Report / Editor's Choice / SpaceNews This Week / Opinions / Other.
- priority_guess: High (major policy/strategic shift) / Medium (default) / Low (routine launch / earnings / scheduling).

Filter out trackers, social media, magazine archive, advertise/contact-us, footer links, virtual-event listings, section anchors. Only return real article URLs.

Return JSON only with keys shape, newsletter_brand, articles. If shape=notification, articles=[]. If shape=digest|bulletin, articles must have at least 1 entry.`;

interface OpenAIClassifyInput {
	subject?: string;
	candidate_urls?: string[];
	candidate_url_count?: number;
	body_excerpt?: string;
}

async function handleOpenAIClassify(input: OpenAIClassifyInput, env: Env) {
	if (!env.OPENAI_API_KEY) {
		return {
			ok: false,
			status: 500,
			error: "server misconfigured: OPENAI_API_KEY secret missing",
		};
	}

	const urlList = (input.candidate_urls || [])
		.map((u, i) => `[${i + 1}] ${u}`)
		.join("\n");
	const userMsg =
		`Subject: ${input.subject || ""}\n\n` +
		`Pre-detected ${input.candidate_url_count || 0} candidate spacenews.com URLs in this email:\n` +
		`${urlList}\n\n` +
		`Email body:\n${input.body_excerpt || ""}`;

	const reqBody = {
		model: "gpt-4o-mini",
		response_format: { type: "json_object" },
		max_tokens: 4000,
		temperature: 0,
		messages: [
			{ role: "system", content: SPACENEWS_CLASSIFY_SYSTEM_PROMPT },
			{ role: "user", content: userMsg },
		],
	};

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), OPENAI_CLASSIFY_TIMEOUT_MS);

	try {
		const resp = await fetch("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.OPENAI_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(reqBody),
			signal: controller.signal,
		});
		if (!resp.ok) {
			const text = await resp.text();
			return {
				ok: false,
				status: resp.status,
				error: `OpenAI ${resp.status}: ${text.slice(0, 300)}`,
			};
		}
		const llm_raw = (await resp.json()) as any;
		return { ok: true as const, llm_raw };
	} catch (err) {
		const e = err as Error;
		if (e.name === "AbortError") {
			return {
				ok: false,
				status: 504,
				error: `OpenAI call aborted after ${OPENAI_CLASSIFY_TIMEOUT_MS}ms`,
			};
		}
		return {
			ok: false,
			status: 502,
			error: `OpenAI fetch error: ${e.message}`,
		};
	} finally {
		clearTimeout(timer);
	}
}

// ---------- OpenAI parse research-note (§8.4a.17 W4) ----------
// Parses a markdown chat export into the 4-part Research Note structure.
// Used by n8n /webhook/research-note-capture for the markdown-paste path.

const OPENAI_PARSE_RN_TIMEOUT_MS = 35_000;

const PARSE_RN_SYSTEM_PROMPT = `You parse markdown chat exports into structured Research Notes for Campbell's SpaceSC knowledge corpus.

A Research Note has four required parts plus one optional:
- research_question (string): the question or topic the conversation was investigating; if not stated explicitly, infer from the first user message
- reasoning (string): the synthesis prose preserved VERBATIM from the assistant's analytical body — do NOT summarize; copy the key analytical content. Multiple paragraphs are fine.
- assessment (string): the conclusion or final position the conversation reached
- falsifiable_tests (array of strings, OPTIONAL): explicit "if X happens, that confirms/falsifies Y" predictions if any were stated
- cited_urls (array of strings): every external URL that appeared in the assistant's messages; filter out claude.ai UI links and metadata URLs

Output JSON with exactly those keys.

If the chat does not contain a coherent research_question, reasoning, AND assessment (all three required), return { "parse_error": "<short reason explaining what's missing>" } instead. Do NOT fabricate content to fill required fields.`;

interface OpenAIParseRnInput {
	chat_markdown?: string;
	parent_chat_url?: string;
}

async function handleOpenAIParseRn(input: OpenAIParseRnInput, env: Env) {
	if (!env.OPENAI_API_KEY) {
		return {
			ok: false,
			status: 500,
			error: "server misconfigured: OPENAI_API_KEY secret missing",
		};
	}
	if (!input.chat_markdown || !input.chat_markdown.trim()) {
		return { ok: false, status: 400, error: "chat_markdown is required" };
	}

	const userMsg =
		(input.parent_chat_url ? `Source chat URL: ${input.parent_chat_url}\n\n` : "") +
		`Chat markdown:\n${input.chat_markdown.slice(0, 30_000)}`;

	const reqBody = {
		model: "gpt-4o-mini",
		response_format: { type: "json_object" },
		max_tokens: 4000,
		temperature: 0,
		messages: [
			{ role: "system", content: PARSE_RN_SYSTEM_PROMPT },
			{ role: "user", content: userMsg },
		],
	};

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), OPENAI_PARSE_RN_TIMEOUT_MS);

	try {
		const resp = await fetch("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.OPENAI_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(reqBody),
			signal: controller.signal,
		});
		if (!resp.ok) {
			const text = await resp.text();
			return {
				ok: false,
				status: resp.status,
				error: `OpenAI ${resp.status}: ${text.slice(0, 300)}`,
			};
		}
		const apiJson = (await resp.json()) as any;
		const content = apiJson.choices?.[0]?.message?.content;
		if (!content) {
			return { ok: false, status: 502, error: "OpenAI returned no content" };
		}
		try {
			const parsed = JSON.parse(content);
			if (parsed.parse_error) {
				return { ok: true as const, parse_error: parsed.parse_error, parsed: null };
			}
			// Conservative validation
			const missing: string[] = [];
			if (typeof parsed.research_question !== "string" || !parsed.research_question.trim()) {
				missing.push("research_question");
			}
			if (typeof parsed.reasoning !== "string" || !parsed.reasoning.trim()) {
				missing.push("reasoning");
			}
			if (typeof parsed.assessment !== "string" || !parsed.assessment.trim()) {
				missing.push("assessment");
			}
			if (missing.length) {
				return {
					ok: true as const,
					parse_error: `parser output missing required fields: ${missing.join(", ")}`,
					parsed,
				};
			}
			return {
				ok: true as const,
				parsed: {
					research_question: parsed.research_question.trim(),
					reasoning: parsed.reasoning.trim(),
					assessment: parsed.assessment.trim(),
					falsifiable_tests: Array.isArray(parsed.falsifiable_tests)
						? parsed.falsifiable_tests.filter((t: unknown) => typeof t === "string" && t.trim())
						: [],
					cited_urls: Array.isArray(parsed.cited_urls)
						? parsed.cited_urls.filter((u: unknown) => typeof u === "string" && u.trim())
						: [],
				},
				usage: apiJson.usage,
			};
		} catch (e) {
			return { ok: false, status: 502, error: `failed to parse JSON output: ${(e as Error).message}; raw: ${content.slice(0, 300)}` };
		}
	} catch (err) {
		const e = err as Error;
		if (e.name === "AbortError") {
			return {
				ok: false,
				status: 504,
				error: `OpenAI parse-rn call aborted after ${OPENAI_PARSE_RN_TIMEOUT_MS}ms`,
			};
		}
		return {
			ok: false,
			status: 502,
			error: `OpenAI fetch error: ${e.message}`,
		};
	} finally {
		clearTimeout(timer);
	}
}

// ---------- Research Session arc routes (§8.4a.17 W3) ----------
// Four new routes added by §8.4a.17:
//   /api/chat            — Anthropic Claude proxy (Sonnet default; model toggle via body.model)
//   /api/rn-capture      — proxy to il-server /rn/capture via Tailscale Funnel
//   /api/oq-create       — direct Notion REST POST to Open Questions DB
//   /api/link-source     — direct Notion REST POST to Reading Parking Lot with backrefs
// All four use the existing MCP_CLIENT_TOKEN bearer auth pattern.

const ANTHROPIC_CHAT_TIMEOUT_MS = 35_000;
const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-5";
const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096;
const OPEN_QUESTIONS_DB_ID = "35d48344-93df-8104-b563-d9322d6d0f9d";

const OQ_ALLOWED_SURFACES = new Set(["UC1", "UC2", "UC3", "UC4", "Manual", "CLI"]);
const OQ_ALLOWED_DEPTHS = new Set(["Quick", "Medium", "Deep"]);
const OQ_ALLOWED_PRIORITIES = new Set(["High", "Medium", "Low"]);
const OQ_ALLOWED_DOMAINS = new Set(["Policy", "Economics", "Technology", "Cross-cutting"]);

const LEARNING_GAPS_QUEUE_DB_ID = "35ebac9a-7841-41bc-91fd-224b58feb9a3";

const GAP_ALLOWED_TRIGGER_SURFACES = new Set([
	"UC3-CommutePlayer",
	"CurationChat-UC1",
	"CurationChat-UC2",
	"CurationChat-UC4",
	"CLI",
]);
const GAP_ALLOWED_DOMAINS = new Set(["Policy", "Economics", "Technology", "Cross-cutting"]);

interface ChatMessage {
	role: "user" | "assistant";
	content: string;
}

interface ChatInput {
	system?: string;
	messages: ChatMessage[];
	model?: string;
	max_tokens?: number;
}

async function handleChat(input: ChatInput, env: Env) {
	if (!env.ANTHROPIC_API_KEY) {
		return {
			ok: false,
			status: 500,
			error: "server misconfigured: ANTHROPIC_API_KEY secret missing",
		};
	}
	if (!Array.isArray(input.messages) || input.messages.length === 0) {
		return { ok: false, status: 400, error: "messages must be a non-empty array" };
	}
	for (const m of input.messages) {
		if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
			return {
				ok: false,
				status: 400,
				error: "each message must have role='user'|'assistant' and content string",
			};
		}
	}

	const model = (input.model && input.model.trim()) || ANTHROPIC_DEFAULT_MODEL;
	const max_tokens = Math.max(1, Math.min(input.max_tokens || ANTHROPIC_DEFAULT_MAX_TOKENS, 8192));

	const reqBody: Record<string, any> = {
		model,
		max_tokens,
		messages: input.messages,
	};
	if (input.system && input.system.trim()) {
		reqBody.system = input.system;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ANTHROPIC_CHAT_TIMEOUT_MS);

	try {
		const resp = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"x-api-key": env.ANTHROPIC_API_KEY,
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
			},
			body: JSON.stringify(reqBody),
			signal: controller.signal,
		});
		if (!resp.ok) {
			const text = await resp.text();
			return {
				ok: false,
				status: resp.status,
				error: `Anthropic ${resp.status}: ${text.slice(0, 400)}`,
			};
		}
		const json = (await resp.json()) as any;
		return { ok: true as const, response: json };
	} catch (err) {
		const e = err as Error;
		if (e.name === "AbortError") {
			return {
				ok: false,
				status: 504,
				error: `Anthropic chat aborted after ${ANTHROPIC_CHAT_TIMEOUT_MS}ms`,
			};
		}
		return {
			ok: false,
			status: 502,
			error: `Anthropic fetch error: ${e.message}`,
		};
	} finally {
		clearTimeout(timer);
	}
}

interface RnCaptureInput {
	research_question: string;
	reasoning: string;
	assessment: string;
	falsifiable_tests?: string[];
	cited_urls?: string[];
	parent_chat_url?: string;
	parent_chat_metadata?: Record<string, unknown>;
	parent_article_page_id?: string;
	parent_surface?: string;
	created_by?: string;
	notes?: string;
}

// Item 1B — best-effort Notion mirror for RN captures. Self-bootstraps the
// target DB under PROJECT_LOG on first capture (see lib/notion-mirror.ts).
async function writeRnMirror(input: RnCaptureInput, env: Env): Promise<string | null> {
	if (!env.NOTION_TOKEN) return null;
	const dbId = await getOrCreateMirrorDbId(env, "rn");
	if (!dbId) return null;
	const titleText = input.research_question.replace(/\s+/g, " ").trim().slice(0, 100) + (input.research_question.length > 100 ? "…" : "");
	const properties: Record<string, unknown> = {
		Title: notionTitleProp(titleText),
		"Research Question": notionRichTextProp(input.research_question),
		Reasoning: notionRichTextProp(input.reasoning),
		Assessment: notionRichTextProp(input.assessment),
		"Cited Sources": notionRichTextProp((input.cited_urls ?? []).join(", ")),
		"Falsifiable Tests": notionRichTextProp((input.falsifiable_tests ?? []).join("\n")),
		"Source Surface": notionSelectProp(input.parent_surface || "CLI"),
	};
	try {
		const resp = await fetch("https://api.notion.com/v1/pages", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.NOTION_TOKEN}`,
				"Notion-Version": "2022-06-28",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ parent: { database_id: dbId }, properties }),
			signal: AbortSignal.timeout(15_000),
		});
		if (!resp.ok) {
			console.warn(`rn-mirror Notion write ${resp.status}:`, (await resp.text()).slice(0, 300));
			return null;
		}
		const page = (await resp.json()) as { id: string };
		return page.id;
	} catch (err) {
		console.warn("rn-mirror Notion write threw:", (err as Error).message);
		return null;
	}
}

async function handleRnCapture(input: RnCaptureInput, env: Env) {
	if (!env.IL_SERVER_FUNNEL_URL || !env.IL_SERVER_TOKEN) {
		return {
			ok: false,
			status: 500,
			error: "server misconfigured: IL_SERVER_FUNNEL_URL or IL_SERVER_TOKEN missing",
		};
	}
	const missing: string[] = [];
	if (!input.research_question || !input.research_question.trim()) missing.push("research_question");
	if (!input.reasoning || !input.reasoning.trim()) missing.push("reasoning");
	if (!input.assessment || !input.assessment.trim()) missing.push("assessment");
	if (missing.length) {
		return {
			ok: false,
			status: 400,
			error: `missing required fields: ${missing.join(", ")}`,
		};
	}
	// Item 1B: fire the canonical il-server write and the best-effort Notion
	// mirror in parallel. il-server determines ok/error; mirror only adds the
	// mirror_page_id field on success.
	const [macResult, mirrorResult] = await Promise.allSettled([
		postJson(
			`${env.IL_SERVER_FUNNEL_URL}/rn/capture`,
			env.IL_SERVER_TOKEN,
			input,
			15_000,
		),
		writeRnMirror(input, env),
	]);
	const mirrorPageId: string | null = mirrorResult.status === "fulfilled" ? mirrorResult.value : null;

	if (macResult.status === "rejected") {
		const msg = (macResult.reason as Error).message;
		if (msg.includes("timed out") || msg.includes("fetch failed")) {
			return { ...MAC_OFFLINE_RESULT, mirror_page_id: mirrorPageId };
		}
		return { ok: false, status: 502, error: `rn-capture upstream error: ${msg}`, mirror_page_id: mirrorPageId };
	}
	const r = macResult.value;
	if (r.status >= 400) {
		return { ok: false, status: r.status, error: `il-server /rn/capture ${r.status}: ${r.text.slice(0, 300)}`, mirror_page_id: mirrorPageId };
	}
	try {
		const parsed = JSON.parse(r.text);
		return { ...parsed, mirror_page_id: mirrorPageId };
	} catch {
		return { ok: false, status: 502, error: "non-JSON from il-server /rn/capture", raw: r.text.slice(0, 300), mirror_page_id: mirrorPageId };
	}
}

interface OqCreateInput {
	question: string;
	parent_article_page_id?: string;
	parent_rn_id?: string;
	parent_surface?: string;
	domain?: string;
	depth?: string;
	priority?: string;
	notes?: string;
}

async function handleOqCreate(input: OqCreateInput, env: Env) {
	if (!env.NOTION_TOKEN) {
		return { ok: false, status: 500, error: "server misconfigured: NOTION_TOKEN missing" };
	}
	if (!input.question || !input.question.trim()) {
		return { ok: false, status: 400, error: "question is required" };
	}
	// Enum validation
	if (input.parent_surface && !OQ_ALLOWED_SURFACES.has(input.parent_surface)) {
		return {
			ok: false,
			status: 400,
			error: `parent_surface must be one of: ${[...OQ_ALLOWED_SURFACES].join(", ")}`,
		};
	}
	if (input.depth && !OQ_ALLOWED_DEPTHS.has(input.depth)) {
		return {
			ok: false,
			status: 400,
			error: `depth must be one of: ${[...OQ_ALLOWED_DEPTHS].join(", ")}`,
		};
	}
	if (input.priority && !OQ_ALLOWED_PRIORITIES.has(input.priority)) {
		return {
			ok: false,
			status: 400,
			error: `priority must be one of: ${[...OQ_ALLOWED_PRIORITIES].join(", ")}`,
		};
	}
	if (input.domain && !OQ_ALLOWED_DOMAINS.has(input.domain)) {
		return {
			ok: false,
			status: 400,
			error: `domain must be one of: ${[...OQ_ALLOWED_DOMAINS].join(", ")}`,
		};
	}

	const titleChunks: any[] = [];
	const q = input.question.trim();
	for (let i = 0; i < q.length && i < 2000; i += 2000) {
		titleChunks.push({ type: "text", text: { content: q.slice(i, i + 2000) } });
	}

	const properties: Record<string, any> = {
		Question: { title: titleChunks },
		Status: { select: { name: "Open" } },
	};
	if (input.parent_article_page_id) {
		properties["Parent Article"] = { relation: [{ id: input.parent_article_page_id }] };
	}
	if (input.parent_rn_id) {
		properties["Parent Research Note ID"] = {
			rich_text: [{ type: "text", text: { content: input.parent_rn_id } }],
		};
	}
	if (input.parent_surface) {
		properties["Parent Surface"] = { select: { name: input.parent_surface } };
	}
	if (input.domain) {
		properties["Domain Hint"] = { select: { name: input.domain } };
	}
	if (input.depth) {
		properties["Depth Estimate"] = { select: { name: input.depth } };
	}
	if (input.priority) {
		properties["Priority"] = { select: { name: input.priority } };
	}
	if (input.notes) {
		const notesChunks: any[] = [];
		const n = input.notes;
		for (let i = 0; i < n.length; i += 2000) {
			notesChunks.push({ type: "text", text: { content: n.slice(i, i + 2000) } });
		}
		properties["Notes"] = { rich_text: notesChunks };
	}

	const body = {
		parent: { database_id: OPEN_QUESTIONS_DB_ID },
		properties,
	};

	try {
		const resp = await fetch("https://api.notion.com/v1/pages", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.NOTION_TOKEN}`,
				"Notion-Version": "2022-06-28",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(15_000),
		});
		if (!resp.ok) {
			const text = await resp.text();
			return { ok: false, status: resp.status, error: `Notion ${resp.status}: ${text.slice(0, 400)}` };
		}
		const page = (await resp.json()) as any;
		const fullId = page.id;
		const shortId = fullId.replace(/-/g, "").slice(-8);
		return {
			ok: true as const,
			open_question_id: shortId,
			full_id: fullId,
			url: page.url,
			created_time: page.created_time,
		};
	} catch (err) {
		return { ok: false, status: 502, error: `oq-create upstream error: ${(err as Error).message}` };
	}
}

interface GapCaptureInput {
	gap_title: string;
	voice_capture_text?: string;
	trigger_surface?: string;
	trigger_source_doc_id?: string;
	trigger_source_doc_relation?: boolean;
	domain?: string;
	requested_module_count?: number;
	notes?: string;
}

async function handleGapCapture(input: GapCaptureInput, env: Env, ctx?: ExecutionContext) {
	if (!env.NOTION_TOKEN) {
		return { ok: false, status: 500, error: "server misconfigured: NOTION_TOKEN missing" };
	}
	if (!input.gap_title || !input.gap_title.trim()) {
		return { ok: false, status: 400, error: "gap_title is required" };
	}
	if (input.trigger_surface && !GAP_ALLOWED_TRIGGER_SURFACES.has(input.trigger_surface)) {
		return {
			ok: false,
			status: 400,
			error: `trigger_surface must be one of: ${[...GAP_ALLOWED_TRIGGER_SURFACES].join(", ")}`,
		};
	}
	if (input.domain && !GAP_ALLOWED_DOMAINS.has(input.domain)) {
		return {
			ok: false,
			status: 400,
			error: `domain must be one of: ${[...GAP_ALLOWED_DOMAINS].join(", ")}`,
		};
	}
	if (input.requested_module_count !== undefined && input.requested_module_count !== null) {
		if (!Number.isInteger(input.requested_module_count) || input.requested_module_count < 1) {
			return { ok: false, status: 400, error: "requested_module_count must be a positive integer" };
		}
	}

	const titleChunks: any[] = [];
	const t = input.gap_title.trim();
	for (let i = 0; i < t.length && i < 2000; i += 2000) {
		titleChunks.push({ type: "text", text: { content: t.slice(i, i + 2000) } });
	}

	const properties: Record<string, any> = {
		"Gap Title": { title: titleChunks },
		Status: { select: { name: "Captured" } },
		"Trigger Surface": { select: { name: input.trigger_surface || "CLI" } },
	};

	if (input.voice_capture_text) {
		const chunks: any[] = [];
		const v = input.voice_capture_text;
		for (let i = 0; i < v.length; i += 2000) {
			chunks.push({ type: "text", text: { content: v.slice(i, i + 2000) } });
		}
		properties["Voice Capture Text"] = { rich_text: chunks };
	}
	if (input.trigger_source_doc_id) {
		if (input.trigger_source_doc_relation) {
			properties["Trigger Source Doc"] = { relation: [{ id: input.trigger_source_doc_id }] };
		} else {
			properties["Trigger Source Doc ID"] = {
				rich_text: [{ type: "text", text: { content: input.trigger_source_doc_id } }],
			};
		}
	}
	if (input.domain) {
		properties["Domain"] = { select: { name: input.domain } };
	}
	if (input.requested_module_count !== undefined && input.requested_module_count !== null) {
		properties["Requested Module Count"] = { number: input.requested_module_count };
	}
	if (input.notes) {
		const chunks: any[] = [];
		const n = input.notes;
		for (let i = 0; i < n.length; i += 2000) {
			chunks.push({ type: "text", text: { content: n.slice(i, i + 2000) } });
		}
		properties["Notes"] = { rich_text: chunks };
	}

	const body = {
		parent: { database_id: LEARNING_GAPS_QUEUE_DB_ID },
		properties,
	};

	try {
		const resp = await fetch("https://api.notion.com/v1/pages", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.NOTION_TOKEN}`,
				"Notion-Version": "2022-06-28",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(15_000),
		});
		if (!resp.ok) {
			const text = await resp.text();
			return { ok: false, status: resp.status, error: `Notion ${resp.status}: ${text.slice(0, 400)}` };
		}
		const page = (await resp.json()) as any;
		const fullId = page.id;
		const shortId = fullId.replace(/-/g, "").slice(-8);
		// §8.4a.21 W4: auto-fire the UC3 Fundamentals pipeline (fire-and-forget).
		// ctx.waitUntil keeps the Worker alive for the Workflow.create call to land
		// without blocking the HTTP response. UC3_PIPELINE binding may be absent in
		// older deploys — guard with a runtime check.
		let pipeline_instance_id: string | undefined;
		if (ctx && env.UC3_PIPELINE) {
			try {
				const inst = await env.UC3_PIPELINE.create({ params: { gap_id: shortId } });
				pipeline_instance_id = inst.id;
			} catch (e) {
				// Don't fail the capture if pipeline kickoff fails — log silently.
				console.warn(`UC3 pipeline auto-trigger failed for gap ${shortId}:`, (e as Error).message);
			}
		}
		return {
			ok: true as const,
			learning_gap_id: shortId,
			full_id: fullId,
			url: page.url,
			created_time: page.created_time,
			pipeline_instance_id,
		};
	} catch (err) {
		return { ok: false, status: 502, error: `gap-capture upstream error: ${(err as Error).message}` };
	}
}

// ──────────────────────────────────────────────────────────────────────────
// /api/log-append — append-only writes to PROJECT_LOG via Notion blocks API.
// Bypasses the page-update slow path so payload size of the existing page
// (currently ~620KB) does not matter. Use this for all log entries.
// ──────────────────────────────────────────────────────────────────────────

interface LogAppendInput {
	heading: string;
	body_markdown?: string;
	page_id?: string;
}

type NotionRichText = {
	type: "text";
	text: { content: string; link?: { url: string } };
	annotations?: { bold?: boolean; code?: boolean };
};

// Parse inline **bold**, `code`, [text](url) into a Notion rich_text array.
// Chunks any single text segment >2000 chars to stay under Notion's per-item limit.
function parseInlineMarkdown(text: string): NotionRichText[] {
	const out: NotionRichText[] = [];
	const tokenRegex = /(\*\*[^*]+\*\*)|(`[^`]+`)|(\[[^\]]+\]\([^)]+\))/g;
	let lastEnd = 0;
	let match: RegExpExecArray | null;
	const pushChunked = (content: string, annotations?: NotionRichText["annotations"], linkUrl?: string) => {
		if (content.length === 0) return;
		for (let i = 0; i < content.length; i += 2000) {
			const slice = content.slice(i, i + 2000);
			const item: NotionRichText = { type: "text", text: { content: slice } };
			if (linkUrl) item.text.link = { url: linkUrl };
			if (annotations) item.annotations = annotations;
			out.push(item);
		}
	};
	while ((match = tokenRegex.exec(text)) !== null) {
		if (match.index > lastEnd) {
			pushChunked(text.slice(lastEnd, match.index));
		}
		const m = match[0];
		if (m.startsWith("**")) {
			pushChunked(m.slice(2, -2), { bold: true });
		} else if (m.startsWith("`")) {
			pushChunked(m.slice(1, -1), { code: true });
		} else {
			const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(m);
			if (linkMatch) {
				pushChunked(linkMatch[1], undefined, linkMatch[2]);
			} else {
				pushChunked(m);
			}
		}
		lastEnd = match.index + m.length;
	}
	if (lastEnd < text.length) {
		pushChunked(text.slice(lastEnd));
	}
	if (out.length === 0) {
		out.push({ type: "text", text: { content: text.slice(0, 2000) } });
	}
	return out;
}

function makeBlock(type: "heading_2" | "heading_3" | "paragraph" | "bulleted_list_item", text: string): any {
	const richText = parseInlineMarkdown(text);
	return { object: "block", type, [type]: { rich_text: richText } };
}

function buildLogBlocks(heading: string, bodyMarkdown: string | undefined): any[] {
	const blocks: any[] = [];
	blocks.push(makeBlock("heading_3", heading));
	if (!bodyMarkdown) return blocks;

	const paragraphs = bodyMarkdown.split(/\n\n+/);
	for (const p of paragraphs) {
		const trimmed = p.trim();
		if (!trimmed) continue;
		const lines = trimmed.split("\n");
		// Detect bulleted-list paragraph (all lines start with "- ")
		const isBulletList = lines.every((l) => l.startsWith("- "));
		if (isBulletList) {
			for (const l of lines) {
				blocks.push(makeBlock("bulleted_list_item", l.slice(2)));
			}
			continue;
		}
		// Detect heading-only paragraph
		if (lines.length === 1) {
			if (trimmed.startsWith("### ")) {
				blocks.push(makeBlock("heading_3", trimmed.slice(4)));
				continue;
			}
			if (trimmed.startsWith("## ")) {
				blocks.push(makeBlock("heading_2", trimmed.slice(3)));
				continue;
			}
		}
		// Otherwise: one paragraph block. Newlines inside collapse via Notion's
		// rich_text — we keep them by joining with \n which Notion preserves.
		blocks.push(makeBlock("paragraph", lines.join("\n")));
	}
	return blocks;
}

async function handleLogAppend(input: LogAppendInput, env: Env) {
	if (!env.NOTION_TOKEN) {
		return { ok: false, status: 500, error: "server misconfigured: NOTION_TOKEN missing" };
	}
	if (!input.heading || !input.heading.trim()) {
		return { ok: false, status: 400, error: "heading is required" };
	}

	const pageId = (input.page_id || PROJECT_LOG_PAGE_ID).replace(/-/g, "");
	const blocks = buildLogBlocks(input.heading.trim(), input.body_markdown);

	if (blocks.length > 100) {
		return {
			ok: false,
			status: 400,
			error: `payload produces ${blocks.length} blocks; Notion limit is 100 per call. Split into multiple calls.`,
		};
	}

	try {
		const resp = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
			method: "PATCH",
			headers: {
				Authorization: `Bearer ${env.NOTION_TOKEN}`,
				"Notion-Version": "2022-06-28",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ children: blocks }),
			signal: AbortSignal.timeout(20_000),
		});
		if (!resp.ok) {
			const text = await resp.text();
			return {
				ok: false,
				status: resp.status,
				error: `Notion blocks/children PATCH ${resp.status}: ${text.slice(0, 500)}`,
			};
		}
		const result = (await resp.json()) as any;
		const ids = (result.results || []).map((b: any) => b.id);
		return {
			ok: true as const,
			block_count: ids.length,
			appended_block_ids: ids,
			page_url: `https://www.notion.so/${pageId}`,
		};
	} catch (err) {
		return { ok: false, status: 502, error: `log-append upstream error: ${(err as Error).message}` };
	}
}

// /api/project-log-recent — read-only view into PROJECT_LOG for the /log
// surface. Walks Notion blocks/children pagination once (up to ~500 blocks),
// groups them into entries keyed by heading_2, returns the most recent N.
// Each entry includes the heading title, derived status (parsed from
// trailing tag like "[done]"/"[wip]"), iso timestamp from the block, and
// a flattened markdown-ish body. Mirrors handleLogAppend's auth/timeout.
interface ProjectLogRecentInput {
	page_id?: string;
	limit?: number; // entry cap; default 25, max 100
}

function plainFromRichText(rt: any[]): string {
	if (!Array.isArray(rt)) return "";
	return rt.map((r) => (r && r.plain_text) || "").join("");
}

function parseStatusTag(title: string): { status: string; cleanTitle: string } {
	// Match a trailing [tag] or [tag: detail] on the heading.
	const m = title.match(/\s*\[([a-z0-9_\- :]{1,32})\]\s*$/i);
	if (!m) return { status: "", cleanTitle: title };
	const raw = m[1].toLowerCase().trim();
	const tag = raw.split(":")[0].trim();
	const known = new Set(["done", "wip", "blocked", "deferred", "note", "decision", "ship", "shipped", "fix", "spike"]);
	return { status: known.has(tag) ? tag : tag, cleanTitle: title.slice(0, m.index).trim() };
}

async function handleProjectLogRecent(input: ProjectLogRecentInput, env: Env) {
	if (!env.NOTION_TOKEN) {
		return { ok: false, status: 500, error: "server misconfigured: NOTION_TOKEN missing" };
	}
	const pageId = (input.page_id || PROJECT_LOG_PAGE_ID).replace(/-/g, "");
	const cap = Math.min(100, Math.max(1, input.limit || 25));
	const maxBlocks = 600; // soft cap on Notion calls — three pages of 100 plus tail
	try {
		const blocks: any[] = [];
		let cursor: string | undefined = undefined;
		// PROJECT_LOG is append-only and large. We only need the *tail* (latest
		// entries) so we walk pages until we have enough headings — but the
		// Notion children API only returns oldest-first, so we have to walk
		// the whole thing once. Keep within maxBlocks to bound latency.
		while (blocks.length < maxBlocks) {
			const qs = new URLSearchParams({ page_size: "100" });
			if (cursor) qs.set("start_cursor", cursor);
			const r = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?${qs.toString()}`, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${env.NOTION_TOKEN}`,
					"Notion-Version": "2022-06-28",
				},
				signal: AbortSignal.timeout(20_000),
			});
			if (!r.ok) {
				const t = await r.text();
				return { ok: false, status: r.status, error: `Notion blocks/children GET ${r.status}: ${t.slice(0, 500)}` };
			}
			const json = (await r.json()) as any;
			const results = json.results || [];
			for (const b of results) blocks.push(b);
			if (!json.has_more) break;
			cursor = json.next_cursor;
			if (!cursor) break;
		}
		// Group: each heading_2 begins a new entry; subsequent non-heading blocks
		// are appended to its body until the next heading_2.
		type Entry = { heading: string; status: string; created_at: string; body_md: string };
		const entries: Entry[] = [];
		let current: Entry | null = null;
		for (const b of blocks) {
			if (b.type === "heading_2") {
				if (current) entries.push(current);
				const raw = plainFromRichText(b.heading_2?.rich_text || []);
				const { status, cleanTitle } = parseStatusTag(raw);
				current = { heading: cleanTitle, status, created_at: b.created_time || "", body_md: "" };
				continue;
			}
			if (!current) continue;
			// Flatten common block types into markdown-ish text. Keep this
			// lossy-but-readable; the /log surface only needs human display.
			let text = "";
			if (b.type === "paragraph") text = plainFromRichText(b.paragraph?.rich_text || []);
			else if (b.type === "heading_3") text = "### " + plainFromRichText(b.heading_3?.rich_text || []);
			else if (b.type === "bulleted_list_item") text = "• " + plainFromRichText(b.bulleted_list_item?.rich_text || []);
			else if (b.type === "numbered_list_item") text = "1. " + plainFromRichText(b.numbered_list_item?.rich_text || []);
			else if (b.type === "to_do") {
				const checked = b.to_do?.checked ? "[x]" : "[ ]";
				text = checked + " " + plainFromRichText(b.to_do?.rich_text || []);
			}
			else if (b.type === "code") text = "```\n" + plainFromRichText(b.code?.rich_text || []) + "\n```";
			else if (b.type === "quote") text = "> " + plainFromRichText(b.quote?.rich_text || []);
			else if (b.type === "callout") text = plainFromRichText(b.callout?.rich_text || []);
			if (text) current.body_md += (current.body_md ? "\n" : "") + text;
		}
		if (current) entries.push(current);
		// Take the last N (newest), then reverse so newest first.
		const tail = entries.slice(-cap).reverse();
		return {
			ok: true as const,
			entries: tail,
			total_entries_seen: entries.length,
			truncated: blocks.length >= maxBlocks,
			page_url: `https://www.notion.so/${pageId}`,
		};
	} catch (err) {
		return { ok: false, status: 502, error: `project-log-recent upstream error: ${(err as Error).message}` };
	}
}

interface LinkSourceInput {
	url: string;
	parent_article_page_id?: string;
	parent_rn_id?: string;
	title?: string;
	blurb?: string;
}

function titleFromUrl(url: string): string {
	try {
		const u = new URL(url);
		const slug = u.pathname.split("/").filter(Boolean).pop() || u.hostname;
		return slug.replace(/-/g, " ").replace(/_/g, " ").slice(0, 200);
	} catch {
		return url.slice(0, 200);
	}
}

async function handleLinkSource(input: LinkSourceInput, env: Env) {
	if (!env.NOTION_TOKEN) {
		return { ok: false, status: 500, error: "server misconfigured: NOTION_TOKEN missing" };
	}
	if (!input.url || !input.url.trim()) {
		return { ok: false, status: 400, error: "url is required" };
	}
	const url = input.url.trim().replace(/\/+$/, "");

	// Idempotency: query RPL for existing rows with this URL
	try {
		const queryResp = await fetch(
			`https://api.notion.com/v1/databases/${READING_PARKING_LOT_DB_ID}/query`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${env.NOTION_TOKEN}`,
					"Notion-Version": "2022-06-28",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					filter: {
						or: [
							{ property: "Article URL", url: { equals: url } },
							{ property: "Article URL", url: { equals: url + "/" } },
						],
					},
					page_size: 1,
				}),
				signal: AbortSignal.timeout(15_000),
			},
		);
		if (queryResp.ok) {
			const queryJson = (await queryResp.json()) as any;
			if (queryJson.results && queryJson.results.length > 0) {
				const existing = queryJson.results[0];
				return {
					ok: true as const,
					linked_source_id: existing.id.replace(/-/g, "").slice(-8),
					full_id: existing.id,
					url: existing.url,
					idempotent: true,
					message: "URL already in Reading Parking Lot; existing row returned (backrefs NOT overwritten)",
				};
			}
		}
	} catch (_err) {
		// Soft-fail on idempotency check — continue to insert; worst case duplicate row
	}

	// Create new RPL row
	const title = (input.title && input.title.trim()) || titleFromUrl(url);
	const titleChunks = [{ type: "text", text: { content: title.slice(0, 2000) } }];

	const properties: Record<string, any> = {
		Title: { title: titleChunks },
		"Article URL": { url },
		Status: { select: { name: "New" } },
		"Source Newsletter": { select: { name: "research-cited" } },
		"Email Received": { date: { start: new Date().toISOString() } },
	};
	if (input.blurb) {
		const blurbChunks: any[] = [];
		for (let i = 0; i < input.blurb.length; i += 2000) {
			blurbChunks.push({ type: "text", text: { content: input.blurb.slice(i, i + 2000) } });
		}
		properties["Blurb"] = { rich_text: blurbChunks };
	}
	if (input.parent_article_page_id) {
		properties["Source Parent Article ID"] = {
			rich_text: [{ type: "text", text: { content: input.parent_article_page_id } }],
		};
	}
	if (input.parent_rn_id) {
		properties["Source Research Note ID"] = {
			rich_text: [{ type: "text", text: { content: input.parent_rn_id } }],
		};
	}

	try {
		const resp = await fetch("https://api.notion.com/v1/pages", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.NOTION_TOKEN}`,
				"Notion-Version": "2022-06-28",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				parent: { database_id: READING_PARKING_LOT_DB_ID },
				properties,
			}),
			signal: AbortSignal.timeout(15_000),
		});
		if (!resp.ok) {
			const text = await resp.text();
			return { ok: false, status: resp.status, error: `Notion ${resp.status}: ${text.slice(0, 400)}` };
		}
		const page = (await resp.json()) as any;
		return {
			ok: true as const,
			linked_source_id: page.id.replace(/-/g, "").slice(-8),
			full_id: page.id,
			url: page.url,
			idempotent: false,
		};
	} catch (err) {
		return { ok: false, status: 502, error: `link-source upstream error: ${(err as Error).message}` };
	}
}

// ---------- TTS cache routes (§8.4a.19 R2 audio cache) ----------
// GET  /api/tts-cache/{page_id} — returns cached MP3 or 404
// PUT  /api/tts-cache/{page_id} — stores MP3 blob in R2

function getPageIdFromTtsUrl(url: URL): string | null {
	// /api/tts-cache/{page_id}
	const parts = url.pathname.split("/");
	return parts[3] || null; // 0='', 1='api', 2='tts-cache', 3=pageId
}

async function handleTTSCacheGet(request: Request, env: Env, url: URL): Promise<Response> {
	const auth = request.headers.get("Authorization") || "";
	if (!auth.startsWith("Bearer ") || auth.slice(7) !== env.MCP_CLIENT_TOKEN) {
		return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
			status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
		});
	}
	const pageId = getPageIdFromTtsUrl(url);
	if (!pageId) {
		return new Response(JSON.stringify({ ok: false, error: "missing page_id" }), {
			status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
		});
	}
	if (!env.TTS_CACHE) {
		return new Response(JSON.stringify({ ok: false, error: "TTS_CACHE R2 binding not configured" }), {
			status: 503, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
		});
	}
	const obj = await env.TTS_CACHE.get(pageId);
	if (!obj) {
		return new Response(JSON.stringify({ error: "Not cached" }), {
			status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
		});
	}
	return new Response(obj.body, {
		status: 200,
		headers: {
			"Content-Type": "audio/mpeg",
			"Cache-Control": "public, max-age=604800", // 7 days
			"X-Cache": "hit",
			...CORS_HEADERS,
		},
	});
}

async function handleTTSCachePut(request: Request, env: Env, url: URL): Promise<Response> {
	const auth = request.headers.get("Authorization") || "";
	if (!auth.startsWith("Bearer ") || auth.slice(7) !== env.MCP_CLIENT_TOKEN) {
		return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
			status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
		});
	}
	const pageId = getPageIdFromTtsUrl(url);
	if (!pageId) {
		return new Response(JSON.stringify({ ok: false, error: "missing page_id" }), {
			status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
		});
	}
	if (!env.TTS_CACHE) {
		return new Response(JSON.stringify({ ok: false, error: "TTS_CACHE R2 binding not configured" }), {
			status: 503, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
		});
	}
	const body = await request.arrayBuffer();
	if (!body || body.byteLength === 0) {
		return new Response(JSON.stringify({ ok: false, error: "empty body" }), {
			status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
		});
	}
	await env.TTS_CACHE.put(pageId, body, {
		httpMetadata: { contentType: "audio/mpeg" },
		customMetadata: { cachedAt: new Date().toISOString() },
	});
	return new Response(JSON.stringify({ ok: true, page_id: pageId, bytes: body.byteLength }), {
		status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
	});
}

// ---------- ElevenLabs TTS proxy (§8.4a.19 optional) ----------
// POST /api/tts         — single chunk, max 5000 chars
// POST /api/tts-chunked — splits at sentence boundaries, concatenates MP3 buffers

const ELEVENLABS_TTS_URL_BASE = "https://api.elevenlabs.io/v1/text-to-speech/";
const ELEVENLABS_DEFAULT_MODEL = "eleven_multilingual_v2";
const ELEVENLABS_CHUNK_SIZE = 4500;

function buildElevenLabsBody(text: string, voiceId: string, modelId: string, speed?: number) {
	const voiceSettings: Record<string, number> = {
		stability: 0.5,
		similarity_boost: 0.75,
		style: 0.0,
		use_speaker_boost: 1,
	};
	if (speed && typeof speed === "number") {
		voiceSettings.speed = Math.max(0.7, Math.min(1.2, speed));
	}
	return {
		text,
		model_id: modelId || ELEVENLABS_DEFAULT_MODEL,
		voice_settings: voiceSettings,
	};
}

async function callElevenLabs(text: string, voiceId: string, modelId: string, speed: number | undefined, apiKey: string): Promise<{ ok: true; buf: ArrayBuffer } | { ok: false; status: number; error: string }> {
	const url = ELEVENLABS_TTS_URL_BASE + encodeURIComponent(voiceId);
	let resp: Response;
	try {
		resp = await fetch(url, {
			method: "POST",
			headers: {
				"xi-api-key": apiKey,
				"Content-Type": "application/json",
				"Accept": "audio/mpeg",
			},
			body: JSON.stringify(buildElevenLabsBody(text, voiceId, modelId, speed)),
			signal: AbortSignal.timeout(30_000),
		});
	} catch (e) {
		return { ok: false, status: 502, error: `Failed to reach ElevenLabs: ${(e as Error).message}` };
	}
	if (!resp.ok) {
		let detail = "";
		try { detail = (await resp.text()).slice(0, 500); } catch (_) {}
		return { ok: false, status: resp.status, error: `ElevenLabs ${resp.status}: ${detail}` };
	}
	const buf = await resp.arrayBuffer();
	return { ok: true, buf };
}

async function handleTTS(body: any, env: Env): Promise<unknown> {
	if (!env.ELEVENLABS_API_KEY) {
		return { ok: false, status: 500, error: "server misconfigured: ELEVENLABS_API_KEY secret missing" };
	}
	const { text, voice_id, model_id, speed } = body || {};
	if (!text || typeof text !== "string" || !text.trim()) {
		return { ok: false, status: 400, error: 'missing or empty "text" field' };
	}
	if (!voice_id || typeof voice_id !== "string") {
		return { ok: false, status: 400, error: 'missing "voice_id" field' };
	}
	const result = await callElevenLabs(
		text.slice(0, 5000),
		voice_id,
		model_id || ELEVENLABS_DEFAULT_MODEL,
		speed,
		env.ELEVENLABS_API_KEY,
	);
	if (!result.ok) return result;
	return new Response(result.buf, {
		status: 200,
		headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400", ...CORS_HEADERS },
	});
}

async function handleTTSChunked(body: any, env: Env): Promise<unknown> {
	if (!env.ELEVENLABS_API_KEY) {
		return { ok: false, status: 500, error: "server misconfigured: ELEVENLABS_API_KEY secret missing" };
	}
	const { text, voice_id, model_id, speed } = body || {};
	if (!text || !voice_id) {
		return { ok: false, status: 400, error: "missing text or voice_id" };
	}

	// Split at sentence boundaries
	const chunks: string[] = [];
	let remaining: string = text;
	while (remaining.length > 0) {
		if (remaining.length <= ELEVENLABS_CHUNK_SIZE) { chunks.push(remaining); break; }
		const region = remaining.slice(0, ELEVENLABS_CHUNK_SIZE);
		const lastBoundary = Math.max(
			region.lastIndexOf(". "), region.lastIndexOf(".\n"),
			region.lastIndexOf("! "), region.lastIndexOf("? "),
		);
		const cutoff = lastBoundary > ELEVENLABS_CHUNK_SIZE * 0.5 ? lastBoundary + 2 : ELEVENLABS_CHUNK_SIZE;
		chunks.push(remaining.slice(0, cutoff));
		remaining = remaining.slice(cutoff);
	}

	const buffers: ArrayBuffer[] = [];
	for (let i = 0; i < chunks.length; i++) {
		const result = await callElevenLabs(
			chunks[i], voice_id, model_id || ELEVENLABS_DEFAULT_MODEL, speed, env.ELEVENLABS_API_KEY,
		);
		if (!result.ok) {
			return { ok: false, status: result.status, error: `ElevenLabs error on chunk ${i + 1}/${chunks.length}: ${result.error}` };
		}
		buffers.push(result.buf);
	}

	const totalLen = buffers.reduce((s, b) => s + b.byteLength, 0);
	const combined = new Uint8Array(totalLen);
	let offset = 0;
	for (const buf of buffers) { combined.set(new Uint8Array(buf), offset); offset += buf.byteLength; }

	return new Response(combined.buffer, {
		status: 200,
		headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400", ...CORS_HEADERS },
	});
}

// ---------- MCP server class (uses shared handlers above) ----------

function mcpResponse(result: any) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(result) }],
		isError: result.ok === false,
	};
}

// §8.4a.21 W8 — search_modules MCP handler. Queries the UC3 Fundamentals
// Learning Modules library by free-text + status + gap_id filters. Returns
// each module with its public audio URL (full + brief), claim counts, and
// latest verification verdict.
interface SearchModulesInput {
	query?: string;
	status?: "approved" | "review-brief-pending" | "revision-requested" | "all";
	gap_id?: string;
	limit?: number;
}

async function handleSearchModules(input: SearchModulesInput, env: Env) {
	const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
	const clauses: string[] = [];
	const binds: Array<string | number> = [];
	if (input.query && input.query.trim()) {
		clauses.push("lm.learning_objective LIKE ?");
		binds.push(`%${input.query.trim()}%`);
	}
	if (input.status && input.status !== "all") {
		clauses.push("lm.status = ?");
		binds.push(input.status);
	}
	if (input.gap_id && input.gap_id.trim()) {
		clauses.push("lm.gap_id = ?");
		binds.push(input.gap_id.trim());
	}
	const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

	try {
		const modules = await env.UC3_DB
			.prepare(
				`SELECT lm.id, lm.gap_id, lm.position_in_series, lm.status, lm.learning_objective,
				        lm.audio_r2_key, lm.transcript_r2_key
				 FROM learning_modules lm
				 ${where}
				 ORDER BY lm.gap_id, lm.position_in_series ASC
				 LIMIT ?`,
			)
			.bind(...binds, limit)
			.all<{
				id: number;
				gap_id: string;
				position_in_series: number;
				status: string;
				learning_objective: string;
				audio_r2_key: string | null;
				transcript_r2_key: string | null;
			}>();

		const results = await Promise.all(
			(modules.results ?? []).map(async (m) => {
				const claimsR = await env.UC3_DB
					.prepare(
						"SELECT COUNT(*) AS total, SUM(CASE WHEN needs_human_review=1 THEN 1 ELSE 0 END) AS flagged FROM section_claims WHERE module_id = ?",
					)
					.bind(m.id)
					.first<{ total: number; flagged: number }>();
				const erratR = await env.UC3_DB
					.prepare("SELECT COUNT(*) AS n FROM module_errata WHERE module_id = ?")
					.bind(m.id)
					.first<{ n: number }>();
				const s7R = await env.UC3_DB
					.prepare(
						"SELECT verdict FROM verification_passes WHERE module_id = ? AND pass_number = 2 ORDER BY decided_at DESC LIMIT 1",
					)
					.bind(m.id)
					.first<{ verdict: string }>();
				const briefR = await env.UC3_DB
					.prepare("SELECT audio_r2_key FROM review_briefs WHERE module_id = ?")
					.bind(m.id)
					.first<{ audio_r2_key: string | null }>();
				const base = "https://spacesc-mcp.75xnd2784n.workers.dev";
				return {
					module_id: m.id,
					gap_id: m.gap_id,
					position: m.position_in_series,
					status: m.status,
					learning_objective: m.learning_objective,
					audio_url: m.audio_r2_key ? `${base}/api/uc3/module-audio?module_id=${m.id}` : null,
					brief_audio_url: briefR?.audio_r2_key ? `${base}/api/uc3/brief-audio?module_id=${m.id}` : null,
					has_transcript: !!m.transcript_r2_key,
					claim_count: claimsR?.total ?? 0,
					flagged_claim_count: claimsR?.flagged ?? 0,
					errata_count: erratR?.n ?? 0,
					latest_s7_verdict: s7R?.verdict ?? null,
				};
			}),
		);

		return { ok: true, query: input.query ?? null, status: input.status ?? null, gap_id: input.gap_id ?? null, count: results.length, modules: results };
	} catch (err) {
		return { ok: false, error: `search_modules failed: ${(err as Error).message}` };
	}
}

export class SpaceSCMCP extends McpAgent<Env> {
	server = new McpServer({ name: "spacesc", version: "1.2.0" });

	async init() {
		this.server.registerTool(
			"query_corpus",
			{
				description:
					"Search the SpaceSC source corpus (Pinecone-indexed Notion SKR pages) for chunks relevant to a question. Returns ranked chunks with provenance (skr_page_id, title, content_type, summary). Always cite returned skr_page_ids inline when synthesizing answers — never present corpus content as your own analysis.",
				inputSchema: {
					query: z.string().min(1),
					limit: z.number().int().min(1).max(20).optional().default(5),
				},
			},
			async (input) => mcpResponse(await handleQueryCorpus(input, this.env)),
		);

		this.server.registerTool(
			"capture_insight",
			{
				description:
					"Capture a structured insight via dual-write to Mac SQLite (pending, immediately searchable) + Notion audit. ALWAYS show Campbell the proposed claim and get explicit yes-go before calling, UNLESS Campbell said 'log this' / 'capture this' — in those cases call immediately. After capture, tell Campbell the short_id. If sqlite_landed:false (Mac offline), explain the `il import` caveat. Always include source_doc_ids from prior query_corpus chunks.",
				inputSchema: {
					claim: z.string().min(1),
					claim_type: z.enum(ALLOWED_TYPES).optional().default("observation"),
					domain_primary: z.enum(ALLOWED_DOMAINS),
					domain_secondary: z.enum(ALLOWED_DOMAINS).optional().nullable(),
					confidence: z.enum(ALLOWED_CONFIDENCE).optional().default("medium"),
					source_doc_ids: z.array(z.string()).optional().default([]),
					query_context: z.string().optional().nullable(),
				},
			},
			async (input) => mcpResponse(await handleCaptureInsight(input, this.env)),
		);

		this.server.registerTool(
			"search_insights",
			{
				description:
					"Search Campbell's structured insight ledger. Distinguish [SOURCE: ...] (corpus) from [INSIGHT: ...] (ledger). Returns mac_offline error when Mac is unreachable.",
				inputSchema: {
					query: z.string().min(1),
					include_pending: z.boolean().optional().default(false),
					domain: z.enum(ALLOWED_DOMAINS).optional(),
					limit: z.number().int().min(1).max(50).optional().default(10),
				},
			},
			async (input) => mcpResponse(await handleSearchInsights(input, this.env)),
		);

		this.server.registerTool(
			"approve_insight",
			{
				description:
					"Approve OR reject (delete) a pending insight in Campbell's local ledger. Confirm action with quoted short_id + claim snippet before calling, unless Campbell explicitly typed 'approve abcd1234'. Reject is irreversible.",
				inputSchema: {
					insight_id: z.string().min(4),
					action: z.enum(["approve", "reject"]),
					notes: z.string().optional().nullable(),
				},
			},
			async (input) => mcpResponse(await handleApproveInsight(input, this.env)),
		);

		// §8.4a.21 W8 — search_modules: query the UC3 Fundamentals library.
		this.server.registerTool(
			"search_modules",
			{
				description:
					"Search Campbell's UC3 Fundamentals Learning Modules library. Each module is a ~10-min audio lesson generated by the §8.4a.21 pipeline from a captured knowledge gap. Returns module metadata + public audio URLs (full-module + ~5-min review brief) + claim/errata counts + latest S7 verdict. Filter by free-text against learning_objective, status (approved/review-brief-pending/revision-requested/all), and/or gap_id. Cite module_id when referencing.",
				inputSchema: {
					query: z.string().min(1).optional(),
					status: z.enum(["approved", "review-brief-pending", "revision-requested", "all"]).optional(),
					gap_id: z.string().optional(),
					limit: z.number().int().min(1).max(50).optional().default(10),
				},
			},
			async (input) => mcpResponse(await handleSearchModules(input, this.env)),
		);

		// §8.4a.25 — search_feedback: Campbell's 🚩 capture inbox.
		// CRITICAL: call this at session start (per CLAUDE.md). Surface any
		// status='open' items as the first thing to address.
		this.server.registerTool(
			"search_feedback",
			{
				description:
					"Search Campbell's UI feedback inbox (the 🚩 button on every SpaceSC surface). Returns items captured from /uc3, /desk, /reading, /corpus, /insights, /posture, /pipeline, /log, /system-map. Each item includes the surface, view state at capture, type (bug | confusion | feature | question), notes, and status. **Call this at session start** to see what needs addressing without Campbell having to remember and re-explain. Filter by status (open | in_progress | resolved | wontfix), surface, or type.",
				inputSchema: {
					status: z.enum(["open", "in_progress", "resolved", "wontfix"]).optional(),
					surface: z.string().optional(),
					type: z.enum(["bug", "confusion", "feature", "question"]).optional(),
					limit: z.number().int().min(1).max(200).optional().default(50),
				},
			},
			async (input) => {
				try {
					const items = await listFeedback(this.env.UC3_DB, input);
					return mcpResponse({ ok: true, count: items.length, items });
				} catch (err) {
					return mcpResponse({ ok: false, error: (err as Error).message });
				}
			},
		);

		// §8.4a.25 — list_open_blindspots: the adversarial UAT register.
		// Each open blindspot is a check we should have run but didn't —
		// the pre-deploy gate reads this list and resolves them as 'applied'
		// or 'rejected'.
		this.server.registerTool(
			"list_open_blindspots",
			{
				description:
					"List adversarial-UAT audit blindspots — entries that name a check our ADR-024 self-audit missed, generated automatically when Campbell taps 🚩. Each row has: missed_check (which F-entry was nearby), why_text (one-paragraph diagnosis), proposed_new_check (the verification step to add). **Call this at session start.** Status 'open' items must be resolved before deploy: either prove the proposed check would have caught the reported issue (resolve as 'applied' + promote to ADR-024 F#) or argue why it would be noise (resolve as 'rejected' + write the rationale).",
				inputSchema: {
					status: z.enum(["open", "applied", "rejected"]).optional().default("open"),
					pattern_category: z.string().optional(),
					limit: z.number().int().min(1).max(200).optional().default(50),
				},
			},
			async (input) => {
				try {
					const items = await listBlindspots(this.env.UC3_DB, input);
					return mcpResponse({ ok: true, count: items.length, items });
				} catch (err) {
					return mcpResponse({ ok: false, error: (err as Error).message });
				}
			},
		);

		// §8.4a.25 — resolve_blindspot: close the loop.
		this.server.registerTool(
			"resolve_blindspot",
			{
				description:
					"Resolve an audit blindspot — either promote the proposed_new_check into ADR-024 as a new F-entry (status='applied', supply applied_to_adr like 'F15'), or reject it with rationale (status='rejected'). The resolution_note is mandatory and explains the decision. Use after running the proposed_new_check yourself to verify it would have caught the reported issue.",
				inputSchema: {
					id: z.number().int().min(1),
					status: z.enum(["applied", "rejected"]),
					resolution_note: z.string().min(1),
					applied_to_adr: z.string().optional(),
				},
			},
			async (input) => {
				try {
					const r = await resolveBlindspot(this.env.UC3_DB, input.id, input.status, input.resolution_note, input.applied_to_adr);
					return mcpResponse(r);
				} catch (err) {
					return mcpResponse({ ok: false, error: (err as Error).message });
				}
			},
		);
	}
}

// ---------- /api/* HTTP routes (for Live Artifacts; bearer-auth + CORS) ----------

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
	"Access-Control-Max-Age": "86400",
};

function jsonResponse(status: number, body: unknown) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...CORS_HEADERS },
	});
}

function authOk(req: Request, expectedToken: string): boolean {
	const auth = req.headers.get("Authorization") || "";
	if (!auth.startsWith("Bearer ")) return false;
	return auth.slice(7) === expectedToken;
}

async function handleApiRoute(
	pathname: string,
	req: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response | null> {
	if (!pathname.startsWith("/api/")) return null;
	if (req.method !== "POST") {
		return jsonResponse(405, { ok: false, error: "method not allowed" });
	}
	if (!env.MCP_CLIENT_TOKEN) {
		return jsonResponse(500, {
			ok: false,
			error: "server misconfigured: MCP_CLIENT_TOKEN secret missing",
		});
	}
	if (!authOk(req, env.MCP_CLIENT_TOKEN)) {
		return jsonResponse(401, { ok: false, error: "unauthorized" });
	}
	let body: any;
	try {
		body = await req.json();
	} catch {
		return jsonResponse(400, { ok: false, error: "request body must be JSON" });
	}

	switch (pathname) {
		case "/api/query": {
			if (!body?.query) return jsonResponse(400, { ok: false, error: "field 'query' required" });
			const result = await handleQueryCorpus(body, env);
			return jsonResponse(result.ok === false ? 502 : 200, result);
		}
		case "/api/capture": {
			if (!body?.claim || !body?.domain_primary)
				return jsonResponse(400, {
					ok: false,
					error: "fields 'claim' and 'domain_primary' required",
				});
			const result = await handleCaptureInsight(body, env);
			return jsonResponse(result.ok ? 200 : 502, result);
		}
		case "/api/search": {
			if (!body?.query) return jsonResponse(400, { ok: false, error: "field 'query' required" });
			const result = await handleSearchInsights(body, env);
			return jsonResponse(result.ok === false ? 502 : 200, result);
		}
		case "/api/approve": {
			if (!body?.insight_id || !body?.action)
				return jsonResponse(400, {
					ok: false,
					error: "fields 'insight_id' and 'action' required",
				});
			if (body.action !== "approve" && body.action !== "reject")
				return jsonResponse(400, {
					ok: false,
					error: "action must be 'approve' or 'reject'",
				});
			const result = await handleApproveInsight(body, env);
			return jsonResponse(result.ok === false ? 502 : 200, result);
		}
		case "/api/ingest-log": {
			const result = await handleIngestLog(body || {}, env);
			return jsonResponse(result.ok === false ? 502 : 200, result);
		}
		case "/api/article": {
			if (!body?.page_id)
				return jsonResponse(400, { ok: false, error: "field 'page_id' required" });
			const result = await handleArticle(body, env);
			const errStatus = (result as { status?: number }).status;
			return jsonResponse(result.ok === false ? (errStatus || 502) : 200, result);
		}
		case "/api/parking-lot-update": {
			if (!body?.page_id)
				return jsonResponse(400, { ok: false, error: "field 'page_id' required" });
			if (!body?.properties)
				return jsonResponse(400, { ok: false, error: "field 'properties' required" });
			const result = await handleParkingLotUpdate(body, env);
			const errStatus = (result as { status?: number }).status;
			return jsonResponse(result.ok === false ? (errStatus || 502) : 200, result);
		}
		case "/api/parking-lot-list": {
			const result = await handleParkingLotList(body || {}, env);
			const errStatus = (result as { status?: number }).status;
			return jsonResponse(result.ok === false ? (errStatus || 502) : 200, result);
		}
		case "/api/openai-classify": {
			const result = await handleOpenAIClassify(body || {}, env);
			const errStatus = (result as { status?: number }).status;
			return jsonResponse(result.ok === false ? (errStatus || 502) : 200, result);
		}
		case "/api/chat": {
			const result = await handleChat(body || {}, env);
			const errStatus = (result as { status?: number }).status;
			return jsonResponse(result.ok === false ? (errStatus || 502) : 200, result);
		}
		case "/api/rn-capture": {
			const result = await handleRnCapture(body || {}, env);
			const errStatus = (result as { status?: number }).status;
			return jsonResponse(result.ok === false ? (errStatus || 502) : 200, result);
		}
		case "/api/gap-capture": {
			const result = await handleGapCapture(body || {}, env, ctx);
			return jsonResponse(result.ok === false ? ((result as { status?: number }).status || 502) : 200, result);
		}
		case "/api/log-append": {
			const result = await handleLogAppend(body || {}, env);
			return jsonResponse(result.ok === false ? ((result as { status?: number }).status || 502) : 200, result);
		}
		case "/api/project-log-recent": {
			const result = await handleProjectLogRecent(body || {}, env);
			return jsonResponse(result.ok === false ? ((result as { status?: number }).status || 502) : 200, result);
		}
		case "/api/oq-create": {
			const result = await handleOqCreate(body || {}, env);
			const errStatus = (result as { status?: number }).status;
			return jsonResponse(result.ok === false ? (errStatus || 502) : 200, result);
		}
		case "/api/link-source": {
			const result = await handleLinkSource(body || {}, env);
			const errStatus = (result as { status?: number }).status;
			return jsonResponse(result.ok === false ? (errStatus || 502) : 200, result);
		}
		case "/api/openai-parse-rn": {
			const result = await handleOpenAIParseRn(body || {}, env);
			const errStatus = (result as { status?: number }).status;
			return jsonResponse(result.ok === false ? (errStatus || 502) : 200, result);
		}
		case "/api/tts": {
			const result = await handleTTS(body || {}, env);
			// handleTTS returns a Response directly on success (audio/mpeg), or a plain object on error
			if (result instanceof Response) return result;
			const errStatus = (result as { status?: number }).status;
			return jsonResponse((result as any).ok === false ? (errStatus || 502) : 200, result);
		}
		case "/api/tts-chunked": {
			const result = await handleTTSChunked(body || {}, env);
			if (result instanceof Response) return result;
			const errStatus = (result as { status?: number }).status;
			return jsonResponse((result as any).ok === false ? (errStatus || 502) : 200, result);
		}
		default:
			return jsonResponse(404, { ok: false, error: `unknown endpoint ${pathname}` });
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		// CORS preflight for all /api/* routes
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		// v5.2: nav pill injected into every surface so user can always jump.
		// Self-bootstrapping vanilla JS. Self-detects current path. Same classes
		// as the React NavMenu in /uc3 so styling is consistent.
		const NAV_INJECTION = `
<style>
.sn-pill{position:fixed;top:max(10px,env(safe-area-inset-top));right:max(10px,env(safe-area-inset-right));z-index:99999;display:inline-flex;align-items:center;gap:8px;padding:7px 12px 7px 10px;background:#fff;border:0.5px solid #e7e5dc;border-radius:999px;box-shadow:0 1px 3px rgba(0,0,0,0.06);font:600 12px/1 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#1f1d18;cursor:pointer}
.sn-pill-dot{width:6px;height:6px;border-radius:50%;background:#1f1d18}
.sn-pill-chev{font-size:10px;color:#888780;transition:transform .2s}
.sn-pill.sn-open .sn-pill-chev{transform:rotate(180deg)}
.sn-bd{position:fixed;inset:0;background:rgba(31,29,24,0.18);z-index:99998}
.sn-menu{position:fixed;top:max(54px,calc(env(safe-area-inset-top) + 44px));right:max(10px,env(safe-area-inset-right));z-index:99999;width:min(280px,calc(100vw - 20px));background:#fff;border:0.5px solid #e7e5dc;border-radius:14px;box-shadow:0 10px 30px rgba(31,29,24,0.18);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif}
.sn-mh{padding:10px 14px 8px;border-bottom:0.5px solid #e7e5dc;font:700 10px/1 ui-monospace,monospace;color:#888780;text-transform:uppercase;letter-spacing:0.06em}
.sn-mi{display:flex;align-items:center;gap:10px;padding:12px 14px;text-decoration:none;color:#1f1d18;border-bottom:0.5px solid #e7e5dc}
.sn-mi:last-child{border-bottom:none}
.sn-mi.sn-active{background:#1f1d18;color:#faf9f5}
.sn-mi.sn-active .sn-md{color:rgba(250,249,245,0.7)}
.sn-mic{font-size:18px;width:26px;text-align:center}
.sn-mt{flex:1}
.sn-mn{font-size:14px;font-weight:600;line-height:1.3}
.sn-md{font-size:11px;color:#888780;margin-top:1px}
.sn-arrow{color:#888780;font-size:12px}
@media print{.sn-pill,.sn-menu,.sn-bd{display:none!important}}
</style>
<script>
(function(){
  if(window.__spaceNavInjected)return;window.__spaceNavInjected=true;
  var T=[
    {id:'commute',n:'Commute',d:'Audio · listen + learn',i:'🎧',h:'/uc3'},
    {id:'desk',n:'Desk',d:'Today · inbox · captures',i:'🗂',h:'/desk'},
    {id:'reading',n:'Reading',d:'Deep read + annotation',i:'📖',h:'/reading'},
    {id:'corpus',n:'Corpus',d:'Search the knowledge base',i:'🔍',h:'/corpus'},
    {id:'insights',n:'Insights',d:'Approve or reject claims',i:'💎',h:'/insights'},
    {id:'posture',n:'Posture',d:'Three-domain balance',i:'📊',h:'/posture'},
    {id:'pipeline',n:'Pipeline',d:'Ingestion health',i:'🩺',h:'/pipeline'},
    {id:'log',n:'Build Log',d:'What shipped, what next',i:'📒',h:'/log'},
    {id:'map',n:'System map',d:'Five use cases · build tree',i:'🗺',h:'/system-map'}
  ];
  var p=location.pathname.replace(/\\/$/,'');
  var cur=T.find(function(t){return t.h===p;});
  function build(){
    var root=document.createElement('div');
    var pill=document.createElement('button');
    pill.className='sn-pill';
    pill.innerHTML='<span class="sn-pill-dot"></span><span>'+(cur?cur.n:'SpaceSC')+'</span><span class="sn-pill-chev">▼</span>';
    root.appendChild(pill);
    var bd=document.createElement('div');bd.className='sn-bd';bd.style.display='none';root.appendChild(bd);
    var menu=document.createElement('div');menu.className='sn-menu';menu.style.display='none';
    var hh='<div class="sn-mh">Jump to</div>';
    T.forEach(function(t){
      var active=cur && cur.id===t.id;
      hh+='<a class="sn-mi'+(active?' sn-active':'')+'" href="'+t.h+'"><span class="sn-mic">'+t.i+'</span><span class="sn-mt"><div class="sn-mn">'+t.n+'</div><div class="sn-md">'+t.d+'</div></span>'+(active?'':'<span class="sn-arrow">→</span>')+'</a>';
    });
    menu.innerHTML=hh;
    root.appendChild(menu);
    var open=false;
    function setOpen(v){open=v;pill.classList.toggle('sn-open',v);bd.style.display=v?'block':'none';menu.style.display=v?'block':'none';}
    pill.onclick=function(e){e.stopPropagation();setOpen(!open);};
    bd.onclick=function(){setOpen(false);};
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&open)setOpen(false);});
    document.body.appendChild(root);
  }
  if(document.body)build();else document.addEventListener('DOMContentLoaded',build);
})();
</script>
`;
		function injectNav(html: string): string {
			// Inject before </body>; fall back to append if no </body> (rare)
			const idx = html.lastIndexOf("</body>");
			if (idx < 0) return html + NAV_INJECTION;
			return html.slice(0, idx) + NAV_INJECTION + html.slice(idx);
		}

		// §8.4a.25 — universal feedback button. Injected on EVERY surface
		// (hand-coded React + v3-legacy bundles alike) so there is no surface
		// where the user can't capture. The asset is served at /feedback-button.js
		// (handled below) and the script tag is deferred so it doesn't block
		// initial paint. Defensive guard: only inject if the HTML doesn't
		// already reference it (e.g. if a surface explicitly embeds it).
		const FEEDBACK_INJECTION = `
<!-- §8.4a.25 universal feedback button — see worker/src/assets/feedback-button.js -->
<script src="/feedback-button.js" defer></script>
`;
		function injectFeedback(html: string): string {
			if (html.includes("/feedback-button.js")) return html;
			const idx = html.lastIndexOf("</body>");
			if (idx < 0) return html + FEEDBACK_INJECTION;
			return html.slice(0, idx) + FEEDBACK_INJECTION + html.slice(idx);
		}

		// Serve the feedback button asset itself. Public (no auth) so the
		// surfaces can <script src> it without credentials.
		if (url.pathname === "/feedback-button.js" && request.method === "GET") {
			return new Response(FEEDBACK_BUTTON_JS as string, {
				status: 200,
				headers: {
					"Content-Type": "application/javascript; charset=utf-8",
					"Cache-Control": "public, max-age=300",
					...CORS_HEADERS,
				},
			});
		}

		// UC3 Commute Player (v5.2 hand-coded) — has its own React NavMenu, no nav injection.
		// §8.4a.25: feedback button is injected universally on every surface including this one.
		if (url.pathname === "/uc3" || url.pathname === "/uc3/") {
			return new Response(injectFeedback(COMMUTE_PLAYER_HTML), {
				status: 200,
				headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" },
			});
		}

		// v5.2 + ADR-024: SpaceSC tool surfaces — each gets the nav pill injected.
		// New /desk (hand-coded v2) lands at /desk; classic reading workspace at /reading.
		// /desk is hand-coded with its own React NavMenu equivalent (so no inject) —
		// but for now we use the same vanilla injection for consistency. The other
		// hosted artifacts are bundled and need injection.
		const surfaceMap: Record<string, string> = {
			"/desk": DESK_HTML, "/desk/": DESK_HTML,
			"/reading": READING_HTML, "/reading/": READING_HTML,
			// Item 3 Phase 1 fallback: keep v3 reachable while the new
			// hand-coded /reading lacks the CurationChat panel.
			"/reading-v3-legacy": READING_V3_LEGACY_HTML, "/reading-v3-legacy/": READING_V3_LEGACY_HTML,
			"/corpus": CORPUS_HTML, "/corpus/": CORPUS_HTML,
			"/corpus-v3-legacy": CORPUS_V3_LEGACY_HTML, "/corpus-v3-legacy/": CORPUS_V3_LEGACY_HTML,
			"/insights": INSIGHTS_HTML, "/insights/": INSIGHTS_HTML,
			"/insights-v3-legacy": INSIGHTS_V3_LEGACY_HTML, "/insights-v3-legacy/": INSIGHTS_V3_LEGACY_HTML,
			"/posture": POSTURE_HTML, "/posture/": POSTURE_HTML,
			"/posture-v3-legacy": POSTURE_V3_LEGACY_HTML, "/posture-v3-legacy/": POSTURE_V3_LEGACY_HTML,
			"/pipeline": PIPELINE_HTML, "/pipeline/": PIPELINE_HTML,
			"/pipeline-v3-legacy": PIPELINE_V3_LEGACY_HTML, "/pipeline-v3-legacy/": PIPELINE_V3_LEGACY_HTML,
			"/log": BUILDLOG_HTML, "/log/": BUILDLOG_HTML,
			"/log-v3-legacy": BUILDLOG_V3_LEGACY_HTML, "/log-v3-legacy/": BUILDLOG_V3_LEGACY_HTML,
			"/system-map": SYSTEM_MAP_HTML, "/system-map/": SYSTEM_MAP_HTML,
			"/feedback": FEEDBACK_HTML, "/feedback/": FEEDBACK_HTML,
		};
		// Hand-coded surfaces already embed their own React NavMenu — skipping
		// injectNav() prevents the double-pill stacking the reviewer caught on
		// /corpus (same defect was live on /desk, /reading, /insights since
		// each was built; pre-existing comment in this file at the surfaceMap
		// declaration acknowledged the duplication as a known compromise).
		const HAND_CODED_NO_INJECT = new Set([
			"/desk", "/desk/",
			"/reading", "/reading/",
			"/corpus", "/corpus/",
			"/insights", "/insights/",
			"/posture", "/posture/",
			"/pipeline", "/pipeline/",
			"/log", "/log/",
			"/system-map", "/system-map/",
			"/feedback", "/feedback/",
		]);
		const surfaceHtml = surfaceMap[url.pathname];
		if (surfaceHtml) {
			const navInjected = HAND_CODED_NO_INJECT.has(url.pathname)
				? surfaceHtml
				: injectNav(surfaceHtml);
			// §8.4a.25 — feedback button on EVERY surface, hand-coded or v3-legacy alike.
			const body = injectFeedback(navInjected);
			return new Response(body, {
				status: 200,
				headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" },
			});
		}

		// TTS cache routes (GET/PUT) — handled before the POST-only /api router
		if (url.pathname.startsWith("/api/tts-cache/")) {
			if (request.method === "GET") return handleTTSCacheGet(request, env, url);
			if (request.method === "PUT") return handleTTSCachePut(request, env, url);
			return new Response(JSON.stringify({ ok: false, error: "method not allowed" }), {
				status: 405, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
			});
		}

		// §8.4a.21 W6 — brief audio is a PUBLIC stream (no bearer auth) so it
		// can be opened directly in Safari/Files on phone. Mirrors how the
		// Commute Player accesses /api/tts-cache/* without an Authorization
		// header. Handled BEFORE the bearer-auth gate for /api/uc3/*.
		// Item 2D: /api/uc3/briefing-audio is public (no bearer) so the
		// player's <audio> element can stream it directly like module-audio.
		if (url.pathname === "/api/uc3/briefing-audio" && request.method === "GET") {
			return await handleUc3BriefingAudio(url, env);
		}
		if (url.pathname === "/api/uc3/brief-audio" && request.method === "GET") {
			return await handleUc3BriefAudio(url, env);
		}

		// §8.4a.21 W8 — full-module audio is also a PUBLIC stream, mirroring brief-audio.
		if (url.pathname === "/api/uc3/module-audio" && request.method === "GET") {
			return await handleUc3ModuleAudio(url, env);
		}

		// §8.4a.21 W4 — UC3 pipeline routes (mixed methods, handled before POST-only /api router)
		if (url.pathname.startsWith("/api/uc3/")) {
			if (!env.MCP_CLIENT_TOKEN) {
				return jsonResponse(500, { ok: false, error: "server misconfigured: MCP_CLIENT_TOKEN missing" });
			}
			if (!authOk(request, env.MCP_CLIENT_TOKEN)) {
				return jsonResponse(401, { ok: false, error: "unauthorized" });
			}
			if (url.pathname === "/api/uc3/pipeline-run" && request.method === "POST") {
				const body = (await request.json().catch(() => ({}))) as { gap_id?: string };
				const result = await handleUc3PipelineRun(body, env);
				return jsonResponse(result.ok ? 200 : (result.status || 502), result);
			}
			if (url.pathname === "/api/uc3/pipeline-cancel" && request.method === "DELETE") {
				const result = await handleUc3PipelineCancel(url, env);
				return jsonResponse(result.ok ? 200 : (result.status || 502), result);
			}
			if (url.pathname === "/api/uc3/pipeline-status" && request.method === "GET") {
				const result = (await handleUc3PipelineStatus(url, env)) as { ok: boolean; status?: number };
				return jsonResponse(result.ok ? 200 : (result.status || 502), result);
			}
			if (url.pathname === "/api/uc3/module-revise" && request.method === "POST") {
				const body = (await request.json().catch(() => ({}))) as { module_id?: number };
				const result = await handleUc3ModuleRevise(body, env);
				return jsonResponse(result.ok ? 200 : (result.status || 502), result);
			}
			if (url.pathname === "/api/uc3/module-brief" && request.method === "POST") {
				const body = (await request.json().catch(() => ({}))) as { module_id?: number };
				const result = await handleUc3ModuleBrief(body, env);
				return jsonResponse(result.ok ? 200 : (result.status || 502), result);
			}
			if (url.pathname === "/api/uc3/module-feedback" && request.method === "POST") {
				const body = (await request.json().catch(() => ({}))) as { module_id?: number; voice_transcript?: string };
				const result = await handleUc3ModuleFeedback(body, env, ctx);
				return jsonResponse(result.ok ? 200 : (result.status || 502), result);
			}
			if (url.pathname === "/api/uc3/module-approve" && request.method === "POST") {
				const body = (await request.json().catch(() => ({}))) as { module_id?: number };
				const result = await handleUc3ModuleApprove(body, env, ctx);
				return jsonResponse(result.ok ? 200 : (result.status || 502), result);
			}
			// §8.4a.21 W8 — additional UC3 routes
			if (url.pathname === "/api/uc3/module-tts" && request.method === "POST") {
				const body = (await request.json().catch(() => ({}))) as { module_id?: number };
				const result = await handleUc3ModuleTts(body, env);
				return jsonResponse(result.ok ? 200 : (result.status || 502), result);
			}
			if (url.pathname === "/api/uc3/module-errata-create" && request.method === "POST") {
				const body = (await request.json().catch(() => ({}))) as {
					module_id?: number; claim_id?: number | null; timestamp_seconds?: number | null; notes?: string;
				};
				if (typeof body.notes !== "string") {
					return jsonResponse(400, { ok: false, error: "field 'notes' (string) required" });
				}
				const result = await handleUc3ModuleErrataCreate(body as any, env);
				return jsonResponse(result.ok ? 200 : (result.status || 502), result);
			}
			if (url.pathname === "/api/uc3/module-errata-list" && request.method === "GET") {
				const result = await handleUc3ModuleErrataList(url, env);
				return jsonResponse(result.ok ? 200 : (result.status || 502), result);
			}
			if (url.pathname === "/api/uc3/spaced-rep-due" && request.method === "GET") {
				const result = await handleUc3SpacedRepDue(url, env);
				return jsonResponse(result.ok ? 200 : (result.status || 502), result);
			}
			if (url.pathname === "/api/uc3/list-briefs-ready" && request.method === "GET") {
				const result = (await handleUc3ListBriefsReady(url, env)) as { ok: boolean; status?: number };
				return jsonResponse(result.ok === false ? (result.status || 502) : 200, result);
			}
			if (url.pathname === "/api/uc3/captures-today" && request.method === "GET") {
				const result = (await handleUc3CapturesToday(url, env)) as { ok: boolean; status?: number };
				return jsonResponse(result.ok === false ? (result.status || 502) : 200, result);
			}
			// Item 2D: daily-briefing endpoints.
			if (url.pathname === "/api/uc3/today-briefing" && request.method === "GET") {
				const result = (await handleUc3TodayBriefing(url, env)) as { ok: boolean; status?: number };
				return jsonResponse(result.ok === false ? (result.status || 502) : 200, result);
			}
			if (url.pathname === "/api/uc3/daily-briefing-generate" && request.method === "POST") {
				const body = (await request.json().catch(() => ({}))) as { async?: boolean };
				const result = (await handleUc3DailyBriefingGenerate(body || {}, env, ctx)) as { ok: boolean; status?: number };
				return jsonResponse(result.ok === false ? (result.status || 502) : (result.status || 200), result);
			}
			if (url.pathname === "/api/uc3/list-gaps" && request.method === "GET") {
				const result = await handleUc3ListGaps(url, env);
				return jsonResponse(result.ok ? 200 : (result.status || 502), result);
			}
			if (url.pathname === "/api/uc3/spaced-rep-mark-listened" && request.method === "POST") {
				const body = (await request.json().catch(() => ({}))) as { module_id?: number };
				const result = await handleUc3SpacedRepMarkListened(body, env);
				return jsonResponse(result.ok ? 200 : (result.status || 502), result);
			}
			// brief-audio + module-audio handled above (public streams, no auth)
			return jsonResponse(405, { ok: false, error: "method not allowed for this /api/uc3/* route" });
		}

		// §8.4a.25 — universal feedback button + adversarial UAT loop routes
		if (url.pathname.startsWith("/api/feedback-") || url.pathname.startsWith("/api/blindspot")) {
			if (!env.MCP_CLIENT_TOKEN) {
				return jsonResponse(500, { ok: false, error: "server misconfigured: MCP_CLIENT_TOKEN missing" });
			}
			if (!authOk(request, env.MCP_CLIENT_TOKEN)) {
				return jsonResponse(401, { ok: false, error: "unauthorized" });
			}
			if (url.pathname === "/api/feedback-capture" && request.method === "POST") {
				const body = (await request.json().catch(() => ({}))) as Parameters<typeof handleFeedbackCapture>[0];
				const result = await handleFeedbackCapture(body, env, ctx);
				return jsonResponse(result.ok ? (result.status || 200) : (result.status || 502), result);
			}
			if (url.pathname === "/api/feedback-list" && request.method === "GET") {
				const result = await handleFeedbackList(url, env);
				return jsonResponse(result.ok ? (result.status || 200) : (result.status || 502), result);
			}
			if (url.pathname === "/api/feedback-resolve" && request.method === "POST") {
				const body = (await request.json().catch(() => ({}))) as { id?: number; status?: string; resolution_note?: string };
				const result = await handleFeedbackResolve(body, env);
				return jsonResponse(result.ok ? (result.status || 200) : (result.status || 502), result);
			}
			if (url.pathname === "/api/blindspots-list" && request.method === "GET") {
				const result = await handleBlindspotsList(url, env);
				return jsonResponse(result.ok ? (result.status || 200) : (result.status || 502), result);
			}
			if (url.pathname === "/api/blindspot-reanalyze" && request.method === "POST") {
				const body = (await request.json().catch(() => ({}))) as { feedback_id?: number };
				const result = await handleBlindspotReanalyze(body, env);
				return jsonResponse(result.ok ? (result.status || 200) : (result.status || 502), result);
			}
			if (url.pathname === "/api/blindspot-resolve" && request.method === "POST") {
				const body = (await request.json().catch(() => ({}))) as { id?: number; status?: string; resolution_note?: string; applied_to_adr?: string };
				const result = await handleBlindspotResolve(body, env);
				return jsonResponse(result.ok ? (result.status || 200) : (result.status || 502), result);
			}
			// §8.4a.25c — auto-fix loop
			if (url.pathname === "/api/feedback-propose-fix" && request.method === "POST") {
				const body = (await request.json().catch(() => ({}))) as { feedback_id?: number };
				const result = await handleFeedbackProposeFix(body, env);
				return jsonResponse(result.ok ? (result.status || 200) : (result.status || 502), result);
			}
			if (url.pathname === "/api/feedback-apply" && request.method === "POST") {
				const body = (await request.json().catch(() => ({}))) as { feedback_id?: number };
				const result = await handleFeedbackApply(body, env);
				return jsonResponse(result.ok ? (result.status || 200) : (result.status || 502), result);
			}
			if (url.pathname === "/api/feedback-fix-status" && request.method === "GET") {
				const result = await handleFeedbackFixStatus(url, env);
				return jsonResponse(result.ok ? (result.status || 200) : (result.status || 502), result);
			}
			if (url.pathname === "/api/feedback-fixes-pending" && request.method === "GET") {
				const result = await handleFeedbackFixesPending(url, env);
				return jsonResponse(result.ok ? (result.status || 200) : (result.status || 502), result);
			}
			if (url.pathname === "/api/feedback-fix-callback" && request.method === "POST") {
				const body = (await request.json().catch(() => ({}))) as Parameters<typeof handleFeedbackFixCallback>[0];
				const result = await handleFeedbackFixCallback(body, env);
				return jsonResponse(result.ok ? (result.status || 200) : (result.status || 502), result);
			}
			return jsonResponse(405, { ok: false, error: "method not allowed for this /api/feedback-* or /api/blindspot-* route" });
		}

		// /api/* routes for Live Artifacts (bearer-auth + CORS)
		const apiResp = await handleApiRoute(url.pathname, request, env, ctx);
		if (apiResp) return apiResp;

		// MCP protocol routes
		if (url.pathname === "/mcp") {
			return SpaceSCMCP.serve("/mcp").fetch(request, env, ctx);
		}
		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return SpaceSCMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		return new Response(
			"SpaceSC MCP server. Endpoints: /mcp (Streamable HTTP), /sse (legacy), /api/{query,capture,search,approve,ingest-log,article,parking-lot-update,parking-lot-list,openai-classify,chat,rn-capture,gap-capture,log-append,project-log-recent,oq-create,link-source,openai-parse-rn,tts,tts-chunked} (POST, bearer auth), /api/tts-cache/{page_id} (GET/PUT, bearer auth), /api/uc3/{pipeline-run (POST), pipeline-cancel (DELETE), pipeline-status (GET), module-revise (POST), module-brief (POST), module-feedback (POST), module-tts (POST), module-errata-create (POST), module-errata-list (GET), spaced-rep-due (GET), spaced-rep-mark-listened (POST)} (bearer auth), /api/uc3/{brief-audio,module-audio} (GET, public), /uc3 (UC3 Commute Player v2.3 standalone, public). MCP tools: query_corpus, capture_insight, search_insights, approve_insight, search_modules. Queue consumer: uc3-s5-section-drafting.",
			{ status: 200 },
		);
	},
	async queue(batch: MessageBatch<S5DraftMessage | ModuleTtsMessage>, env: Env) {
		// Route by queue name. Each queue has a distinct message shape;
		// the consumer for each handles its own dispatch + ack/retry semantics.
		if (batch.queue === "uc3-s5-section-drafting") {
			await handleS5Queue(batch as MessageBatch<S5DraftMessage>, env);
		} else if (batch.queue === "uc3-module-tts") {
			await handleModuleTtsQueue(batch as MessageBatch<ModuleTtsMessage>, env);
		} else {
			console.error(`queue dispatcher: unknown queue ${batch.queue}`);
		}
	},
	// Cron dispatcher (§8.4a.25c). Routes by cron expression:
	//   - "0 11 * * *"  → daily briefing
	//   - "*/2 * * * *" → feedback-fix queue drain (Cloudflare-side, reliable)
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		if (event.cron === "0 11 * * *") {
			ctx.waitUntil(
				generateDailyBriefing(env).then((r) => {
					if (r.ok) {
						console.log(`daily-briefing ${r.briefing_date} ready (${r.audio_bytes} bytes, ${r.source_summary?.ingest_count ?? 0} ingests, ${r.source_summary?.insight_count ?? 0} insights)`);
					} else {
						console.error(`daily-briefing ${r.briefing_date} FAILED: ${r.error}`);
					}
				}).catch((err) => {
					console.error("daily-briefing cron unexpected:", (err as Error).message);
				}),
			);
		} else if (event.cron === "*/2 * * * *") {
			ctx.waitUntil(drainFeedbackFixQueue(env));
		} else {
			console.warn(`scheduled: unknown cron expression "${event.cron}"`);
		}
	},
};

// §8.4a.25c — feedback-fix queue drain. Cloudflare cron fires this every 2 min,
// reliably (GitHub free-tier schedule trigger doesn't fire reliably).
async function drainFeedbackFixQueue(env: Env): Promise<void> {
	if (!env.GITHUB_TOKEN) {
		console.warn("drainFeedbackFixQueue: GITHUB_TOKEN missing; skipping");
		return;
	}
	const owner = env.GITHUB_OWNER || "rynwpftgy5-hash";
	const repo = env.GITHUB_REPO || "Sc-build";
	const row = await env.UC3_DB
		.prepare(
			`SELECT id, feedback_id, status, pr_number FROM feedback_fixes
			 WHERE status IN ('pending','apply-requested')
			 ORDER BY created_at ASC LIMIT 1`,
		)
		.first<{ id: number; feedback_id: number; status: string; pr_number: number | null }>();
	if (!row) {
		console.log("drain: queue empty");
		return;
	}
	const mode = row.status === "apply-requested" ? "apply" : "propose";
	const inputs: Record<string, string> = {
		feedback_id: String(row.feedback_id),
		fix_id: String(row.id),
		mode,
	};
	if (mode === "apply" && row.pr_number != null) {
		inputs.pr_number = String(row.pr_number);
	}
	const resp = await fetch(
		`https://api.github.com/repos/${owner}/${repo}/actions/workflows/feedback-fix.yml/dispatches`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.GITHUB_TOKEN}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": "spacesc-cron-drain/1.0",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ ref: "main", inputs }),
		},
	);
	if (resp.ok) {
		const nextStatus = mode === "apply" ? "applying" : "proposing";
		await env.UC3_DB
			.prepare(`UPDATE feedback_fixes SET status = ? WHERE id = ?`)
			.bind(nextStatus, row.id)
			.run();
		console.log(`drain: dispatched ${mode} for feedback ${row.feedback_id} (fix ${row.id})`);
	} else {
		const txt = (await resp.text()).slice(0, 300);
		console.error(`drain: dispatch failed ${resp.status}: ${txt}`);
	}
}
