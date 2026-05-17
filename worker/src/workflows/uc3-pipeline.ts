// §8.4a.21 W4 — UC3 Fundamentals pipeline (S0-S4).
// Cloudflare Workflow that orchestrates topic decomposition → source discovery →
// analog ranking → corpus retrieval → outline generation. Pauses at S4 for
// Pause-for-Campbell #4 (dry-run inspection).
//
// S5-S12 land in W5-W8 (separate workstreams per dispatch).

import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import {
	callAnthropic,
	extractJson,
	sha256Hex,
	type AnthropicModel,
} from "../lib/anthropic";
import { searchBrave, filterDenyList, type BraveResult } from "../lib/brave";
import {
	upsertPipelineState,
	insertLearningModule,
	insertCitation,
	insertAnalogRanking,
	setModuleOutline,
	logVerification,
	listCitationsByModule,
	listAnalogsByModule,
} from "../lib/d1-uc3";

// @ts-expect-error — Wrangler Text rule
import S1_PROMPT from "../../prompts/s1_topic_decomposition.txt";
// @ts-expect-error — Wrangler Text rule
import S2_PROMPT from "../../prompts/s2_source_discovery.txt";
// @ts-expect-error — Wrangler Text rule
import S4_PROMPT from "../../prompts/s4_outline_generation.txt";
// @ts-expect-error — Wrangler Text rule
import ANALOG_RANKING_PROMPT from "../../prompts/analog_ranking.txt";
import BEDROCK_SHELF_JSON from "../../prompts/bedrock_shelf.json";
import ANALOG_SEED_JSON from "../../prompts/analog_seed_bibliography.json";

const LEARNING_GAPS_QUEUE_DB_ID = "35ebac9a-7841-41bc-91fd-224b58feb9a3";
const READING_PARKING_LOT_DB_ID = "f3a2418b-6c9a-4ac3-92ad-3df613bf5772";

const MODEL_S1: AnthropicModel = "claude-sonnet-4-6";
const MODEL_S2: AnthropicModel = "claude-haiku-4-5-20251001";
const MODEL_S2_5: AnthropicModel = "claude-sonnet-4-6";
const MODEL_S4: AnthropicModel = "claude-sonnet-4-6";

export interface Uc3Env {
	UC3_DB: D1Database;
	ANTHROPIC_API_KEY: string;
	BRAVE_SEARCH_API_KEY: string;
	NOTION_TOKEN: string;
	WEBHOOK_SECRET: string;
	N8N_BASE_URL: string;
}

export interface Uc3PipelineParams {
	gap_id: string;
}

interface BedrockSource {
	name: string;
	full_name?: string;
	url: string;
	source_type: string;
	trust: string;
	url_patterns?: string[];
	scope?: string;
	notes?: string;
}

interface BedrockShelf {
	domains: Record<string, { description: string; sources: BedrockSource[] }>;
	deny_list: { patterns: string[] };
}

interface AnalogEntry {
	author: string;
	work: string;
	year: number;
	framework: string;
	framework_summary: string;
	epistemic_strength: string;
	epistemic_notes?: string;
	common_analog_targets?: string[];
}

interface AnalogSeed {
	entries: AnalogEntry[];
}

interface GapRow {
	gap_title: string;
	domain: string | null;
	voice_capture_text: string | null;
	requested_module_count: number | null;
	trigger_source_doc_id: string | null;
	trigger_surface: string | null;
	notion_url: string;
}

interface S1Module {
	position: number;
	objective: string;
	audio_rationale: string;
	depends_on: number[];
}

interface S1Output {
	module_count: number;
	system_override_reason: string | null;
	reasoning: string;
	modules: S1Module[];
}

interface S2Selected {
	url: string;
	name: string;
	source_type: string;
	source_tier: "bedrock" | "web_search";
	trust: string;
	coverage_note: string;
	scope_note_used: string | null;
}

interface S2Output {
	selected: S2Selected[];
	rejected_with_reason: Array<{ url: string; reason: string }>;
	uses_analog: boolean;
}

