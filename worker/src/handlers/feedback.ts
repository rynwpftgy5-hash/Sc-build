// §8.4a.25 — HTTP handlers for /api/feedback-* and /api/blindspot-*.

import { createFeedback, listFeedback, resolveFeedback, type FeedbackEnv } from "../lib/feedback";
import { analyzeBlindspot, listBlindspots, resolveBlindspot, type BlindspotEnv } from "../lib/blindspot-analyzer";
import { FEEDBACK_TYPES, type FeedbackType } from "../lib/feedback-types";
import {
	proposeFix, applyFix, recordFixCallback, getFixForFeedback, listAllFixes, listPendingFixes,
	type FixFlowEnv, type FixCallbackInput,
} from "../lib/feedback-fixes";

type Env = FeedbackEnv & BlindspotEnv & FixFlowEnv;

// POST /api/feedback-capture {surface, view_state_json?, type, notes_text?, voice_transcript?, audio_r2_key?, user_agent?, captured_at?}
//   → fires analyzeBlindspot in background via ctx.waitUntil
export async function handleFeedbackCapture(
	body: {
		surface?: string;
		view_state_json?: Record<string, unknown> | string;
		type?: string;
		notes_text?: string;
		voice_transcript?: string;
		audio_r2_key?: string;
		user_agent?: string;
		captured_at?: number;
	},
	env: Env,
	ctx?: ExecutionContext,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	if (!body?.surface || typeof body.surface !== "string") {
		return { ok: false, status: 400, error: "field 'surface' (string) required" };
	}
	if (!body.type || !FEEDBACK_TYPES.includes(body.type as FeedbackType)) {
		return { ok: false, status: 400, error: `field 'type' must be one of ${FEEDBACK_TYPES.join(", ")}` };
	}

	const create = await createFeedback(env, {
		surface: body.surface,
		view_state_json: body.view_state_json,
		type: body.type as FeedbackType,
		notes_text: body.notes_text,
		voice_transcript: body.voice_transcript,
		audio_r2_key: body.audio_r2_key,
		user_agent: body.user_agent,
		captured_at: body.captured_at,
	});
	if (!create.ok || !create.feedback_id) {
		return { ok: false, status: 502, error: create.error ?? "createFeedback failed" };
	}

	// Fire adversarial UAT pass in background — never block the user on it.
	if (ctx && env.ANTHROPIC_API_KEY) {
		ctx.waitUntil(
			(async () => {
				try {
					// Re-fetch the row to give the analyzer the canonical D1 view.
					const r = await env.UC3_DB
						.prepare("SELECT * FROM ui_feedback WHERE id = ?")
						.bind(create.feedback_id)
						.first();
					if (!r) return;
					await analyzeBlindspot(env, r as unknown as Parameters<typeof analyzeBlindspot>[1]);
				} catch (err) {
					console.error(`blindspot analyzer failed for feedback ${create.feedback_id}:`, (err as Error).message);
				}
			})(),
		);
	}

	return {
		ok: true,
		status: 200,
		result: {
			feedback_id: create.feedback_id,
			notion_page_id: create.notion_page_id,
			analyzer_dispatched: !!(ctx && env.ANTHROPIC_API_KEY),
		},
	};
}

