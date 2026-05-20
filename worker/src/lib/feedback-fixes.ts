// §8.4a.25c — Auto-fix loop. Worker side bridges D1 ⇄ GitHub Actions.
//
// The actual code editing happens inside the GH Actions workflow
// (.github/workflows/feedback-fix.yml) using claude-code-action@v1, which has
// filesystem + git tools. Worker dispatches the workflow and reads progress
// via either polling the workflow run state or a callback POST from the
// workflow itself to /api/feedback-fix-callback.

export interface FixFlowEnv {
	UC3_DB: D1Database;
	GITHUB_TOKEN?: string;     // PAT with repo + workflow scopes
	GITHUB_OWNER?: string;     // defaults to env or "rynwpftgy5-hash"
	GITHUB_REPO?: string;      // defaults to env or "Sc-build"
}

export interface FixRow {
	id: number;
	feedback_id: number;
	tier: string | null;
	tier_rationale: string | null;
	proposed_diff: string | null;
	proposed_rationale: string | null;
	files_touched: string | null;
	pr_url: string | null;
	pr_number: number | null;
	branch_name: string | null;
	workflow_run_id: string | null;
	workflow_run_url: string | null;
	status: string;
	ci_state: string | null;
	error_text: string | null;
	created_at: number;
	proposed_at: number | null;
	applied_at: number | null;
	merged_at: number | null;
}

const DEFAULT_OWNER = "rynwpftgy5-hash";
const DEFAULT_REPO = "Sc-build";
const WORKFLOW_FILE = "feedback-fix.yml";

function ghHeaders(token: string): HeadersInit {
	return {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": "spacesc-mcp-feedback-fix/1.0",
	};
}

async function dispatchWorkflow(env: FixFlowEnv, inputs: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
	if (!env.GITHUB_TOKEN) {
		return { ok: false, error: "GITHUB_TOKEN secret not set on Worker — auto-fix dispatch disabled" };
	}
	const owner = env.GITHUB_OWNER || DEFAULT_OWNER;
	const repo = env.GITHUB_REPO || DEFAULT_REPO;
	const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
	const resp = await fetch(url, {
		method: "POST",
		headers: { ...ghHeaders(env.GITHUB_TOKEN), "Content-Type": "application/json" },
		body: JSON.stringify({ ref: "main", inputs }),
	});
	if (!resp.ok) {
		const txt = (await resp.text()).slice(0, 500);
		return { ok: false, error: `GitHub dispatch ${resp.status}: ${txt}` };
	}
	return { ok: true };
}

// Create a new fix row. Worker writes the row in 'pending' state — the GH
// Actions workflow's schedule trigger (every 3 min) pulls pending items and
// processes them, eliminating any need for a GitHub credential on the Worker.
// If GITHUB_TOKEN happens to be set on the Worker, we ALSO dispatch the
// workflow immediately for faster latency (~10s vs ~3 min worst case).
//
// Idempotency: a row already in flight returns its existing id.
export async function proposeFix(
	env: FixFlowEnv,
	feedback_id: number,
): Promise<{ ok: boolean; fix_id?: number; error?: string; existing?: boolean; dispatch_mode?: string }> {
	const now = Math.floor(Date.now() / 1000);

	// Idempotency check — anything in flight wins
	const existing = await env.UC3_DB
		.prepare(
			`SELECT id, status FROM feedback_fixes
			 WHERE feedback_id = ?
			 AND status IN ('pending','proposing','proposed','applying','ci-running')
			 ORDER BY created_at DESC LIMIT 1`,
		)
		.bind(feedback_id)
		.first<{ id: number; status: string }>();
	if (existing) {
		return { ok: true, fix_id: existing.id, existing: true };
	}

	// Verify feedback exists
	const fb = await env.UC3_DB
		.prepare("SELECT id FROM ui_feedback WHERE id = ?")
		.bind(feedback_id)
		.first();
	if (!fb) return { ok: false, error: `feedback ${feedback_id} not found` };

	// Insert in 'pending' state — the GH Actions cron will pick this up within
	// ~3 min via /api/feedback-fixes-pending.
	const ins = await env.UC3_DB
		.prepare(
			`INSERT INTO feedback_fixes (feedback_id, status, created_at)
			 VALUES (?, 'pending', ?)`,
		)
		.bind(feedback_id, now)
		.run();
	const fix_id = Number((ins.meta as { last_row_id?: number }).last_row_id);

	// Try immediate dispatch IF Worker has a GitHub token. No-token path is the
	// default and explicitly supported — the schedule trigger handles it.
	if (env.GITHUB_TOKEN) {
		const dispatch = await dispatchWorkflow(env, {
			feedback_id: String(feedback_id),
			fix_id: String(fix_id),
			mode: "propose",
		});
		if (dispatch.ok) {
			await env.UC3_DB
				.prepare(`UPDATE feedback_fixes SET status = 'proposing' WHERE id = ?`)
				.bind(fix_id)
				.run();
			return { ok: true, fix_id, dispatch_mode: "immediate" };
		}
		// Dispatch failed but token was present — leave as 'pending', cron will
		// retry. Don't mark failed: this is a soft fallback.
		console.warn(`Worker dispatch failed; falling back to cron drain: ${dispatch.error}`);
	}
	return { ok: true, fix_id, dispatch_mode: "queued" };
}

