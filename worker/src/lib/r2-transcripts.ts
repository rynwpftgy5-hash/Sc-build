// §8.4a.21 W5 — R2 wrappers for polished module transcripts.
// Reuses the existing TTS_CACHE bucket with a `transcripts/` key prefix to
// avoid creating a second bucket for ~50 KB-per-module files.

const PREFIX = "transcripts/";

export function transcriptKey(moduleId: number): string {
	return `${PREFIX}module-${moduleId}.txt`;
}

export async function putTranscript(bucket: R2Bucket, moduleId: number, text: string): Promise<string> {
	const key = transcriptKey(moduleId);
	await bucket.put(key, text, {
		httpMetadata: { contentType: "text/plain; charset=utf-8" },
	});
	return key;
}

export async function getTranscript(bucket: R2Bucket, moduleId: number): Promise<string | null> {
	const obj = await bucket.get(transcriptKey(moduleId));
	if (!obj) return null;
	return await obj.text();
}
