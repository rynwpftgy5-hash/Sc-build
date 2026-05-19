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
	voice_id: string | null;  // §8.4a.23 — added in migration 0006
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
	row: { gap_id: string; workflow_instance_id?: string; stage: PipelineStage; status: PipelineStatus; last_error?: string; gap_title?: string },
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	await db
		.prepare(
			`INSERT INTO pipeline_state (gap_id, workflow_instance_id, stage, status, retry_count, last_error, started_at, updated_at, gap_title)
			 VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
			 ON CONFLICT(gap_id) DO UPDATE SET
			   workflow_instance_id = COALESCE(excluded.workflow_instance_id, pipeline_state.workflow_instance_id),
			   stage = excluded.stage,
			   status = excluded.status,
			   last_error = excluded.last_error,
			   updated_at = excluded.updated_at,
			   gap_title = COALESCE(excluded.gap_title, pipeline_state.gap_title)`,
		)
		.bind(row.gap_id, row.workflow_instance_id ?? null, row.stage, row.status, row.last_error ?? null, now, now, row.gap_title ?? null)
		.run();
}

export async function setGapTitle(db: D1Database, gap_id: string, gap_title: string): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	await db
		.prepare(
			`INSERT INTO pipeline_state (gap_id, stage, status, retry_count, started_at, updated_at, gap_title)
			 VALUES (?, 'S0', 'running', 0, ?, ?, ?)
			 ON CONFLICT(gap_id) DO UPDATE SET gap_title = excluded.gap_title, updated_at = excluded.updated_at`,
		)
		.bind(gap_id, now, now, gap_title)
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

// ── §8.4a.21 W5 — module_sections / section_claims / verification_passes ──

export type SectionType = "hook" | "core" | "sub_concept" | "integration" | "self_check";
export type SectionStatus = "queued" | "drafted" | "rewrite_pending" | "verified" | "failed";

export interface ModuleSectionRow {
	id: number;
	module_id: number;
	position: number;
	section_type: SectionType;
	draft_text: string | null;
	citations_json: string | null;
	status: SectionStatus;
	draft_iteration: number;
	drafted_at: number | null;
	polished_at: number | null;
}

export interface SectionClaimRow {
	id: number;
	section_id: number;
	module_id: number;
	claim_text: string;
	cited_source_url: string | null;
	cited_source_name: string | null;
	verified_pass1: number | null;
	verified_pass1_at: number | null;
	verification_notes: string | null;
	rewrite_count: number;
	needs_human_review: number;
}

export interface VerificationPassRow {
	id: number;
	module_id: number;
	pass_number: number;
	pass_type: string;
	model: string;
	verdict: string;
	rationale: string | null;
	decided_at: number;
}

export async function insertSection(
	db: D1Database,
	row: { module_id: number; position: number; section_type: SectionType; status: SectionStatus },
): Promise<number> {
	const r = await db
		.prepare(
			`INSERT INTO module_sections (module_id, position, section_type, status, draft_iteration)
			 VALUES (?, ?, ?, ?, 1)`,
		)
		.bind(row.module_id, row.position, row.section_type, row.status)
		.run();
	return Number((r.meta as { last_row_id?: number }).last_row_id);
}

export async function setSectionDraft(
	db: D1Database,
	section_id: number,
	draft_text: string,
	citations_json: string,
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	await db
		.prepare(
			`UPDATE module_sections
			   SET draft_text = ?, citations_json = ?, status = 'drafted', drafted_at = ?
			 WHERE id = ?`,
		)
		.bind(draft_text, citations_json, now, section_id)
		.run();
}

export async function rewriteSectionDraft(
	db: D1Database,
	section_id: number,
	draft_text: string,
	citations_json: string,
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	await db
		.prepare(
			`UPDATE module_sections
			   SET draft_text = ?, citations_json = ?, status = 'drafted',
			       draft_iteration = draft_iteration + 1, drafted_at = ?
			 WHERE id = ?`,
		)
		.bind(draft_text, citations_json, now, section_id)
		.run();
}

