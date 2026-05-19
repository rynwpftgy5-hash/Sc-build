// §8.4a.21 W7 — S10 revision dispatch.
// Takes parsed FeedbackActions from S9 + a module_id, executes each action
// sequentially via the appropriate existing pipeline lib function, and returns
// per-action results.

import {
	flagClaimForHumanReview,
	setClaimVerification,
	setModuleStatus,
	listClaimsByModule,
	listSectionsByModule,
	insertClaim,
	updateBriefVoice,
	logVerification,
	type SectionClaimRow,
} from "./d1-uc3";
import { reviseModule, type ReviseModuleResult } from "./revise-module";
import { generateBrief, generateBriefAudio, type BriefAudioResult } from "./review-brief";
import { getTranscript } from "./r2-transcripts";
import { scheduleApprovedModule } from "./spaced-rep";
import type { FeedbackAction } from "./feedback-parser";
import type { ModuleTtsMessage } from "./queues";

export interface DispatchFeedbackEnv {
	UC3_DB: D1Database;
	TTS_CACHE: R2Bucket;
	ANTHROPIC_API_KEY: string;
	ELEVENLABS_API_KEY: string;
	ELEVENLABS_DEFAULT_VOICE_ID?: string;
	// §8.4a.21 W8.1 — Module TTS queue (replaces W8 ctx.waitUntil).
	// Each approved module enqueues one message; consumer fires generateModuleAudio
	// in a fresh Worker invocation. ctx.waitUntil retained for fast paths (spaced-rep).
	MODULE_TTS_QUEUE: Queue<ModuleTtsMessage>;
	// ExecutionContext for fire-and-forget side effects on approve (used for
	// the still-fast spaced-rep schedule INSERT path).
	CTX?: ExecutionContext;
}

export interface ActionResult {
	action: FeedbackAction;
	ok: boolean;
	result?: unknown;
	error?: string;
}

export interface DispatchFeedbackResult {
	ok: boolean;
	module_id: number;
	results: ActionResult[];
	summary: string;
	status: "dispatched" | "partial" | "failed";
}

// ── Helpers ───────────────────────────────────────────────────────────────

// Stopwords for the *fuzzy claim* matcher — tight, because we need to avoid
// matching unrelated claims on common-noise word overlap. Used with a >3-char
// token filter, which is the W7 baseline that didn't produce false positives.
const FUZZY_CLAIM_STOPWORDS = new Set([
	"have", "been", "this", "that", "with", "from", "into", "about", "their",
	"there", "which", "would", "could", "should", "these", "those", "where",
	"when", "what", "while", "after", "before", "because", "also", "even",
	"just", "like", "only", "very", "your", "ours", "them", "they", "some",
	"such", "than", "then", "must", "will", "make", "made", "many", "much",
	"one", "two", "three", "four", "five", "ten", "any", "all", "every",
	"each", "more", "most", "less", "least", "first", "second", "third",
	"next", "last", "same", "other", "another", "now", "here",
]);

// Looser stopwords for *transcript* substring search — we keep more tokens
// because the transcript has more text to disambiguate; we don't need to be
// as aggressive about filtering filler.
const TRANSCRIPT_SEARCH_STOPWORDS = new Set([
	"have", "been", "this", "that", "with", "from", "into", "about", "their",
	"there", "which", "would", "could", "should", "these", "those", "where",
	"when", "what", "while", "after", "before", "because",
]);

function fuzzyClaimTokens(s: string): string[] {
	// >3 chars + tight stopwords — same shape as W7 baseline.
	return s
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.split(/\s+/)
		.filter((t) => t.length > 3 && !FUZZY_CLAIM_STOPWORDS.has(t));
}

function transcriptSearchTokens(s: string): string[] {
	// >=3 chars + loose stopwords — keeps short distinctive tokens like "SEC".
	return s
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.split(/\s+/)
		.filter((t) => t.length >= 3 && !TRANSCRIPT_SEARCH_STOPWORDS.has(t));
}

