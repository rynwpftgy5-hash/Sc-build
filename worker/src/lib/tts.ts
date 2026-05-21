// §8.4a.21 W6 — TTS helper extracted from src/index.ts so the W6 review-brief
// generator + future workflow consumers can share it without re-implementing.
// Logic byte-for-byte identical to the original.

export const ELEVENLABS_TTS_URL_BASE = "https://api.elevenlabs.io/v1/text-to-speech/";
export const ELEVENLABS_DEFAULT_MODEL = "eleven_multilingual_v2";
// 2500 chars per chunk (~400 words, ~2.5 min audio) keeps individual TTS calls
// under the 90s abort. The original Commute Player used 4500 but observed 30s
// timeouts on ~4359-char W6 brief scripts; smaller chunks are safer + the
// concat step glues them seamlessly anyway.
export const ELEVENLABS_CHUNK_SIZE = 2500;
const ELEVENLABS_TTS_TIMEOUT_MS = 90_000;

export function buildElevenLabsBody(text: string, voiceId: string, modelId: string, speed?: number) {
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

export async function callElevenLabs(
	text: string,
	voiceId: string,
	modelId: string,
	speed: number | undefined,
	apiKey: string,
): Promise<{ ok: true; buf: ArrayBuffer } | { ok: false; status: number; error: string }> {
	const url = ELEVENLABS_TTS_URL_BASE + encodeURIComponent(voiceId);
	let resp: Response;
	try {
		resp = await fetch(url, {
			method: "POST",
			headers: {
				"xi-api-key": apiKey,
				"Content-Type": "application/json",
				Accept: "audio/mpeg",
			},
			body: JSON.stringify(buildElevenLabsBody(text, voiceId, modelId, speed)),
			signal: AbortSignal.timeout(ELEVENLABS_TTS_TIMEOUT_MS),
		});
	} catch (e) {
		return { ok: false, status: 502, error: `Failed to reach ElevenLabs: ${(e as Error).message}` };
	}
	if (!resp.ok) {
		let detail = "";
		try {
			detail = (await resp.text()).slice(0, 500);
		} catch (_) {}
		return { ok: false, status: resp.status, error: `ElevenLabs ${resp.status}: ${detail}` };
	}
	const buf = await resp.arrayBuffer();
	return { ok: true, buf };
}

// Splits text at sentence boundaries for chunked TTS. Mirrors handleTTSChunked
// in src/index.ts. Caller is responsible for concatenating the per-chunk
// ArrayBuffers in order.
export function chunkTextForTTS(text: string): string[] {
	const chunks: string[] = [];
	let remaining = text;
	while (remaining.length > 0) {
		if (remaining.length <= ELEVENLABS_CHUNK_SIZE) {
			chunks.push(remaining);
			break;
		}
		const region = remaining.slice(0, ELEVENLABS_CHUNK_SIZE);
		const lastBoundary = Math.max(
			region.lastIndexOf(". "),
			region.lastIndexOf(".\n"),
			region.lastIndexOf("! "),
			region.lastIndexOf("? "),
		);
		const cutoff = lastBoundary > ELEVENLABS_CHUNK_SIZE * 0.5 ? lastBoundary + 2 : ELEVENLABS_CHUNK_SIZE;
		chunks.push(remaining.slice(0, cutoff));
		remaining = remaining.slice(cutoff);
	}
	return chunks;
}

export async function ttsChunkedToBuffer(
	text: string,
	voiceId: string,
	modelId: string,
	speed: number | undefined,
	apiKey: string,
): Promise<{ ok: true; buf: ArrayBuffer; chunkCount: number } | { ok: false; status: number; error: string }> {
	const chunks = chunkTextForTTS(text);
	const buffers: ArrayBuffer[] = [];
	for (let i = 0; i < chunks.length; i++) {
		const r = await callElevenLabs(chunks[i], voiceId, modelId || ELEVENLABS_DEFAULT_MODEL, speed, apiKey);
		if (!r.ok) return r;
		buffers.push(r.buf);
	}
	const totalLen = buffers.reduce((s, b) => s + b.byteLength, 0);
	const merged = new Uint8Array(totalLen);
	let offset = 0;
	for (const b of buffers) {
		merged.set(new Uint8Array(b), offset);
		offset += b.byteLength;
	}
	return { ok: true, buf: merged.buffer, chunkCount: chunks.length };
}