interface S2_5Output {
	structural_fit: number;
	confidence: number;
	epistemic_strength: number;
	epistemic_strength_label: "settled" | "contested" | "speculative";
	constitutive_role: number;
	constitutive_role_label: "constitutive" | "contributory";
	composite: number;
	advance_to_drafting: boolean;
	rationale: string;
	rubric_notes?: string;
}

const bedrock: BedrockShelf =
	typeof BEDROCK_SHELF_JSON === "string" ? JSON.parse(BEDROCK_SHELF_JSON as unknown as string) : (BEDROCK_SHELF_JSON as unknown as BedrockShelf);
const analogSeed: AnalogSeed =
	typeof ANALOG_SEED_JSON === "string" ? JSON.parse(ANALOG_SEED_JSON as unknown as string) : (ANALOG_SEED_JSON as unknown as AnalogSeed);

function fillTemplate(tpl: string, vars: Record<string, string | number | null | undefined>): string {
	let out = tpl;
	for (const [k, v] of Object.entries(vars)) {
		const placeholder = `<<${k}>>`;
		const value = v === null || v === undefined ? "(null)" : String(v);
		out = out.split(placeholder).join(value);
	}
	return out;
}

async function fetchGapRow(env: Uc3Env, gap_id: string): Promise<GapRow | null> {
	const resp = await fetch(`https://api.notion.com/v1/databases/${LEARNING_GAPS_QUEUE_DB_ID}/query`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.NOTION_TOKEN}`,
			"Notion-Version": "2022-06-28",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ page_size: 100, sorts: [{ timestamp: "created_time", direction: "descending" }] }),
		signal: AbortSignal.timeout(15_000),
	});
	if (!resp.ok) return null;
	const json = (await resp.json()) as { results?: Array<Record<string, any>> };
	const rows = json.results || [];
	const match = rows.find((r) => String(r.id).replace(/-/g, "").slice(-8) === gap_id);
	if (!match) return null;
	const props = match.properties || {};
	const titleArr = props["Gap Title"]?.title || [];
	const voiceArr = props["Voice Capture Text"]?.rich_text || [];
	const srcDocArr = props["Trigger Source Doc"]?.relation || [];
	const srcIdArr = props["Trigger Source Doc ID"]?.rich_text || [];
	return {
		gap_title: titleArr.map((t: any) => t.plain_text || "").join(""),
		domain: props["Domain"]?.select?.name ?? null,
		voice_capture_text: voiceArr.map((t: any) => t.plain_text || "").join("") || null,
		requested_module_count: props["Requested Module Count"]?.number ?? null,
		trigger_source_doc_id: srcDocArr[0]?.id ?? srcIdArr.map((t: any) => t.plain_text || "").join("") ?? null,
		trigger_surface: props["Trigger Surface"]?.select?.name ?? null,
		notion_url: match.url,
	};
}

async function patchGapStatus(
	env: Uc3Env,
	gap_id: string,
	patch: { status?: string; last_stage?: string; pipeline_run_id?: string },
): Promise<void> {
	const fullId = await resolveFullId(env, gap_id);
	if (!fullId) return;
	const properties: Record<string, any> = {};
	if (patch.status) properties["Status"] = { select: { name: patch.status } };
	if (patch.last_stage) properties["Last Stage"] = { select: { name: patch.last_stage } };
	if (patch.pipeline_run_id) {
		properties["Pipeline Run ID"] = {
			rich_text: [{ type: "text", text: { content: patch.pipeline_run_id } }],
		};
	}
	if (Object.keys(properties).length === 0) return;
	await fetch(`https://api.notion.com/v1/pages/${fullId}`, {
		method: "PATCH",
		headers: {
			Authorization: `Bearer ${env.NOTION_TOKEN}`,
			"Notion-Version": "2022-06-28",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ properties }),
		signal: AbortSignal.timeout(15_000),
	});
}

