// §8.4a.21 W4 — REST handlers for UC3 Fundamentals pipeline.
// - POST   /api/uc3/pipeline-run     {gap_id}             — manual trigger / re-run
// - DELETE /api/uc3/pipeline-cancel  ?gap_id=…            — terminate running instance
// - GET    /api/uc3/pipeline-status  ?gap_id=…[&trail=1]  — inspect pipeline + module state

import {
	getPipelineState,
	listModulesByGap,
	listCitationsByModule,
	listAnalogsByModule,
	listVerificationByGap,
	listSectionsByModule,
	listClaimsByModule,
	listVerificationPassesByModule,
	listBriefsByGap,
	insertFeedback,
	updateFeedbackParsed,
	updateFeedbackDispatch,
	markFeedbackFailed,
} from "../lib/d1-uc3";
import { getTranscript } from "../lib/r2-transcripts";
import { getBriefAudio } from "../lib/r2-briefs";
import { getModuleAudio } from "../lib/r2-modules";
import { reviseModule, type ReviseModuleResult } from "../lib/revise-module";
import { generateBrief } from "../lib/review-brief";
import { generateModuleAudio, type ModuleAudioResult } from "../lib/module-audio";
import { createErrata, listErrata, type CreateErrataInput } from "../lib/module-errata";
import { listDueRows, markNextListened } from "../lib/spaced-rep";
import { parseFeedback } from "../lib/feedback-parser";
import { dispatchFeedback } from "../lib/feedback-dispatch";

export interface Uc3HandlerEnv {
	UC3_DB: D1Database;
	UC3_PIPELINE: Workflow;
	TTS_CACHE: R2Bucket;
	ANTHROPIC_API_KEY: string;
	ELEVENLABS_API_KEY: string;
	ELEVENLABS_DEFAULT_VOICE_ID?: string;
	// §8.4a.21 W8 additions
	NOTION_TOKEN: string;
	MODULE_ERRATA_DB_ID?: string;
	// §8.4a.21 W8.1 additions
	MODULE_TTS_QUEUE: Queue<import("../lib/queues").ModuleTtsMessage>;
}

export async function handleUc3ModuleBrief(
	body: { module_id?: number },
	env: Uc3HandlerEnv,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	if (!body?.module_id || typeof body.module_id !== "number") {
		return { ok: false, status: 400, error: "field 'module_id' (number) required" };
	}
	try {
		const result = await generateBrief(env, body.module_id);
		return { ok: result.ok, status: result.ok ? 200 : 502, result };
	} catch (err) {
		return { ok: false, status: 502, error: `brief generation failed: ${(err as Error).message}` };
	}
}