// Fuzzy match a claim_text_excerpt against the module's claims. Picks the row
// whose normalized claim_text has the longest common-token overlap with the
// excerpt. Returns null if no claim has >=2 token overlap (avoids accidental
// false matches on common stop-word noise).
function fuzzyMatchClaim(claims: SectionClaimRow[], excerpt: string): SectionClaimRow | null {
	const ex = new Set(fuzzyClaimTokens(excerpt));
	if (ex.size < 2) return null;
	let best: { row: SectionClaimRow; overlap: number } | null = null;
	for (const c of claims) {
		const ct = new Set(fuzzyClaimTokens(c.claim_text));
		let overlap = 0;
		for (const t of ex) if (ct.has(t)) overlap += 1;
		// Require ≥3 overlap — empirical: ≥2 produced false positives where the
		// excerpt and an unrelated claim shared only generic-noise tokens. W7.1
		// regression: "doctor's annual checkup" excerpt false-matched a CFA
		// Institute claim on "one"+"your" overlap.
		if (overlap < 3) continue;
		if (!best || overlap > best.overlap) best = { row: c, overlap };
	}
	return best?.row ?? null;
}

// §8.4a.21 W7.1 — transcript fallback for flag_claim.
//
// When fuzzyMatchClaim returns null (excerpt didn't match any tracked
// section_claims row), the claim may live in the polished transcript narrative
// but never got extracted as a claim row (S6 extract was selective). Search
// the transcript itself for the excerpt; if found, the dispatcher inserts a
// new claim row with the found sentence as claim_text + flags it.
//
// Two-tier scoring:
//   1. Verbatim substring match (any 5+ char run of the excerpt appearing
//      verbatim in a transcript sentence) — preferred. The W7.1 S9 prompt
//      instructs the parser to copy verbatim quotes from the transcript, so
//      this should hit on the well-formed case.
//   2. Fallback bigram + distinctive-token scoring for paraphrased excerpts.
//      Score = bigram_hits × 2 + token_hits. Threshold scales with excerpt
//      length: short excerpts (<5 distinctive tokens) accept score ≥ 2;
//      longer excerpts require ≥ 3 (fewer false positives with more signal).
export function findExcerptInTranscript(
	transcript: string,
	excerpt: string,
): { found: boolean; context?: string; score?: number; match_kind?: "verbatim" | "fuzzy" } {
	const exDistinctive = transcriptSearchTokens(excerpt);
	if (exDistinctive.length === 0) return { found: false };

	const sentences = transcript.match(/[^.!?]+[.!?]+/g) ?? [transcript];

	// ── Tier 1: verbatim substring ────────────────────────────────────────
	// Build the longest stretch of the excerpt that's a meaningful run (drop
	// leading/trailing whitespace + punctuation). Check if any transcript
	// sentence contains it (case-insensitive). Also try the full excerpt
	// itself and progressively shorter prefixes/suffixes.
	const exNorm = excerpt.toLowerCase().replace(/\s+/g, " ").trim();
	const exClean = exNorm.replace(/^[^\w]+|[^\w]+$/g, "");
	const verbatimCandidates: string[] = [];
	if (exClean.length >= 12) verbatimCandidates.push(exClean);
	// Sliding window of contiguous tokens (8, 6, 4-word) for partial verbatim
	// match if the full excerpt doesn't appear cleanly.
	const tokens = exClean.split(" ").filter(Boolean);
	for (const w of [8, 6, 4]) {
		if (tokens.length < w) continue;
		for (let i = 0; i + w <= tokens.length; i++) {
			verbatimCandidates.push(tokens.slice(i, i + w).join(" "));
		}
	}
	for (const sentRaw of sentences) {
		const sentNorm = sentRaw.toLowerCase().replace(/\s+/g, " ");
		for (const cand of verbatimCandidates) {
			if (cand.length >= 12 && sentNorm.includes(cand)) {
				return { found: true, context: sentRaw.trim(), score: 100, match_kind: "verbatim" };
			}
		}
	}

	// ── Tier 2: bigram + distinctive-token scoring (paraphrase fallback) ──
	const rawTokens = exClean.split(" ").filter(Boolean);
	const bigrams: string[] = [];
	for (let i = 0; i < rawTokens.length - 1; i++) {
		bigrams.push(`${rawTokens[i]} ${rawTokens[i + 1]}`);
	}
	let best: { sentence: string; score: number } | null = null;
	for (const sentRaw of sentences) {
		const sentNorm = ` ${sentRaw.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim()} `;
		let bigramHits = 0;
		for (const bg of bigrams) if (sentNorm.includes(` ${bg} `)) bigramHits += 1;
		let tokenHits = 0;
		for (const t of exDistinctive) if (sentNorm.includes(` ${t} `)) tokenHits += 1;
		const score = bigramHits * 2 + tokenHits;
		// Short excerpts (≤4 distinctive tokens) accept score ≥ 2; longer ≥ 3.
		const threshold = exDistinctive.length <= 4 ? 2 : 3;
		if (score < threshold) continue;
		if (!best || score > best.score) best = { sentence: sentRaw.trim(), score };
	}
	return best ? { found: true, context: best.sentence, score: best.score, match_kind: "fuzzy" } : { found: false };
}

