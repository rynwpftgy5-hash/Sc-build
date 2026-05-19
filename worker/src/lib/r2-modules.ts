// §8.4a.21 W8 — R2 helpers for full-module MP3 storage.
// Reuses the existing TTS_CACHE bucket with a `modules/` key prefix.
// Mirrors r2-briefs.ts so layout stays consistent.

const PREFIX = "modules/";

function moduleAudioKey(moduleId: number): string {
	return `${PREFIX}module-${moduleId}.mp3`;
}

export async function putModuleAudio(bucket: R2Bucket, moduleId: number, audio: ArrayBuffer): Promise<string> {
	const key = moduleAudioKey(moduleId);
	await bucket.put(key, audio, { httpMetadata: { contentType: "audio/mpeg" } });
	return key;
}

export async function getModuleAudio(bucket: R2Bucket, moduleId: number): Promise<R2ObjectBody | null> {
	const r = await bucket.get(moduleAudioKey(moduleId));
	return r ?? null;
}