export async function listSectionsByModule(db: D1Database, module_id: number): Promise<ModuleSectionRow[]> {
	const r = await db
		.prepare("SELECT * FROM module_sections WHERE module_id = ? ORDER BY position ASC")
		.bind(module_id)
		.all<ModuleSectionRow>();
	return r.results ?? [];
}

export async function getSection(db: D1Database, section_id: number): Promise<ModuleSectionRow | null> {
	const r = await db.prepare("SELECT * FROM module_sections WHERE id = ?").bind(section_id).first<ModuleSectionRow>();
	return r ?? null;
}

export async function countSectionsByStatusForGap(
	db: D1Database,
	gap_id: string,
): Promise<{ total: number; drafted: number }> {
	// "drafted" here means terminal state — either successfully drafted or
	// permanently failed. Failed sections proceed without their text; S5b
	// polish + S6 verification handle missing draft_text gracefully.
	const r = await db
		.prepare(
			`SELECT
			   COUNT(*) AS total,
			   SUM(CASE WHEN ms.status IN ('drafted', 'verified', 'failed') THEN 1 ELSE 0 END) AS drafted
			 FROM module_sections ms
			 JOIN learning_modules lm ON ms.module_id = lm.id
			 WHERE lm.gap_id = ?`,
		)
		.bind(gap_id)
		.first<{ total: number; drafted: number }>();
	return { total: r?.total ?? 0, drafted: r?.drafted ?? 0 };
}

export async function markSectionFailed(db: D1Database, section_id: number): Promise<void> {
	await db.prepare("UPDATE module_sections SET status = 'failed' WHERE id = ?").bind(section_id).run();
}

export async function setModuleTranscriptR2(
	db: D1Database,
	module_id: number,
	transcript_r2_key: string,
): Promise<void> {
	await db
		.prepare("UPDATE learning_modules SET transcript_r2_key = ?, status = 'drafted' WHERE id = ?")
		.bind(transcript_r2_key, module_id)
		.run();
}

export async function setModuleStatus(db: D1Database, module_id: number, status: ModuleStatus): Promise<void> {
	await db.prepare("UPDATE learning_modules SET status = ? WHERE id = ?").bind(status, module_id).run();
}

// §8.4a.23 — voice rotation per-module.
export async function setModuleVoiceId(db: D1Database, module_id: number, voice_id: string): Promise<void> {
	await db.prepare("UPDATE learning_modules SET voice_id = ? WHERE id = ?").bind(voice_id, module_id).run();
}

export async function getModuleVoiceId(db: D1Database, module_id: number): Promise<string | null> {
	const r = await db.prepare("SELECT voice_id FROM learning_modules WHERE id = ?").bind(module_id).first<{ voice_id: string | null }>();
	return r?.voice_id ?? null;
}

export async function insertClaim(
	db: D1Database,
	row: {
		section_id: number;
		module_id: number;
		claim_text: string;
		cited_source_url?: string | null;
		cited_source_name?: string | null;
	},
): Promise<number> {
	const r = await db
		.prepare(
			`INSERT INTO section_claims (section_id, module_id, claim_text, cited_source_url, cited_source_name)
			 VALUES (?, ?, ?, ?, ?)`,
		)
		.bind(row.section_id, row.module_id, row.claim_text, row.cited_source_url ?? null, row.cited_source_name ?? null)
		.run();
	return Number((r.meta as { last_row_id?: number }).last_row_id);
}

export async function setClaimVerification(
	db: D1Database,
	claim_id: number,
	verified: boolean,
	notes: string | null,
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	await db
		.prepare(
			`UPDATE section_claims
			   SET verified_pass1 = ?, verified_pass1_at = ?, verification_notes = ?
			 WHERE id = ?`,
		)
		.bind(verified ? 1 : 0, now, notes, claim_id)
		.run();
}

export async function bumpClaimRewriteCount(db: D1Database, claim_id: number): Promise<number> {
	await db.prepare("UPDATE section_claims SET rewrite_count = rewrite_count + 1 WHERE id = ?").bind(claim_id).run();
	const r = await db.prepare("SELECT rewrite_count FROM section_claims WHERE id = ?").bind(claim_id).first<{ rewrite_count: number }>();
	return r?.rewrite_count ?? 0;
}