// ── Per-action handlers ───────────────────────────────────────────────────

async function doApprove(env: DispatchFeedbackEnv, module_id: number): Promise<ActionResult> {
	const action: FeedbackAction = { type: "approve" };
	try {
		await setModuleStatus(env.UC3_DB, module_id, "approved");
		await logVerification(env.UC3_DB, {
			module_id,
			stage: "S10-approve",
			response_json: JSON.stringify({ new_status: "approved" }),
			ok: true,
		});
		// §8.4a.21 W8.1 — Side effects on approve:
		//   • Full-module TTS → ENQUEUE to MODULE_TTS_QUEUE (each message gets
		//     a fresh Worker invocation with own subrequest + wall-time budget;
		//     replaces W8's ctx.waitUntil(generateModuleAudio) which got killed
		//     mid-execution by the runtime on multi-minute TTS work).
		//   • Spaced-rep schedule → still via ctx.waitUntil (fast, ~1s; works fine).
		const side_effects: string[] = [];
		try {
			await env.MODULE_TTS_QUEUE.send({ module_id, source: "approve" });
			side_effects.push("module-audio (queued)");
		} catch (err) {
			await logVerification(env.UC3_DB, {
				module_id,
				stage: "S11-tts-enqueue",
				ok: false,
				error_text: `queue.send failed: ${(err as Error).message}`,
			});
			side_effects.push(`module-audio enqueue failed: ${(err as Error).message}`);
		}
		if (env.CTX) {
			env.CTX.waitUntil(
				scheduleApprovedModule(env.UC3_DB, module_id).catch((e) =>
					logVerification(env.UC3_DB, { module_id, stage: "S12-spaced-rep", ok: false, error_text: (e as Error).message }).catch(() => {}),
				),
			);
			side_effects.push("spaced-rep-schedule (background)");
		}
		return { action, ok: true, result: { new_status: "approved", side_effects } };
	} catch (err) {
		const msg = (err as Error).message;
		await logVerification(env.UC3_DB, { module_id, stage: "S10-approve", ok: false, error_text: msg });
		return { action, ok: false, error: msg };
	}
}

async function doReviseModule(
	env: DispatchFeedbackEnv,
	module_id: number,
	action: Extract<FeedbackAction, { type: "revise_module" }>,
): Promise<ActionResult> {
	try {
		// If Campbell included emphasis text, log it into the verification trail
		// FIRST so the reviseModule call's S7 context includes it. (reviseModule
		// reads the latest S7 rationale; we don't have a clean append point, so
		// we log a synthetic S7 pass with the emphasis appended to its rationale.)
		if (action.emphasis && action.emphasis.trim()) {
			const now = Math.floor(Date.now() / 1000);
			// Append a synthetic S7-style row to verification_passes with the emphasis
			// so reviseModule picks it up as the "latest S7 rationale" to act on.
			await env.UC3_DB
				.prepare(
					`INSERT INTO verification_passes (module_id, pass_number, pass_type, model, verdict, rationale, decided_at)
					 VALUES (?, 2, 'campbell_feedback', 'human', 'revise', ?, ?)`,
				)
				.bind(module_id, `Campbell feedback emphasis: ${action.emphasis}`, now)
				.run();
		}
		const result: ReviseModuleResult = await reviseModule(env, module_id);
		// Reflect post-revise S7 verdict in module status.
		if (result.ok && result.post_revision?.s7_verdict === "approved") {
			await setModuleStatus(env.UC3_DB, module_id, "review-brief-pending");
		}
		return { action, ok: result.ok, result };
	} catch (err) {
		const msg = (err as Error).message;
		await logVerification(env.UC3_DB, { module_id, stage: "S10-revise_module", ok: false, error_text: msg });
		return { action, ok: false, error: msg };
	}
}

