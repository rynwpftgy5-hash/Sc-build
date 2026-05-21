// §8.4a.25 — Adversarial UAT self-audit.
//
// When Campbell taps 🚩 to report something the system should have caught,
// this runs a Claude pass that diagnoses *which audit step missed it and why*,
// then writes the result to audit_blindspots. The next ADR-024 pre-deploy
// gate reads open blindspots and runs the proposed checks — closing the loop.
//
// The prompt is intentionally structured to ask for the GENERAL pattern, not
// the specific instance. We don't want "never have wrong voice for module 82";
// we want "verify rotation-voice consistency across all approved modules in a
// series before claiming the series is playable."

import { callAnthropic, extractJson, type AnthropicModel } from "./anthropic";
import type { FeedbackRow } from "./feedback";

const MODEL: AnthropicModel = "claude-sonnet-4-6";

export interface BlindspotEnv {
	UC3_DB: D1Database;
	ANTHROPIC_API_KEY: string;
}

export interface BlindspotRow {
	id: number;
	feedback_id: number;
	missed_check: string | null;
	why_text: string;
	proposed_new_check: string;
	pattern_category: string | null;
	status: string;
	resolution_note: string | null;
	created_at: number;
	resolved_at: number | null;
	applied_to_adr: string | null;
	analyzer_model: string | null;
	analyzer_cost_cents: number | null;
}

export interface AnalyzeResult {
	ok: boolean;
	blindspot_id?: number;
	missed_check?: string;
	why_text?: string;
	proposed_new_check?: string;
	pattern_category?: string;
	error?: string;
}

// ADR-024 failure register. Kept inline so the analyzer's context is
// self-contained (no R2 / Notion fetch needed at hot path). Update this when
// new F-entries land in the ADR.
const F_REGISTER = `
F1 — UI built without persona / charter (regressions across iterations)
F2 — Build-order arguments shipped to user as decision points
F3 — Surfacing bug list to user as a decision instead of fixing in same turn
F4 — Hand-coded HTML drift between v3 / v4 / v5 generations
F5 — Secrets in client bundles (auth tokens, API keys)
F6 — Dead-end states (no path back to home; no retry on transient errors)
F7 — Naming creep (SKR, WTF acronyms); features renamed mid-build
F8 — Bare "unknown" status with no plain-English copy
F9 — Build proceeds before context refresh (logs / Notion not consulted)
F10 — Cross-surface inconsistency (each surface invents its own nav pattern)
F11 — Async fire-and-forget without context propagation (ctx.waitUntil killed mid-flight)
F12 — Smoke test passes; user-outcome doesn't (network 200 ≠ feature works)
F13 — "Tests pass" treated as user-outcome reach
F14 — Polled positive-signal-only state (e.g. audio_r2_key='Y' looks healthy even when audio is wrong)
`.trim();

function buildPrompt(feedback: FeedbackRow, recentDebrief: string | null): string {
	const viewState = feedback.view_state_json ?? "{}";
	const notes = (feedback.notes_text ?? feedback.voice_transcript ?? "").slice(0, 4000);
	return `You are auditing the SpaceSC UI build discipline (ADR-024). The user just submitted feedback that the system *should have caught before they had to report it*.

Your job: diagnose **why our automated UAT / smoke tests / audit checklist missed this**, and propose **one additional verification check** that would catch this class of issue next time.

CRITICAL CONSTRAINTS:
- Propose the GENERAL failure pattern, not the specific instance. ("verify rotation-voice consistency across series" — good. "never have wrong voice for module 82" — useless.)
- Map to an existing F-entry from the failure register where possible. If the pattern is novel, mark pattern_category as "new" and propose a new F-name in proposed_new_check.
- The proposed_new_check should be an actionable verification step a future agent could run, not philosophy.

FEEDBACK FROM USER:
- Surface: ${feedback.surface}
- Type: ${feedback.type}
- Captured at: ${new Date(feedback.captured_at * 1000).toISOString()}
- Notes: ${notes}
- View state at capture: ${viewState}

ADR-024 FAILURE REGISTER (F1-F14):
${F_REGISTER}

RECENT UAT DEBRIEF (Part 4 from the last session — may be empty):
${recentDebrief ? recentDebrief.slice(0, 4000) : "(no recent debrief available)"}

Return JSON in this exact shape:
{
  "missed_check": "F14" | "F13" | ... | "new",
  "why_text": "One paragraph (3-5 sentences) on the specific failure mode. Be concrete: which signal did we polll, what did it tell us, why was that misleading.",
  "proposed_new_check": "One actionable verification step. Imperative voice. Start with a verb. Should be runnable in a smoke test or pre-deploy gate.",
  "pattern_category": "F14-polling" | "F13-tests-pass" | "F11-async" | "F6-dead-end" | "new" | ...
}

Output ONLY the JSON. No prose, no markdown.`;
}