async function resolveFullId(env: Uc3Env, short_id: string): Promise<string | null> {
	const resp = await fetch(`https://api.notion.com/v1/databases/${LEARNING_GAPS_QUEUE_DB_ID}/query`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.NOTION_TOKEN}`,
			"Notion-Version": "2022-06-28",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ page_size: 100, sorts: [{ timestamp: "created_time", direction: "descending" }] }),
		signal: AbortSignal.timeout(15_000),
	});
	if (!resp.ok) return null;
	const json = (await resp.json()) as { results?: Array<{ id: string }> };
	const match = (json.results || []).find((r) => r.id.replace(/-/g, "").slice(-8) === short_id);
	return match?.id ?? null;
}

async function listListenedPageIds(env: Uc3Env): Promise<string[]> {
	const resp = await fetch(`https://api.notion.com/v1/databases/${READING_PARKING_LOT_DB_ID}/query`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.NOTION_TOKEN}`,
			"Notion-Version": "2022-06-28",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			filter: { property: "Status", select: { equals: "Listened" } },
			page_size: 100,
		}),
		signal: AbortSignal.timeout(15_000),
	});
	if (!resp.ok) return [];
	const json = (await resp.json()) as { results?: Array<{ id: string }> };
	return (json.results || []).map((r) => r.id);
}

async function queryCorpus(env: Uc3Env, query: string, engagedDocIds: string[]): Promise<unknown> {
	if (!env.N8N_BASE_URL || !env.WEBHOOK_SECRET) return { results: [], note: "n8n not configured" };
	try {
		const resp = await fetch(`${env.N8N_BASE_URL}/webhook/query`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.WEBHOOK_SECRET}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				query,
				engaged_doc_ids: engagedDocIds,
				top_k: 8,
			}),
			signal: AbortSignal.timeout(30_000),
		});
		if (!resp.ok) {
			return { results: [], error: `n8n ${resp.status}` };
		}
		return await resp.json();
	} catch (e) {
		return { results: [], error: (e as Error).message };
	}
}

function pickDomainSources(domain: string | null): BedrockSource[] {
	if (!domain) {
		const all: BedrockSource[] = [];
		for (const d of Object.values(bedrock.domains)) all.push(...d.sources);
		return all;
	}
	return bedrock.domains[domain]?.sources ?? [];
}

