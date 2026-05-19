// §8.4a.21 W5+ — Module revision loop: takes a module that S7 flagged as
// `revise`, applies a targeted Sonnet-driven revision addressing the specific
// failed claims + S7 rationale, then re-runs S6 verify + S7 judge to confirm
// the fix landed.

import { callAnthropic, extractJson, sha256Hex, type AnthropicModel } from "./anthropic";
import {
	listCitationsByModule,
	listClaimsByModule,
	listVerificationPassesByModule,
	insertClaim,
	setClaimVerification,
	flagClaimForHumanReview,
	insertVerificationPass,
	logVerification,
} from "./d1-uc3";
import { putTranscript, getTranscript } from "./r2-transcripts";

// @ts-expect-error — Wrangler Text rule
import S7_REVISE_PROMPT from "../../prompts/s7_revise_module.txt";
// @ts-expect-error — Wrangler Text rule
import S6_CLAIM_EXTRACT_PROMPT from "../../prompts/s6_claim_extract.txt";
// @ts-expect-error — Wrangler Text rule
import S6_CLAIMS_VERIFY_BATCH_PROMPT from "../../prompts/s6_claims_verify_batch.txt";
// @ts-expect-error — Wrangler Text rule
import S7_MODULE_JUDGE_PROMPT from "../../prompts/s7_module_judge.txt";

const MODEL_REVISE: AnthropicModel = "claude-sonnet-4-6";
const MODEL_S6_EXTRACT: AnthropicModel = "claude-sonnet-4-6";
const MODEL_S6_VERIFY: AnthropicModel = "claude-sonnet-4-6";
const MODEL_S7: AnthropicModel = "claude-sonnet-4-6";

export interface ReviseModuleEnv {
	UC3_DB: D1Database;
	TTS_CACHE: R2Bucket;
	ANTHROPIC_API_KEY: string;
}

export interface ReviseModuleResult {
	ok: boolean;
	module_id: number;
	revised: boolean;
	error?: string;
	pre_revision: {
		s6_verdict?: string;
		s7_verdict?: string;
		s7_rationale?: string;
		failed_claim_count: number;
	};
	post_revision?: {
		s6_verified: number;
		s6_failed: number;
		s7_verdict: string;
		s7_rationale: string;
		changes_made: number;
		claims_dropped: number;
	};
}

function fillTemplate(tpl: string, vars: Record<string, string | number | null | undefined>): string {
	let out = tpl;
	for (const [k, v] of Object.entries(vars)) {
		out = out.split(`<<${k}>>`).join(v === null || v === undefined ? "(null)" : String(v));
	}
	return out;
}

