// §8.4a.21 W6 — review brief script + audio generation.
// Two-stage: generateBriefScript (Sonnet → R2 text) then generateBriefAudio
// (ElevenLabs → R2 mp3). The workflow fires them sequentially per module;
// the manual handler runs both back-to-back.

import { callAnthropic, extractJson, sha256Hex, type AnthropicModel } from "./anthropic";
import {
	listCitationsByModule,
	listAnalogsByModule,
	listClaimsByModule,
	listVerificationPassesByModule,
	upsertBrief,
	updateBriefScript,
	updateBriefAudio,
	markBriefFailed,
	getBriefByModule,
	logVerification,
} from "./d1-uc3";
import { getTranscript } from "./r2-transcripts";
import { putBriefScript, getBriefScript, putBriefAudio } from "./r2-briefs";
import { ttsChunkedToBuffer, ELEVENLABS_DEFAULT_MODEL } from "./tts";
import { resolveVoiceId } from "./voice-rotation";

// @ts-expect-error — Wrangler Text rule
import S8_BRIEF_PROMPT from "../../prompts/s8_review_brief.txt";

const MODEL_S8: AnthropicModel = "claude-sonnet-4-6";

// Default voice used by the Commute Player today. If a future
// ELEVENLABS_DEFAULT_VOICE_ID env var is set, prefer that.
const DEFAULT_VOICE_ID_FALLBACK = "ErXwobaYiN019PkySvjV"; // ElevenLabs "Antoni" — placeholder; override via env

export interface ReviewBriefEnv {
	UC3_DB: D1Database;
	TTS_CACHE: R2Bucket;
	ANTHROPIC_API_KEY: string;
	ELEVENLABS_API_KEY: string;
	ELEVENLABS_DEFAULT_VOICE_ID?: string;
}

export interface BriefScriptResult {
	ok: boolean;
	module_id: number;
	script_r2_key?: string;
	char_count?: number;
	estimated_total_seconds?: number;
	honest_framing_note?: string;
	error?: string;
}

export interface BriefAudioResult {
	ok: boolean;
	module_id: number;
	audio_r2_key?: string;
	audio_bytes?: number;
	voice_id?: string;
	chunks?: number;
	error?: string;
}

function fillTemplate(tpl: string, vars: Record<string, string | number | null | undefined>): string {
	let out = tpl;
	for (const [k, v] of Object.entries(vars)) {
		out = out.split(`<<${k}>>`).join(v === null || v === undefined ? "(null)" : String(v));
	}
	return out;
}

export async function generateBriefScript(env: ReviewBriefEnv, module_id: number): Promise<BriefScriptResult> {
	const modRow = await env.UC3_DB
		.prepare("SELECT id, position_in_series, learning_objective, voice_id FROM learning_modules WHERE id = ?")
		.bind(module_id)
		.first<{ id: number; position_in_series: number; learning_objective: string; voice_id: string | null }>();
	if (!modRow) return { ok: false, module_id, error: `module ${module_id} not found` };

	const transcript = await getTranscript(env.TTS_CACHE, module_id);
	if (!transcript) return { ok: false, module_id, error: "no transcript in R2" };

	const citations = await listCitationsByModule(env.UC3_DB, module_id);
	const analogs = await listAnalogsByModule(env.UC3_DB, module_id);
	const claims = await listClaimsByModule(env.UC3_DB, module_id);
	const passes = await listVerificationPassesByModule(env.UC3_DB, module_id);
	const latestS7 = [...passes].reverse().find((p) => p.pass_number === 2);

	// §8.4a.23 — voice resolution: module's persisted voice_id wins, then env, then rotation by position.
	const voice_id = resolveVoiceId({
		persisted: modRow.voice_id,
		position: modRow.position_in_series,
		envDefault: env.ELEVENLABS_DEFAULT_VOICE_ID ?? DEFAULT_VOICE_ID_FALLBACK,
	});
	await upsertBrief(env.UC3_DB, { module_id, voice_id, model: MODEL_S8, status: "pending" });

	const prompt = fillTemplate(S8_BRIEF_PROMPT as unknown as string, {
		MODULE_POSITION: modRow.position_in_series,
		TOTAL_MODULES: 5,
		LEARNING_OBJECTIVE: modRow.learning_objective,
		POLISHED_TRANSCRIPT: transcript,
		CITATIONS_JSON: JSON.stringify(citations.map((c) => ({ name: c.source_name, url: c.source_url, type: c.source_type }))),
		ANALOGS_JSON: JSON.stringify(analogs.filter((a) => a.advance_to_drafting === 1).map((a) => ({ author: a.analog_author, work: a.analog_work }))),
		CORPUS_SNIPPETS_JSON: "[]",
		S6_TRAIL_JSON: JSON.stringify(claims.map((c) => ({
			claim: c.claim_text,
			source: c.cited_source_name,
			verified: c.verified_pass1 === 1,
			needs_human_review: c.needs_human_review === 1,
		}))),
		S7_VERDICT: latestS7?.verdict ?? "unknown",
		S7_RATIONALE: latestS7?.rationale ?? "(no S7 rationale on file)",
	});
	const promptHash = await sha256Hex(prompt);

	const r = await callAnthropic({
		apiKey: env.ANTHROPIC_API_KEY,
		model: MODEL_S8,
		user: prompt,
		maxTokens: 4096,
	});
	if (!r.ok || !r.text) {
		await markBriefFailed(env.UC3_DB, module_id, `S8 call failed: ${r.error}`);
		await logVerification(env.UC3_DB, { module_id, stage: "S8-script", model: MODEL_S8, prompt_hash: promptHash, ok: false, error_text: r.error });
		return { ok: false, module_id, error: `S8 Anthropic call failed: ${r.error}` };
	}
	const parsed = extractJson<{
		segments?: Array<{ label: string; seconds: number; text: string }>;
		concatenated_script?: string;
		estimated_total_seconds?: number;
		honest_framing_note?: string;
		synthesis_notes?: string;
	}>(r.text);
	if (!parsed || !parsed.concatenated_script) {
		await markBriefFailed(env.UC3_DB, module_id, "S8 output did not parse");
		await logVerification(env.UC3_DB, { module_id, stage: "S8-script", model: MODEL_S8, prompt_hash: promptHash, response_json: r.text.slice(0, 4000), ok: false, error_text: "S8 output did not parse" });
		return { ok: false, module_id, error: "S8 output did not parse" };
	}

	const key = await putBriefScript(env.TTS_CACHE, module_id, parsed.concatenated_script);
	await updateBriefScript(env.UC3_DB, module_id, key, parsed.concatenated_script.length);
	await logVerification(env.UC3_DB, {
		module_id,
		stage: "S8-script",
		model: MODEL_S8,
		prompt_hash: promptHash,
		response_json: JSON.stringify({
			segment_count: parsed.segments?.length ?? 0,
			estimated_total_seconds: parsed.estimated_total_seconds,
			honest_framing_note: parsed.honest_framing_note,
			synthesis_notes: parsed.synthesis_notes,
			char_count: parsed.concatenated_script.length,
		}),
		ok: true,
	});

	return {
		ok: true,
		module_id,
		script_r2_key: key,
		char_count: parsed.concatenated_script.length,
		estimated_total_seconds: parsed.estimated_total_seconds,
		honest_framing_note: parsed.honest_framing_note,
	};
}

