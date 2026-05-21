// §8.4a.21 W8.1 — Module TTS Queue consumer.
//
// Each message processes ONE module's full-module TTS in a FRESH Worker
// invocation. This is the canonical CF pattern for multi-minute network-bound
// work — ctx.waitUntil from the original request handler doesn't reliably
// keep the isolate alive long enough (W8 dry-run #1 surfaced this).
//
// max_batch_size=1 in wrangler.jsonc so each module gets its own dedicated
// invocation with full subrequest + wall-time budget.

import { generateModuleAudio, type ModuleAudioEnv } from "../lib/module-audio";
import { logVerification } from "../lib/d1-uc3";
import type { ModuleTtsMessage } from "../lib/queues";

export interface ModuleTtsConsumerEnv extends ModuleAudioEnv {
	// inherits UC3_DB, TTS_CACHE, ELEVENLABS_API_KEY, ELEVENLABS_DEFAULT_VOICE_ID
}

export async function handleModuleTtsQueue(
	batch: MessageBatch<ModuleTtsMessage>,
	env: ModuleTtsConsumerEnv,
): Promise<void> {
	for (const msg of batch.messages) {
		const { module_id, source } = msg.body;
		try {
			const result = await generateModuleAudio(env, module_id);
			if (!result.ok) {
				// generateModuleAudio already logged S11-tts failure to verification_trail.
				console.error(`module-tts queue: generateModuleAudio failed for module ${module_id} (source=${source}):`, result.error);
				msg.retry();
				continue;
			}
			console.log(`module-tts queue: module ${module_id} OK — ${result.audio_bytes} bytes, ${result.chunks} chunks, voice ${result.voice_id} (source=${source})`);
			msg.ack();
		} catch (err) {
			const errMsg = (err as Error).message;
			console.error(`module-tts queue: unexpected error on module ${module_id}:`, errMsg);
			await logVerification(env.UC3_DB, {
				module_id,
				stage: "S11-tts-queue",
				ok: false,
				error_text: `consumer threw: ${errMsg}`,
			}).catch(() => {});
			msg.retry();
		}
	}
}