export async function reviseModule(env: ReviseModuleEnv, module_id: number): Promise<ReviseModuleResult> {
	// 1. Load context: module + transcript + claims + S7 rationale + citations
	const modRow = await env.UC3_DB
		.prepare("SELECT id, position_in_series, learning_objective FROM learning_modules WHERE id = ?")
		.bind(module_id)
		.first<{ id: number; position_in_series: number; learning_objective: string }>();
	if (!modRow) return { ok: false, module_id, revised: false, error: `module ${module_id} not found`, pre_revision: { failed_claim_count: 0 } };

	const transcript = await getTranscript(env.TTS_CACHE, module_id);
	if (!transcript) return { ok: false, module_id, revised: false, error: "no transcript in R2", pre_revision: { failed_claim_count: 0 } };

	const claims = await listClaimsByModule(env.UC3_DB, module_id);
	const failedClaims = claims.filter((c) => c.verified_pass1 === 0);
	const passes = await listVerificationPassesByModule(env.UC3_DB, module_id);
	const lastS6 = [...passes].reverse().find((p) => p.pass_number === 1);
	const lastS7 = [...passes].reverse().find((p) => p.pass_number === 2);
	const citations = await listCitationsByModule(env.UC3_DB, module_id);

	const pre = {
		s6_verdict: lastS6?.verdict,
		s7_verdict: lastS7?.verdict,
		s7_rationale: lastS7?.rationale ?? undefined,
		failed_claim_count: failedClaims.length,
	};

	// Skip if nothing to revise.
	if (lastS7?.verdict !== "revise" && failedClaims.length === 0) {
		return { ok: true, module_id, revised: false, error: "nothing to revise", pre_revision: pre };
	}

	// 2. Revise transcript via Sonnet.
	const revisePrompt = fillTemplate(S7_REVISE_PROMPT as unknown as string, {
		MODULE_POSITION: modRow.position_in_series,
		TOTAL_MODULES: 5,
		LEARNING_OBJECTIVE: modRow.learning_objective,
		POLISHED_TRANSCRIPT: transcript,
		FAILED_CLAIMS_JSON: JSON.stringify(failedClaims.map((c) => ({
			claim_text: c.claim_text,
			cited_source_name: c.cited_source_name,
			cited_source_url: c.cited_source_url,
			notes: c.verification_notes,
		}))),
		S7_RATIONALE: lastS7?.rationale ?? "(no S7 rationale available)",
		CITATIONS_JSON: JSON.stringify(citations.map((c) => ({ name: c.source_name, url: c.source_url }))),
	});
	const revisePromptHash = await sha256Hex(revisePrompt);
	const r = await callAnthropic({
		apiKey: env.ANTHROPIC_API_KEY,
		model: MODEL_REVISE,
		user: revisePrompt,
		maxTokens: 8192,
		timeoutMs: 240_000, // revise generates up to 8K tokens; 120s default too tight
	});
	if (!r.ok || !r.text) {
		await logVerification(env.UC3_DB, {
			module_id,
			stage: "revise",
			model: MODEL_REVISE,
			prompt_hash: revisePromptHash,
			ok: false,
			error_text: r.error,
		});
		return { ok: false, module_id, revised: false, error: `revise call failed: ${r.error}`, pre_revision: pre };
	}
	const parsed = extractJson<{
		revised_transcript?: string;
		changes_made?: Array<{ issue: string; fix: string }>;
		claims_dropped?: number;
		estimated_total_seconds?: number;
		revision_notes?: string;
	}>(r.text);
	if (!parsed || !parsed.revised_transcript) {
		await logVerification(env.UC3_DB, {
			module_id,
			stage: "revise",
			model: MODEL_REVISE,
			prompt_hash: revisePromptHash,
			response_json: r.text.slice(0, 4000),
			ok: false,
			error_text: "revise output did not parse",
		});
		return { ok: false, module_id, revised: false, error: "revise output did not parse", pre_revision: pre };
	}

	// Persist revised transcript to R2 (overwrites prior; previous version replaced).
	await putTranscript(env.TTS_CACHE, module_id, parsed.revised_transcript);
	await logVerification(env.UC3_DB, {
		module_id,
		stage: "revise",
		model: MODEL_REVISE,
		prompt_hash: revisePromptHash,
		response_json: JSON.stringify({
			changes_made: parsed.changes_made,
			claims_dropped: parsed.claims_dropped,
			estimated_total_seconds: parsed.estimated_total_seconds,
			revision_notes: parsed.revision_notes,
			transcript_preview: parsed.revised_transcript.slice(0, 400) + "…",
		}),
		ok: true,
	});

	// 3. Re-extract claims via Sonnet.
	const extractPrompt = fillTemplate(S6_CLAIM_EXTRACT_PROMPT as unknown as string, {
		LEARNING_OBJECTIVE: modRow.learning_objective,
		POLISHED_TRANSCRIPT: parsed.revised_transcript,
		CITATIONS_JSON: JSON.stringify(citations.map((c) => ({ name: c.source_name, url: c.source_url }))),
	});
	const extractHash = await sha256Hex(extractPrompt);
	const extractR = await callAnthropic({
		apiKey: env.ANTHROPIC_API_KEY,
		model: MODEL_S6_EXTRACT,
		user: extractPrompt,
		maxTokens: 3072,
	});
	if (!extractR.ok || !extractR.text) {
		await logVerification(env.UC3_DB, {
			module_id,
			stage: "revise-S6-extract",
			model: MODEL_S6_EXTRACT,
			prompt_hash: extractHash,
			ok: false,
			error_text: extractR.error,
		});
		return { ok: false, module_id, revised: true, error: `re-extract failed: ${extractR.error}`, pre_revision: pre };
	}
	const extractParsed = extractJson<{
		claims?: Array<{ claim_text: string; cited_source_name?: string | null; cited_source_url?: string | null }>;
	}>(extractR.text);
	const newClaims = extractParsed?.claims ?? [];

	// Insert new claim rows (associate to first section as before; per-section
	// granularity is a polish item).
	const sectionsR = await env.UC3_DB
		.prepare("SELECT id FROM module_sections WHERE module_id = ? ORDER BY position ASC LIMIT 1")
		.bind(module_id)
		.first<{ id: number }>();
	const sectionIdFallback = sectionsR?.id ?? 0;
	const claimIds: Array<{ id: number; claim_text: string; source_name: string | null; source_url: string | null }> = [];
	for (const c of newClaims) {
		const id = await insertClaim(env.UC3_DB, {
			section_id: sectionIdFallback,
			module_id,
			claim_text: c.claim_text,
			cited_source_name: c.cited_source_name ?? null,
			cited_source_url: c.cited_source_url ?? null,
		});
		claimIds.push({
			id,
			claim_text: c.claim_text,
			source_name: c.cited_source_name ?? null,
			source_url: c.cited_source_url ?? null,
		});
	}
	await logVerification(env.UC3_DB, {
		module_id,
		stage: "revise-S6-extract",
		model: MODEL_S6_EXTRACT,
		prompt_hash: extractHash,
		response_json: JSON.stringify({ new_claim_count: newClaims.length }),
		ok: true,
	});

	// 4. Re-verify via Sonnet batched.
	let postVerified = 0;
	let postFailed = 0;
	if (claimIds.length > 0) {
		const verifyPrompt = fillTemplate(S6_CLAIMS_VERIFY_BATCH_PROMPT as unknown as string, {
			LEARNING_OBJECTIVE: modRow.learning_objective,
			CLAIMS_JSON: JSON.stringify(claimIds.map((c) => ({
				id: c.id,
				claim_text: c.claim_text,
				cited_source_name: c.source_name,
				cited_source_url: c.source_url,
			}))),
		});
		const verifyR = await callAnthropic({
			apiKey: env.ANTHROPIC_API_KEY,
			model: MODEL_S6_VERIFY,
			user: verifyPrompt,
			maxTokens: 4096,
		});
		if (!verifyR.ok || !verifyR.text) {
			for (const c of claimIds) {
				await setClaimVerification(env.UC3_DB, c.id, false, `revise re-verify failed: ${verifyR.error}`);
				await flagClaimForHumanReview(env.UC3_DB, c.id);
				postFailed += 1;
			}
		} else {
			const vParsed = extractJson<{
				verdicts?: Array<{ id: number; verified?: boolean; notes?: string }>;
			}>(verifyR.text);
			const verdictById = new Map<number, { verified: boolean; notes: string | null }>();
			for (const v of vParsed?.verdicts ?? []) {
				verdictById.set(v.id, { verified: v.verified === true, notes: v.notes ?? null });
			}
			for (const c of claimIds) {
				const v = verdictById.get(c.id) ?? { verified: false, notes: "no verdict returned (revise re-verify)" };
				await setClaimVerification(env.UC3_DB, c.id, v.verified, v.notes);
				if (v.verified) {
					postVerified += 1;
				} else {
					await flagClaimForHumanReview(env.UC3_DB, c.id);
					postFailed += 1;
				}
			}
		}
		await insertVerificationPass(env.UC3_DB, {
			module_id,
			pass_number: 1,
			pass_type: "per_claim_post_revise",
			model: MODEL_S6_VERIFY,
			verdict: postFailed === 0 ? "approved" : "revise",
			rationale: `post-revise: verified ${postVerified}/${claimIds.length} claims; ${postFailed} failed`,
		});
	}

	// 5. Re-judge via S7.
	const s6Trail = (await listClaimsByModule(env.UC3_DB, module_id)).map((c) => ({
		claim: c.claim_text,
		source: c.cited_source_name,
		verified: c.verified_pass1 === 1,
		needs_human_review: c.needs_human_review === 1,
		notes: c.verification_notes,
	}));
	const judgePrompt = fillTemplate(S7_MODULE_JUDGE_PROMPT as unknown as string, {
		MODULE_POSITION: modRow.position_in_series,
		TOTAL_MODULES: 5,
		LEARNING_OBJECTIVE: modRow.learning_objective,
		POLISHED_TRANSCRIPT: parsed.revised_transcript,
		CITATIONS_JSON: JSON.stringify(citations.map((c) => ({ name: c.source_name, url: c.source_url }))),
		S6_TRAIL_JSON: JSON.stringify(s6Trail),
	});
	const judgeHash = await sha256Hex(judgePrompt);
	const judgeR = await callAnthropic({
		apiKey: env.ANTHROPIC_API_KEY,
		model: MODEL_S7,
		user: judgePrompt,
		maxTokens: 2048,
	});
	let postS7Verdict = "revise";
	let postS7Rationale = "S7 re-judge call failed";
	if (!judgeR.ok || !judgeR.text) {
		await logVerification(env.UC3_DB, {
			module_id,
			stage: "revise-S7",
			model: MODEL_S7,
			prompt_hash: judgeHash,
			ok: false,
			error_text: judgeR.error,
		});
		postS7Rationale = `S7 re-judge call failed: ${judgeR.error}`;
	} else {
		const jParsed = extractJson<{ verdict?: string; rationale?: string }>(judgeR.text);
		postS7Verdict = jParsed?.verdict === "approved" || jParsed?.verdict === "reject" ? jParsed.verdict : "revise";
		postS7Rationale = jParsed?.rationale ?? "(no rationale)";
		await logVerification(env.UC3_DB, {
			module_id,
			stage: "revise-S7",
			model: MODEL_S7,
			prompt_hash: judgeHash,
			response_json: JSON.stringify(jParsed),
			ok: true,
		});
	}
	await insertVerificationPass(env.UC3_DB, {
		module_id,
		pass_number: 2,
		pass_type: "post_revise_pedagogy",
		model: MODEL_S7,
		verdict: postS7Verdict,
		rationale: postS7Rationale,
	});

	return {
		ok: true,
		module_id,
		revised: true,
		pre_revision: pre,
		post_revision: {
			s6_verified: postVerified,
			s6_failed: postFailed,
			s7_verdict: postS7Verdict,
			s7_rationale: postS7Rationale,
			changes_made: parsed.changes_made?.length ?? 0,
			claims_dropped: parsed.claims_dropped ?? 0,
		},
	};
}