export async function generateBriefAudio(env: ReviewBriefEnv, module_id: number): Promise<BriefAudioResult> {
	const brief = await getBriefByModule(env.UC3_DB, module_id);
	if (!brief?.script_r2_key) return { ok: false, module_id, error: "no script in R2; run generateBriefScript first" };

	const script = await getBriefScript(env.TTS_CACHE, module_id);
	if (!script) return { ok: false, module_id, error: "script_r2_key set but R2 fetch returned null" };

	// §8.4a.23 — pull the module's persisted voice_id; brief.voice_id is already
	// in sync because generateBriefScript wrote it. Env override still wins for
	// emergency global voice changes.
	const modRow = await env.UC3_DB
		.prepare("SELECT voice_id, position_in_series FROM learning_modules WHERE id = ?")
		.bind(module_id)
		.first<{ voice_id: string | null; position_in_series: number | null }>();
	const voice_id = resolveVoiceId({
		explicit: env.ELEVENLABS_DEFAULT_VOICE_ID || null,
		persisted: modRow?.voice_id ?? brief.voice_id,
		position: modRow?.position_in_series ?? null,
		envDefault: DEFAULT_VOICE_ID_FALLBACK,
	});
	const r = await ttsChunkedToBuffer(script, voice_id, ELEVENLABS_DEFAULT_MODEL, undefined, env.ELEVENLABS_API_KEY);
	if (!r.ok) {
		await markBriefFailed(env.UC3_DB, module_id, `TTS failed: ${r.error}`);
		await logVerification(env.UC3_DB, { module_id, stage: "S8-tts", ok: false, error_text: r.error });
		return { ok: false, module_id, error: `TTS call failed: ${r.error}` };
	}
	const key = await putBriefAudio(env.TTS_CACHE, module_id, r.buf);
	await updateBriefAudio(env.UC3_DB, module_id, key, r.buf.byteLength);
	await logVerification(env.UC3_DB, {
		module_id,
		stage: "S8-tts",
		response_json: JSON.stringify({ audio_bytes: r.buf.byteLength, voice_id, chunks: r.chunkCount }),
		ok: true,
	});
	return { ok: true, module_id, audio_r2_key: key, audio_bytes: r.buf.byteLength, voice_id, chunks: r.chunkCount };
}

export async function generateBrief(env: ReviewBriefEnv, module_id: number): Promise<{ ok: boolean; module_id: number; script?: BriefScriptResult; audio?: BriefAudioResult; error?: string }> {
	// §archive — refuse to spend LLM/TTS budget on archived modules
	const statusRow = await env.UC3_DB
		.prepare("SELECT status FROM learning_modules WHERE id = ?")
		.bind(module_id)
		.first<{ status: string }>();
	if (statusRow?.status === "archived") {
		return { ok: false, module_id, error: "module is archived; un-archive first to regenerate brief" };
	}
	const script = await generateBriefScript(env, module_id);
	if (!script.ok) return { ok: false, module_id, script, error: script.error };
	const audio = await generateBriefAudio(env, module_id);
	if (!audio.ok) return { ok: false, module_id, script, audio, error: audio.error };
	return { ok: true, module_id, script, audio };
}