async function doRegenerateBrief(env: DispatchFeedbackEnv, module_id: number): Promise<ActionResult> {
	const action: FeedbackAction = { type: "regenerate_brief" };
	try {
		const result = await generateBrief(env, module_id);
		return { action, ok: result.ok, result };
	} catch (err) {
		const msg = (err as Error).message;
		await logVerification(env.UC3_DB, { module_id, stage: "S10-regenerate_brief", ok: false, error_text: msg });
		return { action, ok: false, error: msg };
	}
}

async function doFlagClaim(
	env: DispatchFeedbackEnv,
	module_id: number,
	action: Extract<FeedbackAction, { type: "flag_claim" }>,
): Promise<ActionResult> {
	try {
		let claim_id: number | null = action.claim_id ?? null;
		let matched_by: "id" | "fuzzy_claim" | "transcript_search" | "none" = "none";
		let transcript_context: string | undefined;
		let transcript_score: number | undefined;

		if (claim_id) {
			matched_by = "id";
		} else if (action.claim_text_excerpt) {
			// Resolution order (W7.1 revised after dry-run #5 false-positive):
			//   1. Verbatim substring match in polished transcript (Tier 1) —
			//      most precise. When S9 provides a real verbatim quote (8+
			//      contiguous words from the transcript), this should hit.
			//   2. fuzzy_claim against section_claims (token overlap ≥ 3).
			//   3. Fuzzy paraphrase match in polished transcript (Tier 2,
			//      bigram + distinctive token scoring).
			// This order prevents the issue where fuzzy_claim matches a
			// tangentially-related claim on incidental token overlap when a
			// more precise verbatim-substring match would have found the
			// actual flagged content.
			const transcript = await getTranscript(env.TTS_CACHE, module_id);
			let found = transcript ? findExcerptInTranscript(transcript, action.claim_text_excerpt) : { found: false };

			if (found.found && found.match_kind === "verbatim" && found.context) {
				const sections = await listSectionsByModule(env.UC3_DB, module_id);
				const section_id = sections[0]?.id ?? 0;
				claim_id = await insertClaim(env.UC3_DB, {
					section_id,
					module_id,
					claim_text: found.context.slice(0, 500),
					cited_source_name: null,
					cited_source_url: null,
				});
				matched_by = "transcript_search";
				transcript_context = found.context;
				transcript_score = found.score;
			} else {
				const claims = await listClaimsByModule(env.UC3_DB, module_id);
				const match = fuzzyMatchClaim(claims, action.claim_text_excerpt);
				if (match) {
					claim_id = match.id;
					matched_by = "fuzzy_claim";
				} else if (found.found && found.context) {
					// Tier 2 fuzzy transcript match — still better than failing.
					const sections = await listSectionsByModule(env.UC3_DB, module_id);
					const section_id = sections[0]?.id ?? 0;
					claim_id = await insertClaim(env.UC3_DB, {
						section_id,
						module_id,
						claim_text: found.context.slice(0, 500),
						cited_source_name: null,
						cited_source_url: null,
					});
					matched_by = "transcript_search";
					transcript_context = found.context;
					transcript_score = found.score;
				}
			}
		}

		if (!claim_id) {
			const msg = "could not resolve a claim_id (no id given; fuzzy match against section_claims and transcript-text fallback both failed)";
			await logVerification(env.UC3_DB, { module_id, stage: "S10-flag_claim", ok: false, error_text: msg });
			return { action, ok: false, error: msg };
		}
		await flagClaimForHumanReview(env.UC3_DB, claim_id);
		await setClaimVerification(env.UC3_DB, claim_id, false, `Campbell flagged: ${action.notes}`);
		await logVerification(env.UC3_DB, {
			module_id,
			stage: "S10-flag_claim",
			response_json: JSON.stringify({ claim_id, matched_by, notes: action.notes, transcript_score }),
			ok: true,
		});
		return {
			action,
			ok: true,
			result: { claim_id, matched_by, transcript_context, transcript_score },
		};
	} catch (err) {
		const msg = (err as Error).message;
		await logVerification(env.UC3_DB, { module_id, stage: "S10-flag_claim", ok: false, error_text: msg });
		return { action, ok: false, error: msg };
	}
}

