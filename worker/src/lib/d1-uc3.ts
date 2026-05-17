// Typed D1 helpers for §8.4a.21 UC3 Fundamentals pipeline.
// Schema in migrations/0001_uc3_init.sql.

export type PipelineStage = "S0" | "S1" | "S2" | "S2.5" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "S9" | "S10" | "S11" | "S12";
export type PipelineStatus = "running" | "paused" | "completed" | "failed" | "cancelled";
export type ModuleStatus =
	| "captured"
	| "researching"
	| "drafted"
	| "review-brief-pending"
	| "review-brief-sent"
	| "revision-requested"
	| "approved"
	| "published";

export interface LearningModuleRow {
	id: number;
	gap_id: string;
	series_id: number | null;
	position_in_series: number | null;
	status: ModuleStatus;
	learning_objective: string;
	dependencies_json: string | null;
	outline_json: string | null;
	audio_r2_key: string | null;
	transcript_r2_key: string | null;
	created_at: number;
	approved_at: number | null;
}

export interface PipelineStateRow {
	id: number;
	gap_id: string;
	workflow_instance_id: string | null;
	stage: PipelineStage;
	status: PipelineStatus;
	retry_count: number;
	last_error: string | null;
	started_at: number;
	updated_at: number;
}

export interface CitationRow {
	id: number;
	module_id: number;
	claim_text: string | null;
	source_url: string;
	source_name: string | null;
	source_type: string | null;
	source_tier: string | null;
	scope_note_used: string | null;
	candidate: number;
	verified_pass1_at: number | null;
	verified_pass2_at: number | null;
}

export interface AnalogRankingRow {
	id: number;
	module_id: number;
	analog_author: string;
	analog_work: string;
	structural_fit: number;
	confidence: number;
	epistemic_strength: number;
	epistemic_strength_label: string;
	constitutive_role: number;
	constitutive_role_label: string;
	composite: number;
	advance_to_drafting: number;
	rationale: string | null;
	rubric_notes: string | null;
	ranked_at: number;
}

export interface VerificationTrailRow {
	id: number;
	module_id: number | null;
	stage: string;
	model: string | null;
	prompt_hash: string | null;
	request_json: string | null;
	response_json: string | null;
	ok: number;
	error_text: string | null;
	decided_at: number;
}

export async function upsertPipelineState(
	db: D1Database,
	row: { gap_id: string; workflow_instance_id?: string; stage: PipelineStage; status: PipelineStatus; last_error?: string },
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	await db
		.prepare(
			`INSERT INTO pipeline_state (gap_id, workflow_instance_id, stage, status, retry_count, last_error, started_at, updated_at)
			 VALUES (?, ?, ?, ?, 0, ?, ?, ?)
			 ON CONFLICT(gap_id) DO UPDATE SET
			   workflow_instance_id = COALESCE(excluded.workflow_instance_id, pipeline_state.workflow_instance_id),
			   stage = excluded.stage,
			   status = excluded.status,
			   last_error = excluded.last_error,
			   updated_at = excluded.updated_at`,
		)
		.bind(row.gap_id, row.workflow_instance_id ?? null, row.stage, row.status, row.last_error ?? null, now, now)
		.run();
}

export async function getPipelineState(db: D1Database, gap_id: string): Promise<PipelineStateRow | null> {
	const r = await db.prepare("SELECT * FROM pipeline_state WHERE gap_id = ?").bind(gap_id).first<PipelineStateRow>();
	return r ?? null;
}

export async function insertLearningModule(
	db: D1Database,
	row: {
		gap_id: string;
		position_in_series: number;
		learning_objective: string;
		dependencies_json: string;
	},
): Promise<number> {
	const now = Math.floor(Date.now() / 1000);
	const r = await db
		.prepare(
			`INSERT INTO learning_modules (gap_id, position_in_series, status, learning_objective, dependencies_json, created_at)
			 VALUES (?, ?, 'researching', ?, ?, ?)`,
		)
		.bind(row.gap_id, row.position_in_series, row.learning_objective, row.dependencies_json, now)
		.run();
	return Number((r.meta as { last_row_id?: number }).last_row_id);
}

