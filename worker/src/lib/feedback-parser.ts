// §8.4a.21 W7 — S9 voice-feedback NLU.
// Takes Campbell's voice transcript reacting to a review brief + module context,
// returns structured revision actions for S10 to dispatch.

import { callAnthropic, extractJson, sha256Hex, type AnthropicModel } from "./anthropic";
import {
	listClaimsByModule,
	listCitationsByModule,
	listVerificationPassesByModule,
	getBriefByModule,
	logVerification,
} from "./d1-uc3";
import { getTranscript } from "./r2-transcripts";

// @ts-expect-error — Wrangler Text rule
import S9_PROMPT from "../../prompts/s9_feedback_parse.txt";

const MODEL_S9: AnthropicModel = "claude-sonnet-4-6";

export interface ParseFeedbackEnv {
	UC3_DB: D1Database;
	TTS_CACHE: R2Bucket;
	ANTHROPIC_API_KEY: string;
}

// ── Action vocabulary ─────────────────────────────────────────────────────
// Keep this exhaustive — the dispatcher does runtime validation against these
// shapes. Any unknown type or missing required field gets dropped with a warning.

export type FeedbackAction =
	| { type: "approve" }
	| { type: "revise_module"; emphasis?: string }
	| { type: "regenerate_brief" }
	| { type: "flag_claim"; claim_id?: number | null; claim_text_excerpt?: string | null; notes: string }
	| { type: "change_voice"; voice_id: string; regenerate_brief?: boolean }
	| { type: "defer"; notes?: string };

export interface ParsedFeedback {
	summary: string;
	confidence: "high" | "medium" | "low";
	actions: FeedbackAction[];
}

export interface ParseFeedbackResult {
	ok: boolean;
	module_id: number;
	parsed?: ParsedFeedback;
	prompt_hash?: string;
	dropped?: Array<{ raw: unknown; reason: string }>;
	error?: string;
}

function fillTemplate(tpl: string, vars: Record<string, string | number | null | undefined>): string {
	let out = tpl;
	for (const [k, v] of Object.entries(vars)) {
		out = out.split(`<<${k}>>`).join(v === null || v === undefined ? "(null)" : String(v));
	}
	return out;
}

function validateAction(raw: unknown): { ok: true; action: FeedbackAction } | { ok: false; reason: string } {
	if (!raw || typeof raw !== "object") return { ok: false, reason: "not an object" };
	const a = raw as Record<string, unknown>;
	const type = a.type;
	switch (type) {
		case "approve":
			return { ok: true, action: { type: "approve" } };
		case "regenerate_brief":
			return { ok: true, action: { type: "regenerate_brief" } };
		case "revise_module": {
			const emphasis = typeof a.emphasis === "string" ? a.emphasis : undefined;
			return { ok: true, action: { type: "revise_module", emphasis } };
		}
		case "flag_claim": {
			const notes = typeof a.notes === "string" ? a.notes : "";
			if (!notes.trim()) return { ok: false, reason: "flag_claim missing notes" };
			const claim_id = typeof a.claim_id === "number" ? a.claim_id : null;
			const claim_text_excerpt = typeof a.claim_text_excerpt === "string" ? a.claim_text_excerpt : null;
			if (claim_id === null && !claim_text_excerpt) {
				return { ok: false, reason: "flag_claim needs claim_id or claim_text_excerpt" };
			}
			return { ok: true, action: { type: "flag_claim", claim_id, claim_text_excerpt, notes } };
		}
		case "change_voice": {
			const voice_id = typeof a.voice_id === "string" ? a.voice_id : "";
			if (!voice_id.trim()) return { ok: false, reason: "change_voice missing voice_id" };
			const regenerate_brief = a.regenerate_brief === true;
			return { ok: true, action: { type: "change_voice", voice_id, regenerate_brief } };
		}
		case "defer": {
			const notes = typeof a.notes === "string" ? a.notes : undefined;
			return { ok: true, action: { type: "defer", notes } };
		}
		default:
			return { ok: false, reason: `unknown action type: ${String(type)}` };
	}
}