export async function flagClaimForHumanReview(db: D1Database, claim_id: number): Promise<void> {
	await db.prepare("UPDATE section_claims SET needs_human_review = 1 WHERE id = ?").bind(claim_id).run();
}

export async function listClaimsByModule(db: D1Database, module_id: number): Promise<SectionClaimRow[]> {
	const r = await db
		.prepare("SELECT * FROM section_claims WHERE module_id = ? ORDER BY section_id, id")
		.bind(module_id)
		.all<SectionClaimRow>();
	return r.results ?? [];
}

export async function moduleHasHumanReviewClaims(db: D1Database, module_id: number): Promise<boolean> {
	const r = await db
		.prepare("SELECT COUNT(*) AS n FROM section_claims WHERE module_id = ? AND needs_human_review = 1")
		.bind(module_id)
		.first<{ n: number }>();
	return (r?.n ?? 0) > 0;
}

export async function insertVerificationPass(
	db: D1Database,
	row: { module_id: number; pass_number: number; pass_type: string; model: string; verdict: string; rationale?: string | null },
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	await db
		.prepare(
			`INSERT INTO verification_passes (module_id, pass_number, pass_type, model, verdict, rationale, decided_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(row.module_id, row.pass_number, row.pass_type, row.model, row.verdict, row.rationale ?? null, now)
		.run();
}

export async function listVerificationPassesByModule(db: D1Database, module_id: number): Promise<VerificationPassRow[]> {
	const r = await db
		.prepare("SELECT * FROM verification_passes WHERE module_id = ? ORDER BY decided_at ASC")
		.bind(module_id)
		.all<VerificationPassRow>();
	return r.results ?? [];
}

// ── §8.4a.21 W6 — review_briefs ───────────────────────────────────────────

export interface ReviewBriefRow {
	id: number;
	module_id: number;
	script_r2_key: string | null;
	audio_r2_key: string | null;
	voice_id: string | null;
	model: string | null;
	char_count: number | null;
	audio_bytes: number | null;
	status: string;
	generated_at: number | null;
	audio_generated_at: number | null;
	last_error: string | null;
}

export async function upsertBrief(
	db: D1Database,
	row: { module_id: number; voice_id: string; model: string; status: string },
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	await db
		.prepare(
			`INSERT INTO review_briefs (module_id, voice_id, model, status, generated_at)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(module_id) DO UPDATE SET
			   voice_id = excluded.voice_id,
			   model = excluded.model,
			   status = excluded.status,
			   generated_at = excluded.generated_at,
			   last_error = NULL`,
		)
		.bind(row.module_id, row.voice_id, row.model, row.status, now)
		.run();
}

export async function updateBriefScript(
	db: D1Database,
	module_id: number,
	script_r2_key: string,
	char_count: number,
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	await db
		.prepare(
			`UPDATE review_briefs
			   SET script_r2_key = ?, char_count = ?, status = 'script-generated', generated_at = ?
			 WHERE module_id = ?`,
		)
		.bind(script_r2_key, char_count, now, module_id)
		.run();
}

export async function updateBriefAudio(
	db: D1Database,
	module_id: number,
	audio_r2_key: string,
	audio_bytes: number,
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	await db
		.prepare(
			`UPDATE review_briefs
			   SET audio_r2_key = ?, audio_bytes = ?, status = 'audio-generated', audio_generated_at = ?
			 WHERE module_id = ?`,
		)
		.bind(audio_r2_key, audio_bytes, now, module_id)
		.run();
}

export async function markBriefFailed(db: D1Database, module_id: number, error: string): Promise<void> {
	await db
		.prepare("UPDATE review_briefs SET status = 'failed', last_error = ? WHERE module_id = ?")
		.bind(error.slice(0, 1000), module_id)
		.run();
}

export async function getBriefByModule(db: D1Database, module_id: number): Promise<ReviewBriefRow | null> {
	const r = await db
		.prepare("SELECT * FROM review_briefs WHERE module_id = ?")
		.bind(module_id)
		.first<ReviewBriefRow>();
	return r ?? null;
}

export async function listBriefsByGap(db: D1Database, gap_id: string): Promise<ReviewBriefRow[]> {
	const r = await db
		.prepare(
			`SELECT rb.* FROM review_briefs rb
			 JOIN learning_modules lm ON rb.module_id = lm.id
			 WHERE lm.gap_id = ?
			 ORDER BY lm.position_in_series ASC`,
		)
		.bind(gap_id)
		.all<ReviewBriefRow>();
	return r.results ?? [];
}

export async function updateBriefVoice(
	db: D1Database,
	module_id: number,
	voice_id: string,
): Promise<void> {
	await db
		.prepare("UPDATE review_briefs SET voice_id = ? WHERE module_id = ?")
		.bind(voice_id, module_id)
		.run();
}

// ── §8.4a.21 W7 — module_feedback (S9 parse + S10 dispatch) ───────────────

export interface ModuleFeedbackRow {
	id: number;
	module_id: number;
	voice_transcript: string;
	parsed_actions_json: string | null;
	parser_model: string | null;
	parser_prompt_hash: string | null;
	parser_confidence: string | null;
	parser_summary: string | null;
	dispatch_status: string;
	dispatch_results_json: string | null;
	created_at: number;
	dispatched_at: number | null;
	last_error: string | null;
}

export async function insertFeedback(
	db: D1Database,
	row: { module_id: number; voice_transcript: string },
): Promise<number> {
	const now = Math.floor(Date.now() / 1000);
	const r = await db
		.prepare(
			`INSERT INTO module_feedback (module_id, voice_transcript, dispatch_status, created_at)
			 VALUES (?, ?, 'pending', ?)`,
		)
		.bind(row.module_id, row.voice_transcript, now)
		.run();
	return Number((r.meta as { last_row_id?: number }).last_row_id);
}

export async function updateFeedbackParsed(
	db: D1Database,
	feedback_id: number,
	patch: {
		parsed_actions_json: string;
		parser_model: string;
		parser_prompt_hash: string;
		parser_confidence: string;
		parser_summary: string;
	},
): Promise<void> {
	await db
		.prepare(
			`UPDATE module_feedback
			   SET parsed_actions_json = ?, parser_model = ?, parser_prompt_hash = ?,
			       parser_confidence = ?, parser_summary = ?
			 WHERE id = ?`,
		)
		.bind(
			patch.parsed_actions_json,
			patch.parser_model,
			patch.parser_prompt_hash,
			patch.parser_confidence,
			patch.parser_summary,
			feedback_id,
		)
		.run();
}

export async function updateFeedbackDispatch(
	db: D1Database,
	feedback_id: number,
	patch: { dispatch_status: string; dispatch_results_json: string; last_error?: string | null },
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	await db
		.prepare(
			`UPDATE module_feedback
			   SET dispatch_status = ?, dispatch_results_json = ?, dispatched_at = ?, last_error = ?
			 WHERE id = ?`,
		)
		.bind(patch.dispatch_status, patch.dispatch_results_json, now, patch.last_error ?? null, feedback_id)
		.run();
}

export async function markFeedbackFailed(
	db: D1Database,
	feedback_id: number,
	error: string,
): Promise<void> {
	await db
		.prepare("UPDATE module_feedback SET dispatch_status = 'failed', last_error = ? WHERE id = ?")
		.bind(error.slice(0, 1000), feedback_id)
		.run();
}

export async function getFeedbackById(
	db: D1Database,
	feedback_id: number,
): Promise<ModuleFeedbackRow | null> {
	const r = await db
		.prepare("SELECT * FROM module_feedback WHERE id = ?")
		.bind(feedback_id)
		.first<ModuleFeedbackRow>();
	return r ?? null;
}

export async function listFeedbackByModule(
	db: D1Database,
	module_id: number,
): Promise<ModuleFeedbackRow[]> {
	const r = await db
		.prepare("SELECT * FROM module_feedback WHERE module_id = ? ORDER BY created_at DESC")
		.bind(module_id)
		.all<ModuleFeedbackRow>();
	return r.results ?? [];
}