// User clicked Apply/Merge on a proposed fix. The Worker writes status='apply-requested'
// — the GH Actions cron picks it up and merges the PR. If Worker has GITHUB_TOKEN,
// also dispatches immediately for faster latency.
export async function applyFix(
	env: FixFlowEnv,
	feedback_id: number,
): Promise<{ ok: boolean; error?: string; dispatch_mode?: string }> {
	const row = await env.UC3_DB
		.prepare(
			`SELECT id, status, tier, pr_number FROM feedback_fixes
			 WHERE feedback_id = ? AND status IN ('proposed','ci-running')
			 ORDER BY created_at DESC LIMIT 1`,
		)
		.bind(feedback_id)
		.first<{ id: number; status: string; tier: string; pr_number: number | null }>();
	if (!row) return { ok: false, error: "no proposed fix to apply for this feedback" };
	if (!row.pr_number) return { ok: false, error: "no PR open for this fix" };

	const now = Math.floor(Date.now() / 1000);
	// Flip to 'apply-requested' — cron drains this.
	await env.UC3_DB
		.prepare("UPDATE feedback_fixes SET status = 'apply-requested', applied_at = ? WHERE id = ?")
		.bind(now, row.id)
		.run();

	if (env.GITHUB_TOKEN) {
		const dispatch = await dispatchWorkflow(env, {
			feedback_id: String(feedback_id),
			fix_id: String(row.id),
			mode: "apply",
			pr_number: String(row.pr_number),
		});
		if (dispatch.ok) {
			await env.UC3_DB
				.prepare("UPDATE feedback_fixes SET status = 'applying' WHERE id = ?")
				.bind(row.id)
				.run();
			return { ok: true, dispatch_mode: "immediate" };
		}
		console.warn(`Worker apply-dispatch failed; cron will drain: ${dispatch.error}`);
	}
	return { ok: true, dispatch_mode: "queued" };
}

// Schedule-trigger consumer: returns oldest 'pending' or 'apply-requested' row
// for the cron to process. Limited to 1 by default so each cron tick handles
// one item and idempotently re-checks next time.
export async function listPendingFixes(
	db: D1Database,
	limit = 1,
): Promise<FixRow[]> {
	const r = await db
		.prepare(
			`SELECT * FROM feedback_fixes
			 WHERE status IN ('pending','apply-requested')
			 ORDER BY created_at ASC LIMIT ?`,
		)
		.bind(Math.min(Math.max(limit, 1), 10))
		.all<FixRow>();
	return r.results ?? [];
}

// Workflow callback writes back tier + diff + PR + CI state.
export interface FixCallbackInput {
	fix_id: number;
	feedback_id: number;
	stage: "tiered" | "proposed" | "ci-result" | "merged" | "failed" | "punted";
	tier?: string;
	tier_rationale?: string;
	proposed_diff?: string;
	proposed_rationale?: string;
	files_touched?: string[];
	pr_url?: string;
	pr_number?: number;
	branch_name?: string;
	workflow_run_id?: string;
	workflow_run_url?: string;
	ci_state?: string;
	error_text?: string;
}

