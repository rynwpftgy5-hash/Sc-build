// §8.4a.21 W4 — REST handlers for UC3 Fundamentals pipeline.
// - POST   /api/uc3/pipeline-run     {gap_id}             — manual trigger / re-run
// - DELETE /api/uc3/pipeline-cancel  ?gap_id=…            — terminate running instance
// - GET    /api/uc3/pipeline-status  ?gap_id=…[&trail=1]  — inspect pipeline + module state

import { getPipelineState, listModulesByGap, listCitationsByModule, listAnalogsByModule, listVerificationByGap } from "../lib/d1-uc3";

export interface Uc3HandlerEnv {
	UC3_DB: D1Database;
	UC3_PIPELINE: Workflow;
}

export async function handleUc3PipelineRun(
	body: { gap_id?: string },
	env: Uc3HandlerEnv,
): Promise<{ ok: boolean; status?: number; gap_id?: string; instance_id?: string; error?: string }> {
	if (!body?.gap_id || typeof body.gap_id !== "string") {
		return { ok: false, status: 400, error: "field 'gap_id' (string) required" };
	}
	try {
		const instance = await env.UC3_PIPELINE.create({ params: { gap_id: body.gap_id } });
		return { ok: true, status: 200, gap_id: body.gap_id, instance_id: instance.id };
	} catch (err) {
		return { ok: false, status: 502, error: `Workflow.create failed: ${(err as Error).message}` };
	}
}

export async function handleUc3PipelineCancel(
	url: URL,
	env: Uc3HandlerEnv,
): Promise<{ ok: boolean; status?: number; gap_id?: string; instance_id?: string; cancelled?: boolean; error?: string }> {
	const gap_id = url.searchParams.get("gap_id");
	if (!gap_id) return { ok: false, status: 400, error: "query param 'gap_id' required" };
	const state = await getPipelineState(env.UC3_DB, gap_id);
	if (!state) return { ok: false, status: 404, error: `no pipeline_state row for gap_id ${gap_id}` };
	if (!state.workflow_instance_id) {
		return { ok: false, status: 409, error: "pipeline_state has no workflow_instance_id (not yet started?)" };
	}
	try {
		const instance = await env.UC3_PIPELINE.get(state.workflow_instance_id);
		await instance.terminate();
		await env.UC3_DB
			.prepare("UPDATE pipeline_state SET status = 'cancelled', updated_at = ? WHERE gap_id = ?")
			.bind(Math.floor(Date.now() / 1000), gap_id)
			.run();
		return { ok: true, status: 200, gap_id, instance_id: state.workflow_instance_id, cancelled: true };
	} catch (err) {
		return { ok: false, status: 502, error: `terminate failed: ${(err as Error).message}` };
	}
}

export async function handleUc3PipelineStatus(
	url: URL,
	env: Uc3HandlerEnv,
): Promise<Record<string, unknown>> {
	const gap_id = url.searchParams.get("gap_id");
	if (!gap_id) return { ok: false, status: 400, error: "query param 'gap_id' required" };
	const includeTrail = url.searchParams.get("trail") === "1";
	const state = await getPipelineState(env.UC3_DB, gap_id);
	if (!state) return { ok: false, status: 404, error: `no pipeline_state row for gap_id ${gap_id}` };

	const modules = await listModulesByGap(env.UC3_DB, gap_id);
	const modulesEnriched = await Promise.all(
		modules.map(async (m) => {
			const citations = await listCitationsByModule(env.UC3_DB, m.id);
			const analogs = await listAnalogsByModule(env.UC3_DB, m.id);
			let outline: unknown = null;
			if (m.outline_json) {
				try {
					outline = JSON.parse(m.outline_json);
				} catch {
					outline = m.outline_json;
				}
			}
			return {
				id: m.id,
				position: m.position_in_series,
				status: m.status,
				learning_objective: m.learning_objective,
				dependencies: m.dependencies_json ? JSON.parse(m.dependencies_json) : [],
				outline,
				citations: citations.map((c) => ({
					url: c.source_url,
					name: c.source_name,
					source_type: c.source_type,
					source_tier: c.source_tier,
					scope_note_used: c.scope_note_used,
					candidate: c.candidate === 1,
				})),
				analogs: analogs.map((a) => ({
					analog_author: a.analog_author,
					analog_work: a.analog_work,
					composite: a.composite,
					structural_fit: a.structural_fit,
					confidence: a.confidence,
					epistemic_strength: a.epistemic_strength,
					epistemic_strength_label: a.epistemic_strength_label,
					constitutive_role: a.constitutive_role,
					constitutive_role_label: a.constitutive_role_label,
					advance_to_drafting: a.advance_to_drafting === 1,
					rationale: a.rationale,
				})),
			};
		}),
	);

	const result: Record<string, unknown> = {
		ok: true,
		status: 200,
		gap_id,
		pipeline: {
			stage: state.stage,
			status: state.status,
			workflow_instance_id: state.workflow_instance_id,
			retry_count: state.retry_count,
			last_error: state.last_error,
			started_at: state.started_at,
			updated_at: state.updated_at,
		},
		modules: modulesEnriched,
	};

	if (includeTrail) {
		const trail = await listVerificationByGap(env.UC3_DB, gap_id);
		result.verification_trail = trail.map((t) => ({
			id: t.id,
			module_id: t.module_id,
			stage: t.stage,
			model: t.model,
			prompt_hash: t.prompt_hash,
			ok: t.ok === 1,
			error_text: t.error_text,
			decided_at: t.decided_at,
			response_summary: t.response_json ? (t.response_json.length > 600 ? t.response_json.slice(0, 600) + "…[truncated]" : t.response_json) : null,
		}));
	}

	return result;
}