async function doChangeVoice(
	env: DispatchFeedbackEnv,
	module_id: number,
	action: Extract<FeedbackAction, { type: "change_voice" }>,
): Promise<ActionResult> {
	try {
		// §8.4a.23 — persist on the module too so future brief + module audio
		// regenerations pick up the override. Without this, change_voice only
		// affected the brief audio row.
		await env.UC3_DB
			.prepare("UPDATE learning_modules SET voice_id = ? WHERE id = ?")
			.bind(action.voice_id, module_id)
			.run();
		await updateBriefVoice(env.UC3_DB, module_id, action.voice_id);
		await logVerification(env.UC3_DB, {
			module_id,
			stage: "S10-change_voice",
			response_json: JSON.stringify({ voice_id: action.voice_id, regenerate_brief: action.regenerate_brief === true }),
			ok: true,
		});
		let audioResult: BriefAudioResult | undefined;
		if (action.regenerate_brief === true) {
			audioResult = await generateBriefAudio(env, module_id);
		}
		return { action, ok: true, result: { voice_id: action.voice_id, audio: audioResult } };
	} catch (err) {
		const msg = (err as Error).message;
		await logVerification(env.UC3_DB, { module_id, stage: "S10-change_voice", ok: false, error_text: msg });
		return { action, ok: false, error: msg };
	}
}

async function doDefer(
	env: DispatchFeedbackEnv,
	module_id: number,
	action: Extract<FeedbackAction, { type: "defer" }>,
): Promise<ActionResult> {
	try {
		await logVerification(env.UC3_DB, {
			module_id,
			stage: "S10-defer",
			response_json: JSON.stringify({ notes: action.notes ?? null }),
			ok: true,
		});
		return { action, ok: true, result: { deferred: true, notes: action.notes ?? null } };
	} catch (err) {
		const msg = (err as Error).message;
		return { action, ok: false, error: msg };
	}
}

// ── Public entry point ────────────────────────────────────────────────────

export async function dispatchFeedback(
	env: DispatchFeedbackEnv,
	module_id: number,
	actions: FeedbackAction[],
): Promise<DispatchFeedbackResult> {
	const results: ActionResult[] = [];
	for (const action of actions) {
		let r: ActionResult;
		switch (action.type) {
			case "approve":
				r = await doApprove(env, module_id);
				break;
			case "revise_module":
				r = await doReviseModule(env, module_id, action);
				break;
			case "regenerate_brief":
				r = await doRegenerateBrief(env, module_id);
				break;
			case "flag_claim":
				r = await doFlagClaim(env, module_id, action);
				break;
			case "change_voice":
				r = await doChangeVoice(env, module_id, action);
				break;
			case "defer":
				r = await doDefer(env, module_id, action);
				break;
		}
		results.push(r);
	}

	const okCount = results.filter((r) => r.ok).length;
	const totalCount = results.length;
	let status: DispatchFeedbackResult["status"];
	if (totalCount === 0) status = "dispatched";
	else if (okCount === totalCount) status = "dispatched";
	else if (okCount === 0) status = "failed";
	else status = "partial";

	return {
		ok: okCount === totalCount,
		module_id,
		results,
		summary: `${okCount}/${totalCount} actions succeeded`,
		status,
	};
}