export async function recordFixCallback(
	env: FixFlowEnv,
	input: FixCallbackInput,
): Promise<{ ok: boolean; error?: string }> {
	const now = Math.floor(Date.now() / 1000);
	const updates: string[] = [];
	const binds: Array<unknown> = [];

	if (input.tier !== undefined) { updates.push("tier = ?"); binds.push(input.tier); }
	if (input.tier_rationale !== undefined) { updates.push("tier_rationale = ?"); binds.push(input.tier_rationale); }
	if (input.proposed_diff !== undefined) { updates.push("proposed_diff = ?"); binds.push(input.proposed_diff); }
	if (input.proposed_rationale !== undefined) { updates.push("proposed_rationale = ?"); binds.push(input.proposed_rationale); }
	if (input.files_touched !== undefined) { updates.push("files_touched = ?"); binds.push(JSON.stringify(input.files_touched)); }
	if (input.pr_url !== undefined) { updates.push("pr_url = ?"); binds.push(input.pr_url); }
	if (input.pr_number !== undefined) { updates.push("pr_number = ?"); binds.push(input.pr_number); }
	if (input.branch_name !== undefined) { updates.push("branch_name = ?"); binds.push(input.branch_name); }
	if (input.workflow_run_id !== undefined) { updates.push("workflow_run_id = ?"); binds.push(input.workflow_run_id); }
	if (input.workflow_run_url !== undefined) { updates.push("workflow_run_url = ?"); binds.push(input.workflow_run_url); }
	if (input.ci_state !== undefined) { updates.push("ci_state = ?"); binds.push(input.ci_state); }
	if (input.error_text !== undefined) { updates.push("error_text = ?"); binds.push(input.error_text); }

	// Stage → status map
	const stageStatus: Record<string, string> = {
		tiered: "proposing",
		proposed: "proposed",
		"ci-result": "ci-running",
		merged: "merged",
		failed: "failed",
		punted: "punted",
	};
	const newStatus = stageStatus[input.stage];
	if (newStatus) {
		updates.push("status = ?");
		binds.push(newStatus);
	}
	if (input.stage === "proposed") { updates.push("proposed_at = ?"); binds.push(now); }
	if (input.stage === "merged") { updates.push("merged_at = ?"); binds.push(now); }

	if (updates.length === 0) return { ok: true };
	binds.push(input.fix_id);

	try {
		await env.UC3_DB
			.prepare(`UPDATE feedback_fixes SET ${updates.join(", ")} WHERE id = ?`)
			.bind(...binds)
			.run();
		// If merged, also mark the feedback row resolved with a pointer.
		if (input.stage === "merged" && input.feedback_id) {
			await env.UC3_DB
				.prepare(
					`UPDATE ui_feedback SET status = 'resolved', resolution_note = ?, resolved_at = ?
					 WHERE id = ? AND status != 'resolved'`,
				)
				.bind(`auto-fix merged · ${input.pr_url ?? `#${input.pr_number ?? "?"}`}`, now, input.feedback_id)
				.run();
		}
		return { ok: true };
	} catch (err) {
		return { ok: false, error: (err as Error).message };
	}
}

export async function getFixForFeedback(
	db: D1Database,
	feedback_id: number,
): Promise<FixRow | null> {
	const r = await db
		.prepare(
			`SELECT * FROM feedback_fixes WHERE feedback_id = ? ORDER BY created_at DESC LIMIT 1`,
		)
		.bind(feedback_id)
		.first<FixRow>();
	return r ?? null;
}

export async function listAllFixes(
	db: D1Database,
	feedback_ids: number[],
): Promise<Map<number, FixRow>> {
	if (feedback_ids.length === 0) return new Map();
	const placeholders = feedback_ids.map(() => "?").join(",");
	const r = await db
		.prepare(
			`SELECT * FROM feedback_fixes WHERE feedback_id IN (${placeholders})
			 ORDER BY created_at DESC`,
		)
		.bind(...feedback_ids)
		.all<FixRow>();
	const m = new Map<number, FixRow>();
	for (const row of r.results ?? []) {
		// First (most recent) per feedback wins
		if (!m.has(row.feedback_id)) m.set(row.feedback_id, row);
	}
	return m;
}
