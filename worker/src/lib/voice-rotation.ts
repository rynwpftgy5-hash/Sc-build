// §8.4a.23 — Voice rotation per-module.
//
// Each module in a 5-module series gets a distinct curated ElevenLabs voice
// from this rotation pool. The voice_id is assigned once (at S1 when the
// module is first inserted) and reused for both the review brief audio (S8)
// and the full-module audio (S11). Same voice across the brief + full module
// keeps the cognitive frame stable for Campbell when he listens to both.
//
// The pool is 5 voices to match the typical series length. Module position 1
// → ROTATION[0], position 2 → ROTATION[1], ..., position 6 → ROTATION[0] (wrap).

export interface VoiceProfile {
	voice_id: string;
	label: string;
	notes: string;
}

// Curated voices from the ElevenLabs default library — all available without
// voice cloning. Picked for tonal variety (mix of male/female + cadences) so a
// 5-module series feels like 5 distinct lessons, not one narrator droning.
export const VOICE_ROTATION: VoiceProfile[] = [
	{ voice_id: "ErXwobaYiN019PkySvjV", label: "Antoni", notes: "Male, deep, deliberate. Default since W6." },
	{ voice_id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel", notes: "Female, calm, narrative." },
	{ voice_id: "pNInz6obpgDQGcFmaJgB", label: "Adam", notes: "Male, narration-focused, warm." },
	{ voice_id: "EXAVITQu4vr4xnSDxMaL", label: "Bella", notes: "Female, soft, conversational." },
	{ voice_id: "yoZ06aMxZJJ28mfd3POQ", label: "Sam", notes: "Male, mid-range, approachable." },
];

/**
 * Pick a voice for a module by its position in the series.
 * Stable: position N always maps to the same voice across calls.
 * Wraps around if position > pool size.
 */
export function pickVoiceForPosition(position: number | null | undefined): VoiceProfile {
	const p = position && position > 0 ? position : 1;
	const idx = (p - 1) % VOICE_ROTATION.length;
	return VOICE_ROTATION[idx];
}

/**
 * Pick a voice for a daily briefing keyed on the briefing_date string
 * (YYYY-MM-DD). Deterministic so a regenerated briefing for the same date
 * keeps its voice; uniformly distributed across the pool over consecutive
 * dates so no single voice dominates (addresses F14 / feedback #27 —
 * Antoni-only daily briefings).
 *
 * Distribution: every block of VOICE_ROTATION.length dates hits each voice
 * exactly once, well under the (1/pool_size + 0.15) ≈ 0.35 ceiling the
 * ADR-024 rotation-bias check enforces.
 */
export function pickVoiceForDailyBriefing(briefing_date: string): VoiceProfile {
	// Days since epoch from the YYYY-MM-DD string. Date.parse on a bare
	// date is UTC-anchored in all V8/Workers runtimes, so this is stable
	// across the cron's timezone.
	const ms = Date.parse(briefing_date);
	const days = Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : 0;
	const idx = ((days % VOICE_ROTATION.length) + VOICE_ROTATION.length) % VOICE_ROTATION.length;
	return VOICE_ROTATION[idx];
}

/**
 * Resolve voice_id with cascading fallback:
 *   1. explicit override (e.g. from change_voice action)
 *   2. module's persisted voice_id
 *   3. rotated voice by position
 *   4. env default
 *   5. hardcoded Antoni fallback
 */
export function resolveVoiceId(args: {
	explicit?: string | null;
	persisted?: string | null;
	position?: number | null;
	envDefault?: string;
}): string {
	if (args.explicit && args.explicit.trim()) return args.explicit.trim();
	if (args.persisted && args.persisted.trim()) return args.persisted.trim();
	if (args.position != null) return pickVoiceForPosition(args.position).voice_id;
	if (args.envDefault) return args.envDefault;
	return VOICE_ROTATION[0].voice_id;
}