// GET /api/feedback-list?status=open&surface=/uc3&type=bug&limit=50&include_blindspots=true
// When include_blindspots=true, each item gets a `blindspot` field with the
// joined audit_blindspots row (the adversarial analyzer's diagnosis). Used by
// the /feedback surface to render the "what happened to this report?" view
// without N+1 round trips.
export async function handleFeedbackList(
	url: URL,
	env: Env,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	const status = url.searchParams.get("status") ?? undefined;
	const surface = url.searchParams.get("surface") ?? undefined;
	const type = url.searchParams.get("type") ?? undefined;
	const include_blindspots = url.searchParams.get("include_blindspots") === "true";
	const limitStr = url.searchParams.get("limit");
	const limit = limitStr ? Math.max(1, Math.min(200, parseInt(limitStr, 10) || 50)) : 50;
	try {
		const items = await listFeedback(env.UC3_DB, { status, surface, type, limit });
		let enriched: unknown[] = items;
		if (include_blindspots && items.length > 0) {
			const ids = items.map((i) => i.id);
			const placeholders = ids.map(() => "?").join(",");
			const b = await env.UC3_DB
				.prepare(
					`SELECT * FROM audit_blindspots WHERE feedback_id IN (${placeholders}) ORDER BY created_at DESC`,
				)
				.bind(...ids)
				.all();
			const bsByFb = new Map<number, unknown>();
			for (const row of (b.results ?? []) as Array<{ feedback_id: number }>) {
				// keep the FIRST (most recent) per feedback_id since we ordered desc
				if (!bsByFb.has(row.feedback_id)) bsByFb.set(row.feedback_id, row);
			}
			// Join feedback_fixes too — the /feedback surface needs tier + diff + PR state per item.
			const fixesByFb = await listAllFixes(env.UC3_DB, ids);
			enriched = items.map((i) => ({
				...i,
				blindspot: bsByFb.get(i.id) ?? null,
				fix: fixesByFb.get(i.id) ?? null,
			}));
		}
		// Summary counters so the surface doesn't have to compute them client-side
		// from a paginated subset. Counts are over the whole table, not the page.
		const counts = await env.UC3_DB
			.prepare(
				`SELECT status, COUNT(*) AS n FROM ui_feedback GROUP BY status`,
			)
			.all<{ status: string; n: number }>();
		const summary: Record<string, number> = { total: 0, open: 0, in_progress: 0, resolved: 0, wontfix: 0 };
		for (const r of counts.results ?? []) {
			summary[r.status] = r.n;
			summary.total += r.n;
		}
		// Open blindspots count is useful header context for the patterns view.
		const bsOpen = await env.UC3_DB
			.prepare(`SELECT COUNT(*) AS n FROM audit_blindspots WHERE status = 'open'`)
			.first<{ n: number }>();
		summary.blindspots_open = bsOpen?.n ?? 0;
		return { ok: true, status: 200, result: { count: items.length, items: enriched, summary } };
	} catch (err) {
		return { ok: false, status: 502, error: (err as Error).message };
	}
}

// POST /api/feedback-resolve {id, status, resolution_note?}
export async function handleFeedbackResolve(
	body: { id?: number; status?: string; resolution_note?: string },
	env: Env,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	if (typeof body?.id !== "number") return { ok: false, status: 400, error: "id required" };
	const valid = ["in_progress", "resolved", "wontfix"] as const;
	if (!body.status || !valid.includes(body.status as typeof valid[number])) {
		return { ok: false, status: 400, error: `status must be one of ${valid.join(", ")}` };
	}
	const r = await resolveFeedback(env.UC3_DB, body.id, body.status as typeof valid[number], body.resolution_note);
	if (!r.ok) return { ok: false, status: 502, error: r.error };
	return { ok: true, status: 200, result: { id: body.id, new_status: body.status } };
}

// GET /api/blindspots-list?status=open&limit=50
export async function handleBlindspotsList(
	url: URL,
	env: Env,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	const status = url.searchParams.get("status") ?? undefined;
	const pattern_category = url.searchParams.get("pattern_category") ?? undefined;
	const limitStr = url.searchParams.get("limit");
	const limit = limitStr ? Math.max(1, Math.min(200, parseInt(limitStr, 10) || 50)) : 50;
	try {
		const items = await listBlindspots(env.UC3_DB, { status, pattern_category, limit });
		return { ok: true, status: 200, result: { count: items.length, items } };
	} catch (err) {
		return { ok: false, status: 502, error: (err as Error).message };
	}
}

// POST /api/blindspot-reanalyze {feedback_id}
export async function handleBlindspotReanalyze(
	body: { feedback_id?: number },
	env: Env,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	if (typeof body?.feedback_id !== "number") {
		return { ok: false, status: 400, error: "feedback_id required" };
	}
	try {
		const r = await env.UC3_DB
			.prepare("SELECT * FROM ui_feedback WHERE id = ?")
			.bind(body.feedback_id)
			.first();
		if (!r) return { ok: false, status: 404, error: "feedback not found" };
		const result = await analyzeBlindspot(env, r as unknown as Parameters<typeof analyzeBlindspot>[1]);
		return { ok: result.ok, status: result.ok ? 200 : 502, result };
	} catch (err) {
		return { ok: false, status: 502, error: (err as Error).message };
	}
}

