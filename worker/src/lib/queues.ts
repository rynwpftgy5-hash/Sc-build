// §8.4a.21 W5 — S5 section drafting queue message types

export interface S5DraftMessage {
	module_id: number;
	section_id: number;
	gap_id: string;
}

// §8.4a.21 W8.1 — Module TTS queue message type.
// One message per approved module; consumer fires generateModuleAudio() in a
// fresh Worker invocation (own subrequest budget, own wall-time budget).
// Replaces the W8 ctx.waitUntil(generateModuleAudio) approach that got killed
// mid-execution on multi-minute TTS work.
export interface ModuleTtsMessage {
	module_id: number;
	source: "approve" | "manual";
}
