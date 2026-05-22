// §8.4a.21 W8 — Spaced-repetition schedule for approved modules.
//
// Fires on `setModuleStatus(..., 'approved')`. Inserts 3 schedule rows per
// module at now+3d, now+1w, now+3w. /api/uc3/spaced-rep-due returns
// not-yet-fired rows where due_at <= now. mark-listened flips fired=1 on
// the soonest unfired row for a module.

const DAY_S = 86_400;

const CADENCES: Array<{ label: string; offset_s: number }> = [
	{ label: "+3d", offset_s: 3 * DAY_S },
	{ label: "+1w", offset_s: 7 * DAY_S },
	{ label: "+3w", offset_s: 21 * DAY_S },
];

export async function scheduleApprovedModule(db: D1Database, module_id: number): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	// Skip if this module already has schedule rows (idempotent on re-approve).
	const existing = await db
		.prepare("SELECT COUNT(*) AS n FROM spaced_rep_schedule WHERE module_id = ?")
		.bind(module_id)
		.first<{ n: number }>();
	if ((existing?.n ?? 0) > 0) return;
	for (const c of CADENCES) {
		await db
			.prepare(
				`INSERT INTO spaced_rep_schedule (module_id, due_at, cadence, fired, created_at)
				 VALUES (?, ?, ?, 0, ?)`,
			)
			.bind(module_id, now + c.offset_s, c.label, now)
			.run();
	}
}

export interface SpacedRepDueRow {
	id: number;
	module_id: number;
	gap_id: string;
	position: number;
	learning_objective: string;
	audio_r2_key: string | null;
	due_at: number;
	cadence: string;
	created_at: number;
}

export async function listDueRows(db: D1Database, now: number = Math.floor(Date.now() / 1000)): Promise<SpacedRepDueRow[]> {
	const r = await db
		.prepare(
			`SELECT s.id, s.module_id, s.due_at, s.cadence, s.created_at,
			        lm.gap_id, lm.position_in_series AS position, lm.learning_objective, lm.audio_r2_key
			 FROM spaced_rep_schedule s
			 JOIN learning_modules lm ON s.module_id = lm.id
			 WHERE s.fired = 0 AND s.due_at <= ? AND lm.status != 'archived'
			 ORDER BY s.due_at ASC`,
		)
		.bind(now)
		.all<SpacedRepDueRow>();
	return r.results ?? [];
}

export async function markNextListened(db: D1Database, module_id: number): Promise<number | null> {
	const now = Math.floor(Date.now() / 1000);
	const next = await db
		.prepare(
			`SELECT id FROM spaced_rep_schedule
			 WHERE module_id = ? AND fired = 0
			 ORDER BY due_at ASC LIMIT 1`,
		)
		.bind(module_id)
		.first<{ id: number }>();
	if (!next?.id) return null;
	await db
		.prepare("UPDATE spaced_rep_schedule SET fired = 1, fired_at = ? WHERE id = ?")
		.bind(now, next.id)
		.run();
	return next.id;
}