// POST /api/blindspot-resolve {id, status, resolution_note, applied_to_adr?}
export async function handleBlindspotResolve(
	body: { id?: number; status?: string; resolution_note?: string; applied_to_adr?: string },
	env: Env,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	if (typeof body?.id !== "number") return { ok: false, status: 400, error: "id required" };
	if (body.status !== "applied" && body.status !== "rejected") {
		return { ok: false, status: 400, error: "status must be 'applied' or 'rejected'" };
	}
	if (!body.resolution_note) {
		return { ok: false, status: 400, error: "resolution_note required (explain why applied/rejected)" };
	}
	const r = await resolveBlindspot(env.UC3_DB, body.id, body.status, body.resolution_note, body.applied_to_adr);
	if (!r.ok) return { ok: false, status: 502, error: r.error };
	return { ok: true, status: 200, result: { id: body.id, new_status: body.status, applied_to_adr: body.applied_to_adr } };
}

// =====================================================================
// §8.4a.25c — Auto-fix loop handlers (tiered hybrid)
// =====================================================================

// POST /api/feedback-propose-fix {feedback_id}
// Dispatches GH Actions workflow `feedback-fix.yml` (mode=propose).
// The workflow:
//   1. Pulls feedback + blindspot from /api/feedback-list
//   2. Tier-classifies (T1/T2/T3) via claude-code-action
//   3. If T3: callback `punted`, exits
//   4. If T1/T2: generates a diff, opens a PR (T1 sets auto-merge)
//   5. POSTs progress back to /api/feedback-fix-callback
export async function handleFeedbackProposeFix(
	body: { feedback_id?: number },
	env: Env,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	if (typeof body?.feedback_id !== "number") {
		return { ok: false, status: 400, error: "feedback_id required" };
	}
	const r = await proposeFix(env, body.feedback_id);
	if (!r.ok) return { ok: false, status: 502, error: r.error };
	return { ok: true, status: 200, result: { fix_id: r.fix_id, existing: !!r.existing } };
}

// POST /api/feedback-apply {feedback_id}
// User clicked Apply on a T2 fix (or override-Apply on a T1 that didn't auto-merge).
// Dispatches the same workflow with mode=apply to merge the open PR.
export async function handleFeedbackApply(
	body: { feedback_id?: number },
	env: Env,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	if (typeof body?.feedback_id !== "number") {
		return { ok: false, status: 400, error: "feedback_id required" };
	}
	const r = await applyFix(env, body.feedback_id);
	if (!r.ok) return { ok: false, status: 502, error: r.error };
	return { ok: true, status: 200, result: { applying: true } };
}

// GET /api/feedback-fix-status?feedback_id=N — surface polls this for progress.
export async function handleFeedbackFixStatus(
	url: URL,
	env: Env,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	const idStr = url.searchParams.get("feedback_id");
	if (!idStr) return { ok: false, status: 400, error: "feedback_id query param required" };
	const feedback_id = parseInt(idStr, 10);
	if (!Number.isFinite(feedback_id)) return { ok: false, status: 400, error: "feedback_id must be integer" };
	try {
		const fix = await getFixForFeedback(env.UC3_DB, feedback_id);
		return { ok: true, status: 200, result: { feedback_id, fix } };
	} catch (err) {
		return { ok: false, status: 502, error: (err as Error).message };
	}
}

// GET /api/feedback-fixes-pending?limit=1 — drained by the schedule trigger
// in .github/workflows/feedback-fix.yml. Returns oldest pending/apply-requested
// rows so the cron can process them in order.
export async function handleFeedbackFixesPending(
	url: URL,
	env: Env,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	const limitStr = url.searchParams.get("limit");
	const limit = limitStr ? Math.max(1, Math.min(10, parseInt(limitStr, 10) || 1)) : 1;
	try {
		const items = await listPendingFixes(env.UC3_DB, limit);
		return { ok: true, status: 200, result: { count: items.length, items } };
	} catch (err) {
		return { ok: false, status: 502, error: (err as Error).message };
	}
}

// POST /api/feedback-fix-callback — written-to by the GH Actions workflow.
// Requires the same MCP_CLIENT_TOKEN as other endpoints (workflow has it as secret).
// Body shape: see FixCallbackInput in lib/feedback-fixes.ts.
export async function handleFeedbackFixCallback(
	body: FixCallbackInput,
	env: Env,
): Promise<{ ok: boolean; status?: number; result?: unknown; error?: string }> {
	if (typeof body?.fix_id !== "number" || typeof body?.feedback_id !== "number") {
		return { ok: false, status: 400, error: "fix_id + feedback_id required" };
	}
	if (!body.stage) {
		return { ok: false, status: 400, error: "stage required" };
	}
	const r = await recordFixCallback(env, body);
	if (!r.ok) return { ok: false, status: 502, error: r.error };
	return { ok: true, status: 200, result: { recorded: true } };
}