export async function handleUc3BriefAudio(url: URL, env: Uc3HandlerEnv): Promise<Response> {
	const moduleIdStr = url.searchParams.get("module_id");
	if (!moduleIdStr) {
		return new Response(JSON.stringify({ ok: false, error: "query param 'module_id' required" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}
	const module_id = Number.parseInt(moduleIdStr, 10);
	if (!Number.isFinite(module_id)) {
		return new Response(JSON.stringify({ ok: false, error: "'module_id' must be an integer" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}
	const obj = await getBriefAudio(env.TTS_CACHE, module_id);
	if (!obj) {
		return new Response(JSON.stringify({ ok: false, error: `no brief audio for module ${module_id}` }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	}
	return new Response(obj.body, {
		status: 200,
		headers: {
			"Content-Type": "audio/mpeg",
			"Cache-Control": "private, max-age=3600",
		},
	});
}

export async function handleUc3ModuleRevise(
	body: { module_id?: number },
	env: Uc3HandlerEnv,
): Promise<{ ok: boolean; status?: number; result?: ReviseModuleResult; error?: string }> {
	if (!body?.module_id || typeof body.module_id !== "number") {
		return { ok: false, status: 400, error: "field 'module_id' (number) required" };
	}
	try {
		const result = await reviseModule(env, body.module_id);
		return { ok: result.ok, status: result.ok ? 200 : 502, result };
	} catch (err) {
		return { ok: false, status: 502, error: `revise failed: ${(err as Error).message}` };
	}
}

// §8.4a.21 v5 player — POST /api/uc3/module-approve {module_id}
// Quick-approve path: skips S9 NLU parsing. Calls doApprove-equivalent logic
// directly. Fires the W8.1 queue auto-fire-on-approve same as the voice-feedback
// path. ~500ms response vs ~3-5s for /api/uc3/module-feedback with "approve".
export async function handleUc3ModuleApprove(
	body: { module_id?: number },
	env: Uc3HandlerEnv,
	ctx?: ExecutionContext,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	if (!body?.module_id || typeof body.module_id !== "number") {
		return { ok: false, status: 400, error: "field 'module_id' (number) required" };
	}
	const module_id = body.module_id;
	try {
		const now = Math.floor(Date.now() / 1000);
		// 1. Flip status to approved.
		await env.UC3_DB
			.prepare("UPDATE learning_modules SET status = 'approved', approved_at = ? WHERE id = ?")
			.bind(now, module_id)
			.run();
		// 2. Log the action.
		await env.UC3_DB
			.prepare(
				`INSERT INTO verification_trail (module_id, stage, response_json, ok, decided_at)
				 VALUES (?, 'quick-approve', ?, 1, ?)`,
			)
			.bind(module_id, JSON.stringify({ source: "player-v5-quick-approve" }), now)
			.run();
		// 3. Side effects via ctx.waitUntil:
		//    - Queue full-module TTS via MODULE_TTS_QUEUE (W8.1 reliability fix)
		//    - Insert spaced-rep schedule rows (idempotent)
		const side_effects: string[] = [];
		try {
			await env.MODULE_TTS_QUEUE.send({ module_id, source: "approve" });
			side_effects.push("module-audio queued");
		} catch (err) {
			console.error("module-approve: queue.send failed:", (err as Error).message);
		}
		if (ctx) {
			ctx.waitUntil(
				(async () => {
					// scheduleApprovedModule mimic — inline to avoid lib import cycle.
					const DAY_S = 86_400;
					const cadences: Array<{ label: string; offset: number }> = [
						{ label: "+3d", offset: 3 * DAY_S },
						{ label: "+1w", offset: 7 * DAY_S },
						{ label: "+3w", offset: 21 * DAY_S },
					];
					const existing = await env.UC3_DB
						.prepare("SELECT COUNT(*) AS n FROM spaced_rep_schedule WHERE module_id = ?")
						.bind(module_id)
						.first<{ n: number }>();
					if ((existing?.n ?? 0) === 0) {
						for (const c of cadences) {
							await env.UC3_DB
								.prepare(
									`INSERT INTO spaced_rep_schedule (module_id, due_at, cadence, fired, created_at)
									 VALUES (?, ?, ?, 0, ?)`,
								)
								.bind(module_id, now + c.offset, c.label, now)
								.run();
						}
					}
				})().catch((e) => console.error("spaced-rep schedule failed:", (e as Error).message)),
			);
			side_effects.push("spaced-rep scheduled");
		}
		return {
			ok: true,
			status: 200,
			result: { module_id, new_status: "approved", side_effects },
		};
	} catch (err) {
		return { ok: false, status: 502, error: `quick-approve failed: ${(err as Error).message}` };
	}
}

// §8.4a.21 W8 — POST /api/uc3/module-tts {module_id, async?} — manual full-module TTS trigger.
// async=true pushes to MODULE_TTS_QUEUE and returns immediately (used by the
// player's retry button, which doesn't want to block ~2min on the response).
// Default behavior is synchronous for backward compat with debug paths.
export async function handleUc3ModuleTts(
	body: { module_id?: number; async?: boolean },
	env: Uc3HandlerEnv,
): Promise<{ ok: boolean; status?: number; result?: ModuleAudioResult | { module_id: number; queued: true }; error?: string }> {
	if (!body?.module_id || typeof body.module_id !== "number") {
		return { ok: false, status: 400, error: "field 'module_id' (number) required" };
	}
	if (body.async === true) {
		try {
			await env.MODULE_TTS_QUEUE.send({ module_id: body.module_id, source: "manual-retry" });
			return { ok: true, status: 202, result: { module_id: body.module_id, queued: true } };
		} catch (err) {
			return { ok: false, status: 502, error: `module-tts queue send failed: ${(err as Error).message}` };
		}
	}
	try {
		const result = await generateModuleAudio(env, body.module_id);
		return { ok: result.ok, status: result.ok ? 200 : 502, result };
	} catch (err) {
		return { ok: false, status: 502, error: `module-tts failed: ${(err as Error).message}` };
	}
}

// §8.4a.21 W8 — GET /api/uc3/module-audio?module_id=X — public MP3 stream.
export async function handleUc3ModuleAudio(url: URL, env: Uc3HandlerEnv): Promise<Response> {
	const moduleIdStr = url.searchParams.get("module_id");
	if (!moduleIdStr) {
		return new Response(JSON.stringify({ ok: false, error: "query param 'module_id' required" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}
	const module_id = Number.parseInt(moduleIdStr, 10);
	if (!Number.isFinite(module_id)) {
		return new Response(JSON.stringify({ ok: false, error: "'module_id' must be an integer" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}
	const obj = await getModuleAudio(env.TTS_CACHE, module_id);
	if (!obj) {
		return new Response(JSON.stringify({ ok: false, error: `no module audio for module ${module_id}` }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	}
	return new Response(obj.body, {
		status: 200,
		headers: {
			"Content-Type": "audio/mpeg",
			"Cache-Control": "private, max-age=3600",
		},
	});
}

// §8.4a.21 W8 — POST /api/uc3/module-errata-create
export async function handleUc3ModuleErrataCreate(
	body: CreateErrataInput,
	env: Uc3HandlerEnv,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	if (!body?.module_id || typeof body.module_id !== "number") {
		return { ok: false, status: 400, error: "field 'module_id' (number) required" };
	}
	if (!body?.notes || typeof body.notes !== "string" || !body.notes.trim()) {
		return { ok: false, status: 400, error: "field 'notes' (non-empty string) required" };
	}
	try {
		const result = await createErrata(env, body);
		return { ok: result.ok, status: result.ok ? 200 : 502, result };
	} catch (err) {
		return { ok: false, status: 502, error: `errata-create failed: ${(err as Error).message}` };
	}
}

// §8.4a.21 W8 — GET /api/uc3/module-errata-list?status=open&module_id=82
export async function handleUc3ModuleErrataList(
	url: URL,
	env: Uc3HandlerEnv,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	const status = url.searchParams.get("status") ?? undefined;
	const moduleIdStr = url.searchParams.get("module_id");
	const filter: { module_id?: number; status?: string } = {};
	if (moduleIdStr) {
		const n = Number.parseInt(moduleIdStr, 10);
		if (Number.isFinite(n)) filter.module_id = n;
	}
	if (status) filter.status = status;
	try {
		const rows = await listErrata(env.UC3_DB, filter);
		return { ok: true, status: 200, result: { errata: rows, count: rows.length } };
	} catch (err) {
		return { ok: false, status: 502, error: `errata-list failed: ${(err as Error).message}` };
	}
}

// §8.4a.23 — GET /api/uc3/list-gaps
// Returns all distinct gap_ids with HUMAN-READABLE title + status summary so
// the v3 UI can auto-discover series. gap_title is sourced from
// pipeline_state.gap_title (populated at S0 since the W9 UX fix); for legacy
// gaps without it persisted, lazily fetch from the Notion Learning Gaps Queue
// in a single batched call and backfill D1 so subsequent calls are fast.
const LEARNING_GAPS_QUEUE_DB_ID = "35ebac9a-7841-41bc-91fd-224b58feb9a3";

async function fetchAllNotionGapTitles(notionToken: string): Promise<Map<string, { title: string; fullId: string }>> {
	const map = new Map<string, { title: string; fullId: string }>();
	let next: string | null | undefined = undefined;
	while (true) {
		const body: Record<string, unknown> = { page_size: 100, sorts: [{ timestamp: "created_time", direction: "descending" }] };
		if (next) body.start_cursor = next;
		const resp = await fetch(`https://api.notion.com/v1/databases/${LEARNING_GAPS_QUEUE_DB_ID}/query`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${notionToken}`,
				"Notion-Version": "2022-06-28",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(20_000),
		});
		if (!resp.ok) break;
		const json = (await resp.json()) as { results?: Array<{ id: string; properties?: any }>; has_more?: boolean; next_cursor?: string | null };
		for (const r of json.results ?? []) {
			const fullId = String(r.id);
			const shortId = fullId.replace(/-/g, "").slice(-8);
			const titleArr = r.properties?.["Gap Title"]?.title || [];
			const title = titleArr.map((t: any) => t.plain_text || "").join("").trim();
			if (title) map.set(shortId, { title, fullId });
		}
		if (!json.has_more || !json.next_cursor) break;
		next = json.next_cursor;
	}
	return map;
}

export async function handleUc3ListGaps(
	_url: URL,
	env: Uc3HandlerEnv,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	try {
		const r = await env.UC3_DB
			.prepare(
				`SELECT lm.gap_id,
				        COUNT(*) AS module_count,
				        SUM(CASE WHEN lm.status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
				        SUM(CASE WHEN lm.status = 'review-brief-pending' THEN 1 ELSE 0 END) AS pending_count,
				        SUM(CASE WHEN lm.status = 'revision-requested' THEN 1 ELSE 0 END) AS revision_count,
				        SUM(CASE WHEN lm.audio_r2_key IS NOT NULL THEN 1 ELSE 0 END) AS audio_ready_count,
				        SUM(CASE WHEN lm.transcript_r2_key IS NOT NULL THEN 1 ELSE 0 END) AS transcript_ready_count,
				        MIN(lm.created_at) AS first_created_at,
				        MAX(lm.created_at) AS last_created_at,
				        (SELECT learning_objective FROM learning_modules WHERE gap_id = lm.gap_id ORDER BY position_in_series ASC LIMIT 1) AS first_module_objective,
				        (SELECT stage FROM pipeline_state WHERE gap_id = lm.gap_id) AS pipeline_stage,
				        (SELECT status FROM pipeline_state WHERE gap_id = lm.gap_id) AS pipeline_status,
				        (SELECT gap_title FROM pipeline_state WHERE gap_id = lm.gap_id) AS gap_title,
				        (SELECT COUNT(*) FROM review_briefs rb JOIN learning_modules lm2 ON rb.module_id = lm2.id WHERE lm2.gap_id = lm.gap_id AND rb.audio_r2_key IS NOT NULL) AS brief_audio_ready_count
				 FROM learning_modules lm
				 GROUP BY lm.gap_id
				 ORDER BY MAX(lm.created_at) DESC`,
			)
			.all<{
				gap_id: string;
				module_count: number;
				approved_count: number;
				pending_count: number;
				revision_count: number;
				audio_ready_count: number;
				transcript_ready_count: number;
				first_created_at: number;
				last_created_at: number;
				first_module_objective: string | null;
				pipeline_stage: string | null;
				pipeline_status: string | null;
				gap_title: string | null;
				brief_audio_ready_count: number;
			}>();
		const rows = r.results ?? [];

		// Lazy backfill: if any rows have NULL gap_title, fetch all titles from
		// Notion once and patch them. The Learning Gaps Queue is small (<50 rows)
		// so a single paginated query is bounded. D3: also persists notion_page_id
		// so pipeline-status can emit a gap-specific deep link.
		const needsTitle = rows.filter((row) => !row.gap_title);
		if (needsTitle.length > 0 && env.NOTION_TOKEN) {
			try {
				const titles = await fetchAllNotionGapTitles(env.NOTION_TOKEN);
				for (const row of needsTitle) {
					const t = titles.get(row.gap_id);
					if (t) {
						row.gap_title = t.title;
						await env.UC3_DB
							.prepare(
								`INSERT INTO pipeline_state (gap_id, stage, status, retry_count, started_at, updated_at, gap_title, notion_page_id)
								 VALUES (?, COALESCE((SELECT stage FROM pipeline_state WHERE gap_id = ?), 'S0'), COALESCE((SELECT status FROM pipeline_state WHERE gap_id = ?), 'completed'), 0, ?, ?, ?, ?)
								 ON CONFLICT(gap_id) DO UPDATE SET gap_title = excluded.gap_title, notion_page_id = excluded.notion_page_id, updated_at = excluded.updated_at`,
							)
							.bind(row.gap_id, row.gap_id, row.gap_id, row.first_created_at, Math.floor(Date.now() / 1000), t.title, t.fullId)
							.run();
					}
				}
			} catch (e) {
				console.error("list-gaps: Notion title backfill failed:", (e as Error).message);
			}
		}

		const augmented = rows.map((row) => ({
			gap_id: row.gap_id,
			gap_title: row.gap_title ?? row.first_module_objective ?? "(untitled gap)",
			first_module_objective: row.first_module_objective,
			module_count: row.module_count,
			approved_count: row.approved_count,
			pending_count: row.pending_count,
			revision_count: row.revision_count,
			brief_audio_ready_count: row.brief_audio_ready_count,
			full_audio_ready_count: row.audio_ready_count,
			transcript_ready_count: row.transcript_ready_count,
			pipeline_stage: row.pipeline_stage,
			pipeline_status: row.pipeline_status,
			first_created_at: row.first_created_at,
			last_created_at: row.last_created_at,
		}));
		return { ok: true, status: 200, result: { gaps: augmented, count: augmented.length } };
	} catch (err) {
		return { ok: false, status: 502, error: `list-gaps failed: ${(err as Error).message}` };
	}
}

// D2 — GET /api/uc3/captures-today
// Cross-source aggregator: every capture (errata + gap + OQ) created in the
// last 24h, returned as a chronological timeline. Lets the player Captures
// tab show inline what you captured today without making the user leave the
// surface to verify it landed. Insights + RNs live on the il-server Mac path
// today; they're surfaced as deep links rather than inlined, to keep this
// endpoint cloud-only and fast.
const NOTION_LEARNING_GAPS_QUEUE_DB = "35ebac9a-7841-41bc-91fd-224b58feb9a3";
const NOTION_OPEN_QUESTIONS_DB = "35d48344-93df-8104-b563-d9322d6d0f9d";

async function queryNotionRecent(dbId: string, cutoffIso: string, notionToken: string): Promise<any[]> {
	try {
		const resp = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
			method: "POST",
			headers: { Authorization: `Bearer ${notionToken}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
			body: JSON.stringify({
				page_size: 25,
				sorts: [{ timestamp: "created_time", direction: "descending" }],
				filter: { timestamp: "created_time", created_time: { on_or_after: cutoffIso } },
			}),
			signal: AbortSignal.timeout(10_000),
		});
		if (!resp.ok) return [];
		const json = (await resp.json()) as { results?: any[] };
		return json.results || [];
	} catch (_) {
		return [];
	}
}

function notionTitleText(prop: any): string {
	if (!prop) return "";
	const arr = prop.title || prop.rich_text || [];
	return arr.map((t: any) => t.plain_text || "").join("").trim();
}

export async function handleUc3CapturesToday(
	_url: URL,
	env: Uc3HandlerEnv,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	const cutoffS = Math.floor(Date.now() / 1000) - 86400;
	const cutoffIso = new Date(cutoffS * 1000).toISOString();

	try {
		const [errataR, gapsR, oqsR] = await Promise.all([
			env.UC3_DB
				.prepare("SELECT id, module_id, notes, timestamp_seconds, created_at FROM module_errata WHERE created_at >= ? ORDER BY created_at DESC LIMIT 50")
				.bind(cutoffS)
				.all<{ id: number; module_id: number; notes: string; timestamp_seconds: number | null; created_at: number }>(),
			env.NOTION_TOKEN ? queryNotionRecent(NOTION_LEARNING_GAPS_QUEUE_DB, cutoffIso, env.NOTION_TOKEN) : Promise.resolve([]),
			env.NOTION_TOKEN ? queryNotionRecent(NOTION_OPEN_QUESTIONS_DB, cutoffIso, env.NOTION_TOKEN) : Promise.resolve([]),
		]);

		const items: Array<{
			type: "errata" | "gap" | "oq";
			id: string;
			content: string;
			created_at: number;
			module_id?: number;
			timestamp_seconds?: number | null;
			url?: string;
		}> = [];

		for (const e of (errataR.results ?? [])) {
			items.push({
				type: "errata",
				id: `errata-${e.id}`,
				content: e.notes,
				module_id: e.module_id,
				timestamp_seconds: e.timestamp_seconds,
				created_at: e.created_at,
			});
		}
		for (const g of gapsR) {
			const props = g.properties || {};
			const content = notionTitleText(props["Gap Title"]) || "(untitled gap)";
			items.push({
				type: "gap",
				id: `gap-${g.id}`,
				content,
				url: g.url,
				created_at: Math.floor(new Date(g.created_time).getTime() / 1000),
			});
		}
		for (const q of oqsR) {
			const props = q.properties || {};
			const content = notionTitleText(props["Question"]) || notionTitleText(props["Title"]) || notionTitleText(props["Name"]) || "(untitled question)";
			items.push({
				type: "oq",
				id: `oq-${q.id}`,
				content,
				url: q.url,
				created_at: Math.floor(new Date(q.created_time).getTime() / 1000),
			});
		}

		items.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

		const counts = {
			errata: items.filter((i) => i.type === "errata").length,
			gap: items.filter((i) => i.type === "gap").length,
			oq: items.filter((i) => i.type === "oq").length,
		};

		return { ok: true, status: 200, result: { items, counts, cutoff: cutoffS } };
	} catch (err) {
		return { ok: false, status: 502, error: `captures-today failed: ${(err as Error).message}` };
	}
}

// D6 — GET /api/uc3/list-briefs-ready
// Single D1 query returning all brief-ready (not-yet-approved) modules
// with everything HomeScreen needs to render them. Replaces the N-round-trip
// pattern where HomeScreen called pipeline-status once per gap to find briefs.
// Returns audio_bytes so the client can estimate audio duration (D5).
export async function handleUc3ListBriefsReady(
	_url: URL,
	env: Uc3HandlerEnv,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	try {
		const r = await env.UC3_DB
			.prepare(
				`SELECT lm.id AS module_id,
				        lm.gap_id,
				        lm.position_in_series,
				        lm.learning_objective,
				        lm.audio_r2_key AS module_audio_r2_key,
				        rb.audio_bytes AS brief_audio_bytes,
				        rb.voice_id AS brief_voice_id,
				        (SELECT gap_title FROM pipeline_state ps WHERE ps.gap_id = lm.gap_id) AS gap_title,
				        (SELECT COUNT(*) FROM learning_modules lm2 WHERE lm2.gap_id = lm.gap_id) AS total_in_series
				 FROM learning_modules lm
				 JOIN review_briefs rb ON rb.module_id = lm.id
				 WHERE rb.audio_r2_key IS NOT NULL
				   AND lm.status != 'approved'
				 ORDER BY lm.created_at DESC
				 LIMIT 12`,
			)
			.all<{
				module_id: number;
				gap_id: string;
				position_in_series: number;
				learning_objective: string;
				module_audio_r2_key: string | null;
				brief_audio_bytes: number | null;
				brief_voice_id: string | null;
				gap_title: string | null;
				total_in_series: number;
			}>();
		const rows = (r.results ?? []).map((row) => ({
			module_id: row.module_id,
			gap_id: row.gap_id,
			gap_title: row.gap_title,
			learning_objective: row.learning_objective,
			position: row.position_in_series,
			total_in_series: row.total_in_series,
			voice_id: row.brief_voice_id,
			brief_audio_bytes: row.brief_audio_bytes,
			has_full_audio: !!row.module_audio_r2_key,
		}));
		return { ok: true, status: 200, result: { briefs: rows, count: rows.length } };
	} catch (err) {
		return { ok: false, status: 502, error: `list-briefs-ready failed: ${(err as Error).message}` };
	}
}

// §8.4a.21 W8 — GET /api/uc3/spaced-rep-due
export async function handleUc3SpacedRepDue(
	_url: URL,
	env: Uc3HandlerEnv,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	try {
		const rows = await listDueRows(env.UC3_DB);
		return { ok: true, status: 200, result: { due: rows, count: rows.length } };
	} catch (err) {
		return { ok: false, status: 502, error: `spaced-rep-due failed: ${(err as Error).message}` };
	}
}

// §8.4a.21 W8 — POST /api/uc3/spaced-rep-mark-listened {module_id}
export async function handleUc3SpacedRepMarkListened(
	body: { module_id?: number },
	env: Uc3HandlerEnv,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	if (!body?.module_id || typeof body.module_id !== "number") {
		return { ok: false, status: 400, error: "field 'module_id' (number) required" };
	}
	try {
		const id = await markNextListened(env.UC3_DB, body.module_id);
		if (id === null) {
			return { ok: false, status: 404, error: `no unfired schedule row for module ${body.module_id}` };
		}
		return { ok: true, status: 200, result: { schedule_id: id } };
	} catch (err) {
		return { ok: false, status: 502, error: `mark-listened failed: ${(err as Error).message}` };
	}
}

// §8.4a.21 W7 — POST /api/uc3/module-feedback
// Body: { module_id, voice_transcript }
// Flow: persist feedback row → S9 parse → S10 dispatch → update row → return.
export async function handleUc3ModuleFeedback(
	body: { module_id?: number; voice_transcript?: string },
	env: Uc3HandlerEnv,
	ctx?: ExecutionContext,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	if (!body?.module_id || typeof body.module_id !== "number") {
		return { ok: false, status: 400, error: "field 'module_id' (number) required" };
	}
	const voice_transcript = typeof body.voice_transcript === "string" ? body.voice_transcript.trim() : "";
	if (!voice_transcript) {
		return { ok: false, status: 400, error: "field 'voice_transcript' (non-empty string) required" };
	}

	let feedback_id: number;
	try {
		feedback_id = await insertFeedback(env.UC3_DB, { module_id: body.module_id, voice_transcript });
	} catch (err) {
		return { ok: false, status: 502, error: `insertFeedback failed: ${(err as Error).message}` };
	}

	try {
		const parsed = await parseFeedback(env, body.module_id, voice_transcript);
		if (!parsed.ok || !parsed.parsed) {
			await markFeedbackFailed(env.UC3_DB, feedback_id, parsed.error ?? "parse failed");
			return {
				ok: false,
				status: 502,
				result: { feedback_id, parsed, dispatch: null },
				error: parsed.error ?? "S9 parse failed",
			};
		}

		await updateFeedbackParsed(env.UC3_DB, feedback_id, {
			parsed_actions_json: JSON.stringify(parsed.parsed.actions),
			parser_model: "claude-sonnet-4-6",
			parser_prompt_hash: parsed.prompt_hash ?? "",
			parser_confidence: parsed.parsed.confidence,
			parser_summary: parsed.parsed.summary,
		});

		// §8.4a.21 W8 — pass ctx through to dispatcher so doApprove can fire
		// post-approve side effects (full-module TTS + spaced-rep schedule)
		// via ctx.waitUntil. Falls back to no-side-effects if ctx missing.
		const dispatch = await dispatchFeedback({ ...env, CTX: ctx }, body.module_id, parsed.parsed.actions);

		await updateFeedbackDispatch(env.UC3_DB, feedback_id, {
			dispatch_status: dispatch.status,
			dispatch_results_json: JSON.stringify(dispatch.results),
			last_error: dispatch.status === "failed" ? "all actions failed" : null,
		});

		return {
			ok: dispatch.ok,
			status: dispatch.ok ? 200 : 207, // 207 = multi-status (partial success)
			result: {
				feedback_id,
				parsed: parsed.parsed,
				dropped: parsed.dropped,
				dispatch,
			},
		};
	} catch (err) {
		const msg = (err as Error).message;
		await markFeedbackFailed(env.UC3_DB, feedback_id, msg);
		return { ok: false, status: 502, error: `feedback handler crashed: ${msg}` };
	}
}

export async function handleUc3PipelineRun(
	body: { gap_id?: string },
	env: Uc3HandlerEnv,
): Promise<{ ok: boolean; status?: number; gap_id?: string; instance_id?: string; error?: string }> {
	if (!body?.gap_id || typeof body.gap_id !== "string") {
		return { ok: false, status: 400, error: "field 'gap_id' (string) required" };
	}
	try {
		const instance = await env.UC3_PIPELINE.create({ params: { gap_id: body.gap_id } });
		return { ok: true, status: 200, gap_id: body.gap_id, instance_id: instance.id };
	} catch (err) {
		return { ok: false, status: 502, error: `Workflow.create failed: ${(err as Error).message}` };
	}
}

export async function handleUc3PipelineCancel(
	url: URL,
	env: Uc3HandlerEnv,
): Promise<{ ok: boolean; status?: number; gap_id?: string; instance_id?: string; cancelled?: boolean; error?: string }> {
	const gap_id = url.searchParams.get("gap_id");
	if (!gap_id) return { ok: false, status: 400, error: "query param 'gap_id' required" };
	const state = await getPipelineState(env.UC3_DB, gap_id);
	if (!state) return { ok: false, status: 404, error: `no pipeline_state row for gap_id ${gap_id}` };
	if (!state.workflow_instance_id) {
		return { ok: false, status: 409, error: "pipeline_state has no workflow_instance_id (not yet started?)" };
	}
	try {
		const instance = await env.UC3_PIPELINE.get(state.workflow_instance_id);
		await instance.terminate();
		await env.UC3_DB
			.prepare("UPDATE pipeline_state SET status = 'cancelled', updated_at = ? WHERE gap_id = ?")
			.bind(Math.floor(Date.now() / 1000), gap_id)
			.run();
		return { ok: true, status: 200, gap_id, instance_id: state.workflow_instance_id, cancelled: true };
	} catch (err) {
		return { ok: false, status: 502, error: `terminate failed: ${(err as Error).message}` };
	}
}

export async function handleUc3PipelineStatus(
	url: URL,
	env: Uc3HandlerEnv,
): Promise<Record<string, unknown>> {
	const gap_id = url.searchParams.get("gap_id");
	if (!gap_id) return { ok: false, status: 400, error: "query param 'gap_id' required" };
	const includeTrail = url.searchParams.get("trail") === "1";
	const state = await getPipelineState(env.UC3_DB, gap_id);
	if (!state) return { ok: false, status: 404, error: `no pipeline_state row for gap_id ${gap_id}` };

	const includeTranscripts = url.searchParams.get("transcripts") === "1";
	const modules = await listModulesByGap(env.UC3_DB, gap_id);
	const briefs = await listBriefsByGap(env.UC3_DB, gap_id);
	const briefByModule = new Map(briefs.map((b) => [b.module_id, b]));
	const modulesEnriched = await Promise.all(
		modules.map(async (m) => {
			const citations = await listCitationsByModule(env.UC3_DB, m.id);
			const analogs = await listAnalogsByModule(env.UC3_DB, m.id);
			const sections = await listSectionsByModule(env.UC3_DB, m.id);
			const claims = await listClaimsByModule(env.UC3_DB, m.id);
			const passes = await listVerificationPassesByModule(env.UC3_DB, m.id);
			const brief = briefByModule.get(m.id);
			let outline: unknown = null;
			if (m.outline_json) {
				try {
					outline = JSON.parse(m.outline_json);
				} catch {
					outline = m.outline_json;
				}
			}
			const transcript = includeTranscripts && m.transcript_r2_key ? await getTranscript(env.TTS_CACHE, m.id) : null;
			return {
				id: m.id,
				position: m.position_in_series,
				status: m.status,
				learning_objective: m.learning_objective,
				dependencies: m.dependencies_json ? JSON.parse(m.dependencies_json) : [],
				outline,
				transcript_r2_key: m.transcript_r2_key,
				// 2026-05-19: audio_r2_key + voice_id were missing from the response,
				// causing client-side moduleUserState to default to "audio-cooking"
				// even when the W8.1 queue had already generated full audio. The
				// audio existed on R2; the UI just never learned about it.
				audio_r2_key: m.audio_r2_key,
				voice_id: m.voice_id,
				// D1: surface audio cooking failure state so the UI can
				// distinguish "still cooking" from "failed N times".
				audio_last_error: (m as any).audio_last_error ?? null,
				audio_attempts_count: (m as any).audio_attempts_count ?? 0,
				audio_last_attempt_at: (m as any).audio_last_attempt_at ?? null,
				approved_at: m.approved_at,
				transcript: transcript ?? undefined,
				citations: citations.map((c) => ({
					url: c.source_url,
					name: c.source_name,
					source_type: c.source_type,
					source_tier: c.source_tier,
					scope_note_used: c.scope_note_used,
					candidate: c.candidate === 1,
				})),
				analogs: analogs.map((a) => ({
					analog_author: a.analog_author,
					analog_work: a.analog_work,
					composite: a.composite,
					structural_fit: a.structural_fit,
					confidence: a.confidence,
					epistemic_strength: a.epistemic_strength,
					epistemic_strength_label: a.epistemic_strength_label,
					constitutive_role: a.constitutive_role,
					constitutive_role_label: a.constitutive_role_label,
					advance_to_drafting: a.advance_to_drafting === 1,
					rationale: a.rationale,
				})),
				sections: sections.map((s) => ({
					id: s.id,
					position: s.position,
					section_type: s.section_type,
					status: s.status,
					draft_iteration: s.draft_iteration,
					draft_text: s.draft_text,
					citations_used: s.citations_json ? JSON.parse(s.citations_json) : [],
				})),
				claims: claims.map((c) => ({
					id: c.id,
					section_id: c.section_id,
					claim_text: c.claim_text,
					cited_source_name: c.cited_source_name,
					cited_source_url: c.cited_source_url,
					verified: c.verified_pass1 === 1 ? true : c.verified_pass1 === 0 ? false : null,
					notes: c.verification_notes,
					rewrite_count: c.rewrite_count,
					needs_human_review: c.needs_human_review === 1,
				})),
				verification_passes: passes.map((p) => ({
					pass_number: p.pass_number,
					pass_type: p.pass_type,
					model: p.model,
					verdict: p.verdict,
					rationale: p.rationale,
					decided_at: p.decided_at,
				})),
				review_brief: brief
					? {
							script_r2_key: brief.script_r2_key,
							audio_r2_key: brief.audio_r2_key,
							voice_id: brief.voice_id,
							char_count: brief.char_count,
							audio_bytes: brief.audio_bytes,
							status: brief.status,
							generated_at: brief.generated_at,
							audio_generated_at: brief.audio_generated_at,
							last_error: brief.last_error,
						}
					: null,
			};
		}),
	);

	// Pull gap_title + notion_page_id (D3) from D1 — populated by list-gaps
	// Notion backfill. Lets the UI deep-link to the specific gap row.
	const titleRow = await env.UC3_DB
		.prepare("SELECT gap_title, notion_page_id FROM pipeline_state WHERE gap_id = ?")
		.bind(gap_id)
		.first<{ gap_title: string | null; notion_page_id: string | null }>();
	const result: Record<string, unknown> = {
		ok: true,
		status: 200,
		gap_id,
		gap_title: titleRow?.gap_title ?? null,
		notion_page_id: titleRow?.notion_page_id ?? null,
		pipeline: {
			stage: state.stage,
			status: state.status,
			workflow_instance_id: state.workflow_instance_id,
			retry_count: state.retry_count,
			last_error: state.last_error,
			started_at: state.started_at,
			updated_at: state.updated_at,
		},
		modules: modulesEnriched,
	};

	if (includeTrail) {
		const trail = await listVerificationByGap(env.UC3_DB, gap_id);
		result.verification_trail = trail.map((t) => ({
			id: t.id,
			module_id: t.module_id,
			stage: t.stage,
			model: t.model,
			prompt_hash: t.prompt_hash,
			ok: t.ok === 1,
			error_text: t.error_text,
			decided_at: t.decided_at,
			response_summary: t.response_json ? (t.response_json.length > 600 ? t.response_json.slice(0, 600) + "…[truncated]" : t.response_json) : null,
		}));
	}

	return result;
}