export async function setModuleOutline(db: D1Database, module_id: number, outline_json: string): Promise<void> {
	await db.prepare("UPDATE learning_modules SET outline_json = ?, status = 'drafted' WHERE id = ?").bind(outline_json, module_id).run();
}

export async function listModulesByGap(db: D1Database, gap_id: string): Promise<LearningModuleRow[]> {
	const r = await db
		.prepare("SELECT * FROM learning_modules WHERE gap_id = ? ORDER BY position_in_series ASC")
		.bind(gap_id)
		.all<LearningModuleRow>();
	return r.results ?? [];
}

export async function insertCitation(
	db: D1Database,
	row: {
		module_id: number;
		source_url: string;
		source_name: string;
		source_type: string;
		source_tier: string;
		scope_note_used?: string | null;
	},
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO module_citations (module_id, source_url, source_name, source_type, source_tier, scope_note_used, candidate)
			 VALUES (?, ?, ?, ?, ?, ?, 1)`,
		)
		.bind(row.module_id, row.source_url, row.source_name, row.source_type, row.source_tier, row.scope_note_used ?? null)
		.run();
}

export async function listCitationsByModule(db: D1Database, module_id: number): Promise<CitationRow[]> {
	const r = await db.prepare("SELECT * FROM module_citations WHERE module_id = ? ORDER BY id ASC").bind(module_id).all<CitationRow>();
	return r.results ?? [];
}

export async function insertAnalogRanking(
	db: D1Database,
	row: Omit<AnalogRankingRow, "id" | "ranked_at">,
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	await db
		.prepare(
			`INSERT INTO analog_rankings (module_id, analog_author, analog_work, structural_fit, confidence, epistemic_strength, epistemic_strength_label, constitutive_role, constitutive_role_label, composite, advance_to_drafting, rationale, rubric_notes, ranked_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			row.module_id,
			row.analog_author,
			row.analog_work,
			row.structural_fit,
			row.confidence,
			row.epistemic_strength,
			row.epistemic_strength_label,
			row.constitutive_role,
			row.constitutive_role_label,
			row.composite,
			row.advance_to_drafting,
			row.rationale,
			row.rubric_notes,
			now,
		)
		.run();
}

export async function listAnalogsByModule(db: D1Database, module_id: number): Promise<AnalogRankingRow[]> {
	const r = await db
		.prepare("SELECT * FROM analog_rankings WHERE module_id = ? ORDER BY composite DESC")
		.bind(module_id)
		.all<AnalogRankingRow>();
	return r.results ?? [];
}

export async function logVerification(
	db: D1Database,
	row: {
		module_id: number | null;
		stage: string;
		model?: string | null;
		prompt_hash?: string | null;
		request_json?: string | null;
		response_json?: string | null;
		ok: boolean;
		error_text?: string | null;
	},
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	await db
		.prepare(
			`INSERT INTO verification_trail (module_id, stage, model, prompt_hash, request_json, response_json, ok, error_text, decided_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			row.module_id,
			row.stage,
			row.model ?? null,
			row.prompt_hash ?? null,
			row.request_json ?? null,
			row.response_json ?? null,
			row.ok ? 1 : 0,
			row.error_text ?? null,
			now,
		)
		.run();
}

export async function listVerificationByGap(db: D1Database, gap_id: string): Promise<VerificationTrailRow[]> {
	const r = await db
		.prepare(
			`SELECT vt.* FROM verification_trail vt
			 LEFT JOIN learning_modules lm ON vt.module_id = lm.id
			 WHERE lm.gap_id = ? OR (vt.module_id IS NULL AND vt.response_json LIKE '%' || ? || '%')
			 ORDER BY vt.decided_at ASC`,
		)
		.bind(gap_id, gap_id)
		.all<VerificationTrailRow>();
	return r.results ?? [];
}