export class Uc3FundamentalsPipeline extends WorkflowEntrypoint<Uc3Env, Uc3PipelineParams> {
	async run(event: WorkflowEvent<Uc3PipelineParams>, step: WorkflowStep): Promise<void> {
		const env = this.env;
		const gap_id = event.payload.gap_id;
		const instanceId = event.instanceId;

		// ── S0: init ─────────────────────────────────────────────────────────
		const gap = await step.do(
			"S0-init",
			{ retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "30 seconds" },
			async () => {
				const row = await fetchGapRow(env, gap_id);
				if (!row) throw new Error(`gap ${gap_id} not found in Learning Gaps Queue`);
				await upsertPipelineState(env.UC3_DB, {
					gap_id,
					workflow_instance_id: instanceId,
					stage: "S0",
					status: "running",
				});
				await patchGapStatus(env, gap_id, {
					status: "Researching",
					last_stage: "S0",
					pipeline_run_id: instanceId,
				});
				await logVerification(env.UC3_DB, {
					module_id: null,
					stage: "S0",
					ok: true,
					response_json: JSON.stringify({ gap_id, instanceId, gap: row }),
				});
				return row;
			},
		);

		// ── S1: topic decomposition ──────────────────────────────────────────
		const s1: S1Output = await step.do(
			"S1-decompose",
			{ retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" },
			async () => {
				const prompt = fillTemplate(S1_PROMPT as unknown as string, {
					GAP_TITLE: gap.gap_title,
					DOMAIN: gap.domain ?? "(unspecified)",
					VOICE_CAPTURE_TEXT: gap.voice_capture_text ?? "(none)",
					REQUESTED_MODULE_COUNT: gap.requested_module_count ?? "null",
					TRIGGER_SOURCE_CONTEXT: gap.trigger_source_doc_id ?? "(no source doc)",
				});
				const promptHash = await sha256Hex(prompt);
				const r = await callAnthropic({
					apiKey: env.ANTHROPIC_API_KEY,
					model: MODEL_S1,
					user: prompt,
					maxTokens: 2048,
				});
				if (!r.ok || !r.text) {
					await logVerification(env.UC3_DB, {
						module_id: null,
						stage: "S1",
						model: MODEL_S1,
						prompt_hash: promptHash,
						request_json: JSON.stringify({ gap_id }),
						ok: false,
						error_text: r.error,
					});
					throw new Error(`S1 Anthropic call failed: ${r.error}`);
				}
				const parsed = extractJson<S1Output>(r.text);
				if (!parsed || !Array.isArray(parsed.modules) || parsed.modules.length === 0) {
					await logVerification(env.UC3_DB, {
						module_id: null,
						stage: "S1",
						model: MODEL_S1,
						prompt_hash: promptHash,
						request_json: JSON.stringify({ gap_id }),
						response_json: r.text.slice(0, 4000),
						ok: false,
						error_text: "S1 output did not parse as expected JSON",
					});
					throw new Error("S1 output did not parse");
				}
				await logVerification(env.UC3_DB, {
					module_id: null,
					stage: "S1",
					model: MODEL_S1,
					prompt_hash: promptHash,
					request_json: JSON.stringify({ gap_id, model: MODEL_S1 }),
					response_json: JSON.stringify(parsed),
					ok: true,
				});
				for (const m of parsed.modules) {
					await insertLearningModule(env.UC3_DB, {
						gap_id,
						position_in_series: m.position,
						learning_objective: m.objective,
						dependencies_json: JSON.stringify(m.depends_on || []),
					});
				}
				await upsertPipelineState(env.UC3_DB, { gap_id, stage: "S1", status: "running" });
				await patchGapStatus(env, gap_id, { last_stage: "S1" });
				return parsed;
			},
		);

		// Get the inserted module rows back (need their D1 ids).
		const modules = await step.do(
			"S1-fetch-module-ids",
			{ retries: { limit: 2, delay: "1 second" }, timeout: "15 seconds" },
			async () => {
				const r = await env.UC3_DB
					.prepare("SELECT id, position_in_series, learning_objective, dependencies_json FROM learning_modules WHERE gap_id = ? ORDER BY position_in_series ASC")
					.bind(gap_id)
					.all<{ id: number; position_in_series: number; learning_objective: string; dependencies_json: string }>();
				return r.results ?? [];
			},
		);

		// ── S2 first (gates S2.5 on its uses_analog signal) + S3 parallel ───
		// Per module: S2 → then S2.5 (only if S2.uses_analog) + S3 in parallel.
		// Top-level: all modules run in parallel.
		await step.do(
			"S2-then-S2.5+S3-parallel",
			{ retries: { limit: 1, delay: "10 seconds" }, timeout: "10 minutes" },
			async () => {
				const listenedIds = await listListenedPageIds(env);
				await Promise.all(
					modules.map(async (m) => {
						const s2 = await runS2(env, gap.domain, m);
						await Promise.all([
							s2.uses_analog ? runS2_5(env, m) : Promise.resolve(),
							runS3(env, m, listenedIds),
						]);
					}),
				);
				await upsertPipelineState(env.UC3_DB, { gap_id, stage: "S2.5", status: "running" });
				await patchGapStatus(env, gap_id, { last_stage: "S2.5" });
			},
		);

		// ── S4: outline generation ───────────────────────────────────────────
		await step.do(
			"S4-outline",
			{ retries: { limit: 1, delay: "5 seconds" }, timeout: "10 minutes" },
			async () => {
				await Promise.all(
					modules.map(async (m) => {
						const citations = await listCitationsByModule(env.UC3_DB, m.id);
						const analogs = await listAnalogsByModule(env.UC3_DB, m.id);
						const advanceAnalogs = analogs.filter((a) => a.advance_to_drafting === 1);
						const corpus = await queryCorpus(env, m.learning_objective, await listListenedPageIds(env));
						const depTexts = (JSON.parse(m.dependencies_json || "[]") as number[])
							.map((depPos) => {
								const dep = modules.find((mm) => mm.position_in_series === depPos);
								return dep ? `- pos ${depPos}: ${dep.learning_objective}` : `- pos ${depPos}: (missing)`;
							})
							.join("\n") || "(no prerequisite modules)";
						const prompt = fillTemplate(S4_PROMPT as unknown as string, {
							MODULE_POSITION: m.position_in_series,
							TOTAL_MODULES: modules.length,
							LEARNING_OBJECTIVE: m.learning_objective,
							AUDIO_RATIONALE: s1.modules.find((sm) => sm.position === m.position_in_series)?.audio_rationale ?? "",
							DEPENDENCIES_TEXT: depTexts,
							CITATIONS_JSON: JSON.stringify(citations),
							ANALOG_JSON: JSON.stringify(advanceAnalogs),
							CORPUS_SNIPPETS_JSON: JSON.stringify(corpus),
						});
						const promptHash = await sha256Hex(prompt);
						const r = await callAnthropic({
							apiKey: env.ANTHROPIC_API_KEY,
							model: MODEL_S4,
							user: prompt,
							maxTokens: 4096,
						});
						if (!r.ok || !r.text) {
							await logVerification(env.UC3_DB, {
								module_id: m.id,
								stage: "S4",
								model: MODEL_S4,
								prompt_hash: promptHash,
								ok: false,
								error_text: r.error,
							});
							return;
						}
						const parsed = extractJson(r.text);
						if (!parsed) {
							await logVerification(env.UC3_DB, {
								module_id: m.id,
								stage: "S4",
								model: MODEL_S4,
								prompt_hash: promptHash,
								response_json: r.text.slice(0, 4000),
								ok: false,
								error_text: "S4 output did not parse",
							});
							return;
						}
						await setModuleOutline(env.UC3_DB, m.id, JSON.stringify(parsed));
						await logVerification(env.UC3_DB, {
							module_id: m.id,
							stage: "S4",
							model: MODEL_S4,
							prompt_hash: promptHash,
							response_json: JSON.stringify(parsed),
							ok: true,
						});
					}),
				);
				await upsertPipelineState(env.UC3_DB, { gap_id, stage: "S4", status: "paused" });
				await patchGapStatus(env, gap_id, { status: "Drafted", last_stage: "S4" });
			},
		);
	}
}

// ── S2 helper: bedrock + brave → ranked sources for one module ────────────
// Returns {uses_analog} so the orchestrator can decide whether to run S2.5.
async function runS2(
	env: Uc3Env,
	domain: string | null,
	module: { id: number; learning_objective: string },
): Promise<{ uses_analog: boolean }> {
	const bedrockCandidates = pickDomainSources(domain);
	const brave = await searchBrave({
		apiKey: env.BRAVE_SEARCH_API_KEY,
		query: module.learning_objective,
		count: 10,
	});
	const braveFiltered: BraveResult[] = brave.ok && brave.results
		? filterDenyList(brave.results, bedrock.deny_list?.patterns ?? [])
		: [];
	const prompt = fillTemplate(S2_PROMPT as unknown as string, {
		MODULE_POSITION: 0,
		TOTAL_MODULES: 0,
		LEARNING_OBJECTIVE: module.learning_objective,
		DOMAIN: domain ?? "(unspecified)",
		BEDROCK_JSON: JSON.stringify(bedrockCandidates),
		BRAVE_JSON: JSON.stringify(braveFiltered),
	});
	const promptHash = await sha256Hex(prompt);
	const r = await callAnthropic({
		apiKey: env.ANTHROPIC_API_KEY,
		model: MODEL_S2,
		user: prompt,
		maxTokens: 3072,
	});
	if (!r.ok || !r.text) {
		await logVerification(env.UC3_DB, {
			module_id: module.id,
			stage: "S2",
			model: MODEL_S2,
			prompt_hash: promptHash,
			ok: false,
			error_text: r.error,
		});
		return { uses_analog: false };
	}
	const parsed = extractJson<S2Output>(r.text);
	if (!parsed || !Array.isArray(parsed.selected)) {
		await logVerification(env.UC3_DB, {
			module_id: module.id,
			stage: "S2",
			model: MODEL_S2,
			prompt_hash: promptHash,
			response_json: r.text.slice(0, 4000),
			ok: false,
			error_text: "S2 output did not parse",
		});
		return { uses_analog: false };
	}
	for (const sel of parsed.selected) {
		await insertCitation(env.UC3_DB, {
			module_id: module.id,
			source_url: sel.url,
			source_name: sel.name,
			source_type: sel.source_type,
			source_tier: sel.source_tier,
			scope_note_used: sel.scope_note_used,
		});
	}
	await logVerification(env.UC3_DB, {
		module_id: module.id,
		stage: "S2",
		model: MODEL_S2,
		prompt_hash: promptHash,
		response_json: JSON.stringify(parsed),
		ok: true,
	});
	return { uses_analog: parsed.uses_analog === true };
}

// ── S2.5 helper: analog ranking against 4-criterion rubric ────────────────
// Called only when S2 returns uses_analog=true. The regex heuristic was
// replaced 2026-05-17 with the data-driven signal from the S2 LLM ranker.
async function runS2_5(
	env: Uc3Env,
	module: { id: number; learning_objective: string },
): Promise<void> {
	for (const entry of analogSeed.entries) {
		const prompt = fillTemplate(ANALOG_RANKING_PROMPT as unknown as string, {
			TARGET_TOPIC: module.learning_objective,
			TARGET_FRAMING: "transformation",
			ANALOG_TITLE: `${entry.author} — ${entry.work}`,
			ANALOG_SOURCE: `${entry.author} (${entry.year})`,
			ANALOG_BRIEF: entry.framework_summary,
			ANALOG_MECHANISM: entry.framework,
		});
		const promptHash = await sha256Hex(prompt);
		const r = await callAnthropic({
			apiKey: env.ANTHROPIC_API_KEY,
			model: MODEL_S2_5,
			user: prompt,
			maxTokens: 1024,
		});
		if (!r.ok || !r.text) {
			await logVerification(env.UC3_DB, {
				module_id: module.id,
				stage: "S2.5",
				model: MODEL_S2_5,
				prompt_hash: promptHash,
				ok: false,
				error_text: r.error,
			});
			continue;
		}
		const parsed = extractJson<S2_5Output>(r.text);
		if (!parsed) {
			await logVerification(env.UC3_DB, {
				module_id: module.id,
				stage: "S2.5",
				model: MODEL_S2_5,
				prompt_hash: promptHash,
				response_json: r.text.slice(0, 2000),
				ok: false,
				error_text: "S2.5 output did not parse",
			});
			continue;
		}
		await insertAnalogRanking(env.UC3_DB, {
			module_id: module.id,
			analog_author: entry.author,
			analog_work: entry.work,
			structural_fit: parsed.structural_fit,
			confidence: parsed.confidence,
			epistemic_strength: parsed.epistemic_strength,
			epistemic_strength_label: parsed.epistemic_strength_label,
			constitutive_role: parsed.constitutive_role,
			constitutive_role_label: parsed.constitutive_role_label,
			composite: parsed.composite,
			advance_to_drafting: parsed.advance_to_drafting ? 1 : 0,
			rationale: parsed.rationale ?? null,
			rubric_notes: parsed.rubric_notes ?? null,
		});
		await logVerification(env.UC3_DB, {
			module_id: module.id,
			stage: "S2.5",
			model: MODEL_S2_5,
			prompt_hash: promptHash,
			response_json: JSON.stringify(parsed),
			ok: true,
		});
	}
}

// ── S3 helper: corpus retrieval with engagement bias ──────────────────────
async function runS3(
	env: Uc3Env,
	module: { id: number; learning_objective: string },
	engagedDocIds: string[],
): Promise<void> {
	const result = await queryCorpus(env, module.learning_objective, engagedDocIds);
	await logVerification(env.UC3_DB, {
		module_id: module.id,
		stage: "S3",
		response_json: JSON.stringify({ engaged_doc_ids: engagedDocIds, result }),
		ok: true,
	});
}
