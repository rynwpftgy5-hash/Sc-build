// §8.4a.21 W6 — R2 wrappers for module review briefs.
// Reuses the existing TTS_CACHE bucket with a `review-briefs/` key prefix.
// Mirrors the r2-transcripts.ts shape.

const PREFIX = "review-briefs/";

export function briefScriptKey(moduleId: number): string {
	return `${PREFIX}module-${moduleId}-script.txt`;
}

export function briefAudioKey(moduleId: number): string {
	return `${PREFIX}module-${moduleId}.mp3`;
}

export async function putBriefScript(bucket: R2Bucket, moduleId: number, text: string): Promise<string> {
	const key = briefScriptKey(moduleId);
	await bucket.put(key, text, {
		httpMetadata: { contentType: "text/plain; charset=utf-8" },
	});
	return key;
}

export async function getBriefScript(bucket: R2Bucket, moduleId: number): Promise<string | null> {
	const obj = await bucket.get(briefScriptKey(moduleId));
	if (!obj) return null;
	return await obj.text();
}

export async function putBriefAudio(bucket: R2Bucket, moduleId: number, audio: ArrayBuffer): Promise<string> {
	const key = briefAudioKey(moduleId);
	await bucket.put(key, audio, {
		httpMetadata: { contentType: "audio/mpeg" },
	});
	return key;
}

export async function getBriefAudio(bucket: R2Bucket, moduleId: number): Promise<R2ObjectBody | null> {
	return await bucket.get(briefAudioKey(moduleId));
}
