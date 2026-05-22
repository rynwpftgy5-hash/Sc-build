// §8.4a.21 W8 — S11 full-module TTS.
// Takes the polished module transcript from R2 (W5+ output), synthesizes the
// full ~10-min audio via ElevenLabs (chunked), stores at modules/module-{id}.mp3.

import { getTranscript } from "./r2-transcripts";
import { putModuleAudio } from "./r2-modules";
import { ttsChunkedToBuffer, ELEVENLABS_DEFAULT_MODEL } from "./tts";
import { getBriefByModule, logVerification } from "./d1-uc3";
import { resolveVoiceId } from "./voice-rotation";

// Default voice if no rotation pick + no persisted + no env override.
const DEFAULT_VOICE_ID_FALLBACK = "ErXwobaYiN019PkySvjV";

export interface ModuleAudioEnv {
	UC3_DB: D1Database;
	TTS_CACHE: R2Bucket;
	ELEVENLABS_API_KEY: string;
	ELEVENLABS_DEFAULT_VOICE_ID?: string;
}

export interface ModuleAudioResult {
	ok: boolean;
	module_id: number;
	audio_r2_key?: string;
	audio_bytes?: number;
	voice_id?: string;
	chunks?: number;
	error?: string;
}

export async function generateModuleAudio(env: ModuleAudioEnv, module_id: number): Promise<ModuleAudioResult> {
	// §archive — refuse to spend TTS budget on archived modules
	const statusRow = await env.UC3_DB
		.prepare("SELECT status FROM learning_modules WHERE id = ?")
		.bind(module_id)
		.first<{ status: string }>();
	if (statusRow?.status === "archived") {
		return { ok: false, module_id, error: "module is archived; un-archive first to regenerate audio" };
	}
	// D1 (audio failure surface): stamp attempt counter + timestamp at start so
	// the UI can show "attempted N times" mid-cook, not just on terminal failure.
	const nowS = Math.floor(Date.now() / 1000);
	await env.UC3_DB
		.prepare("UPDATE learning_modules SET audio_attempts_count = audio_attempts_count + 1, audio_last_attempt_at = ? WHERE id = ?")
		.bind(nowS, module_id)
		.run()
		.catch(() => {});

	const transcript = await getTranscript(env.TTS_CACHE, module_id);
	if (!transcript) {
		const errText = "no polished transcript in R2";
		await logVerification(env.UC3_DB, { module_id, stage: "S11-tts", ok: false, error_text: errText });
		await env.UC3_DB.prepare("UPDATE learning_modules SET audio_last_error = ? WHERE id = ?").bind(errText, module_id).run().catch(() => {});
		return { ok: false, module_id, error: errText };
	}

	// §8.4a.23 — voice resolution cascade:
	//   1. env.ELEVENLABS_DEFAULT_VOICE_ID (emergency global override)
	//   2. module's persisted voice_id (set by pipeline S1 via rotation)
	//   3. brief's voice_id (legacy modules pre §8.4a.23)
	//   4. rotation pick by position_in_series
	//   5. hardcoded Antoni fallback
	const modVoiceRow = await env.UC3_DB
		.prepare("SELECT voice_id, position_in_series FROM learning_modules WHERE id = ?")
		.bind(module_id)
		.first<{ voice_id: string | null; position_in_series: number | null }>();
	const brief = await getBriefByModule(env.UC3_DB, module_id);
	const voice_id = resolveVoiceId({
		explicit: env.ELEVENLABS_DEFAULT_VOICE_ID || null,
		persisted: modVoiceRow?.voice_id ?? brief?.voice_id,
		position: modVoiceRow?.position_in_series ?? null,
		envDefault: DEFAULT_VOICE_ID_FALLBACK,
	});

	const r = await ttsChunkedToBuffer(transcript, voice_id, ELEVENLABS_DEFAULT_MODEL, undefined, env.ELEVENLABS_API_KEY);
	if (!r.ok) {
		const errText = `TTS failed: ${r.error}`;
		await logVerification(env.UC3_DB, { module_id, stage: "S11-tts", ok: false, error_text: r.error });
		await env.UC3_DB.prepare("UPDATE learning_modules SET audio_last_error = ? WHERE id = ?").bind(errText, module_id).run().catch(() => {});
		return { ok: false, module_id, error: errText };
	}

	const key = await putModuleAudio(env.TTS_CACHE, module_id, r.buf);
	// Success: stamp audio_r2_key + clear any prior error.
	await env.UC3_DB
		.prepare("UPDATE learning_modules SET audio_r2_key = ?, audio_last_error = NULL WHERE id = ?")
		.bind(key, module_id)
		.run();

	await logVerification(env.UC3_DB, {
		module_id,
		stage: "S11-tts",
		response_json: JSON.stringify({ audio_bytes: r.buf.byteLength, voice_id, chunks: r.chunkCount, char_count: transcript.length }),
		ok: true,
	});

	return { ok: true, module_id, audio_r2_key: key, audio_bytes: r.buf.byteLength, voice_id, chunks: r.chunkCount };
}