export async function parseFeedback(
	env: ParseFeedbackEnv,
	module_id: number,
	voice_transcript: string,
): Promise<ParseFeedbackResult> {
	const modRow = await env.UC3_DB
		.prepare("SELECT id, position_in_series, learning_objective FROM learning_modules WHERE id = ?")
		.bind(module_id)
		.first<{ id: number; position_in_series: number; learning_objective: string }>();
	if (!modRow) return { ok: false, module_id, error: `module ${module_id} not found` };

	const claims = await listClaimsByModule(env.UC3_DB, module_id);
	const citations = await listCitationsByModule(env.UC3_DB, module_id);
	const passes = await listVerificationPassesByModule(env.UC3_DB, module_id);
	const latestS7 = [...passes].reverse().find((p) => p.pass_number === 2);
	const brief = await getBriefByModule(env.UC3_DB, module_id);
	const polishedTranscript = await getTranscript(env.TTS_CACHE, module_id);

	const prompt = fillTemplate(S9_PROMPT as unknown as string, {
		MODULE_POSITION: modRow.position_in_series,
		TOTAL_MODULES: 5,
		LEARNING_OBJECTIVE: modRow.learning_objective,
		S7_VERDICT: latestS7?.verdict ?? "unknown",
		S7_RATIONALE: latestS7?.rationale ?? "(no S7 rationale on file)",
		CLAIMS_JSON: JSON.stringify(
			claims.map((c) => ({
				id: c.id,
				claim_text: c.claim_text,
				cited_source: c.cited_source_name,
				verified: c.verified_pass1 === 1,
				needs_human_review: c.needs_human_review === 1,
			})),
		),
		CITATIONS_JSON: JSON.stringify(citations.map((c) => ({ name: c.source_name, url: c.source_url }))),
		POLISHED_TRANSCRIPT: polishedTranscript ?? "(transcript not available in R2)",
		VOICE_ID: brief?.voice_id ?? "(none)",
		VOICE_TRANSCRIPT: voice_transcript,
	});
	const promptHash = await sha256Hex(prompt);

	const r = await callAnthropic({
		apiKey: env.ANTHROPIC_API_KEY,
		model: MODEL_S9,
		user: prompt,
		maxTokens: 2048,
	});
	if (!r.ok || !r.text) {
		await logVerification(env.UC3_DB, {
			module_id,
			stage: "S9-parse",
			model: MODEL_S9,
			prompt_hash: promptHash,
			ok: false,
			error_text: r.error,
		});
		return { ok: false, module_id, prompt_hash: promptHash, error: `S9 Anthropic call failed: ${r.error}` };
	}
	const parsed = extractJson<{
		summary?: string;
		confidence?: string;
		actions?: unknown[];
	}>(r.text);
	if (!parsed || !Array.isArray(parsed.actions)) {
		await logVerification(env.UC3_DB, {
			module_id,
			stage: "S9-parse",
			model: MODEL_S9,
			prompt_hash: promptHash,
			response_json: r.text.slice(0, 4000),
			ok: false,
			error_text: "S9 output did not parse as expected JSON",
		});
		return { ok: false, module_id, prompt_hash: promptHash, error: "S9 output did not parse" };
	}

	const validatedActions: FeedbackAction[] = [];
	const dropped: Array<{ raw: unknown; reason: string }> = [];
	for (const raw of parsed.actions) {
		const v = validateAction(raw);
		if (v.ok) validatedActions.push(v.action);
		else dropped.push({ raw, reason: v.reason });
	}

	const confidence: "high" | "medium" | "low" =
		parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
			? parsed.confidence
			: "medium";

	const summary = typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : "(no summary)";

	await logVerification(env.UC3_DB, {
		module_id,
		stage: "S9-parse",
		model: MODEL_S9,
		prompt_hash: promptHash,
		response_json: JSON.stringify({ summary, confidence, action_count: validatedActions.length, dropped_count: dropped.length }),
		ok: true,
	});

	return {
		ok: true,
		module_id,
		parsed: { summary, confidence, actions: validatedActions },
		prompt_hash: promptHash,
		dropped: dropped.length > 0 ? dropped : undefined,
	};
}