export async function analyzeBlindspot(
	env: BlindspotEnv,
	feedback: FeedbackRow,
	recentDebrief?: string,
): Promise<AnalyzeResult> {
	if (!env.ANTHROPIC_API_KEY) {
		return { ok: false, error: "ANTHROPIC_API_KEY missing" };
	}
	const prompt = buildPrompt(feedback, recentDebrief ?? null);

	let r;
	try {
		r = await callAnthropic({
			apiKey: env.ANTHROPIC_API_KEY,
			model: MODEL,
			user: prompt,
			maxTokens: 1024,
		});
	} catch (err) {
		return { ok: false, error: `analyzer call threw: ${(err as Error).message}` };
	}
	if (!r.ok || !r.text) {
		return { ok: false, error: `analyzer failed: ${r.error ?? "no text"}` };
	}

	const parsed = extractJson<{
		missed_check?: string;
		why_text?: string;
		proposed_new_check?: string;
		pattern_category?: string;
	}>(r.text);
	if (!parsed || !parsed.why_text || !parsed.proposed_new_check) {
		return { ok: false, error: `analyzer output did not parse: ${r.text.slice(0, 300)}` };
	}

	// Rough cost trace. claude-sonnet-4-6 ≈ $3/M input + $15/M output. We
	// don't have exact token counts cheap; budget at ~2000 input + 500 output
	// → ~$0.013 per call. Stored as cents for monitoring.
	const cost_cents = 2;

	const now = Math.floor(Date.now() / 1000);
	let blindspot_id: number;
	try {
		const ins = await env.UC3_DB
			.prepare(
				`INSERT INTO audit_blindspots
				 (feedback_id, missed_check, why_text, proposed_new_check, pattern_category, status, created_at, analyzer_model, analyzer_cost_cents)
				 VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
			)
			.bind(
				feedback.id,
				parsed.missed_check ?? null,
				parsed.why_text,
				parsed.proposed_new_check,
				parsed.pattern_category ?? null,
				now,
				MODEL,
				cost_cents,
			)
			.run();
		blindspot_id = Number((ins.meta as { last_row_id?: number }).last_row_id);
	} catch (err) {
		return { ok: false, error: `D1 insert failed: ${(err as Error).message}` };
	}

	return {
		ok: true,
		blindspot_id,
		missed_check: parsed.missed_check,
		why_text: parsed.why_text,
		proposed_new_check: parsed.proposed_new_check,
		pattern_category: parsed.pattern_category,
	};
}

export async function listBlindspots(
	db: D1Database,
	filter: { status?: string; pattern_category?: string; limit?: number },
): Promise<BlindspotRow[]> {
	const clauses: string[] = [];
	const binds: Array<string | number> = [];
	if (filter.status) { clauses.push("status = ?"); binds.push(filter.status); }
	if (filter.pattern_category) { clauses.push("pattern_category = ?"); binds.push(filter.pattern_category); }
	const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
	const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
	const r = await db
		.prepare(`SELECT * FROM audit_blindspots ${where} ORDER BY created_at DESC LIMIT ?`)
		.bind(...binds, limit)
		.all<BlindspotRow>();
	return r.results ?? [];
}

export async function resolveBlindspot(
	db: D1Database,
	id: number,
	status: "applied" | "rejected",
	resolution_note: string,
	applied_to_adr?: string,
): Promise<{ ok: boolean; error?: string }> {
	const now = Math.floor(Date.now() / 1000);
	try {
		await db
			.prepare(
				`UPDATE audit_blindspots
				 SET status = ?, resolution_note = ?, resolved_at = ?, applied_to_adr = ?
				 WHERE id = ?`,
			)
			.bind(status, resolution_note, now, applied_to_adr ?? null, id)
			.run();
		return { ok: true };
	} catch (err) {
		return { ok: false, error: (err as Error).message };
	}
}
