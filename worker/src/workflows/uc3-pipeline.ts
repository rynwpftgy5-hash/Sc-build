// §8.4a.21 W4 + W5 — UC3 Fundamentals pipeline (S0-S7).
// Cloudflare Workflow that orchestrates topic decomposition → source discovery →
// analog ranking → corpus retrieval → outline generation → section drafting via
// Queue → per-module polish → per-claim verification (with auto-rewrite) →
// holistic LLM-as-judge. Lands modules at status='review-brief-pending' for W6.
//
// S8-S12 land in W6-W8 (separate workstreams per dispatch).

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
	insertSection,
	listSectionsByModule,
	countSectionsByStatusForGap,
	setModuleTranscriptR2,
	setModuleStatus,
	setModuleVoiceId,
	insertClaim,
	setClaimVerification,
	flagClaimForHumanReview,
	listClaimsByModule,
	moduleHasHumanReviewClaims,
	insertVerificationPass,
	type SectionType,
} from "../lib/d1-uc3";
import { pickVoiceForPosition } from "../lib/voice-rotation";
import { putTranscript, getTranscript } from "../lib/r2-transcripts";
import { reviseModule } from "../lib/revise-module";
import { generateBriefScript, generateBriefAudio } from "../lib/review-brief";
import type { S5DraftMessage } from "../lib/queues";

// @ts-expect-error — Wrangler Text rule
import S1_PROMPT from "../../prompts/s1_topic_decomposition.txt";
// @ts-expect-error — Wrangler Text rule
import S2_PROMPT from "../../prompts/s2_source_discovery.txt";
// @ts-expect-error — Wrangler Text rule
import S4_PROMPT from "../../prompts/s4_outline_generation.txt";
// @ts-expect-error — Wrangler Text rule
import ANALOG_RANKING_PROMPT from "../../prompts/analog_ranking.txt";
// @ts-expect-error — Wrangler Text rule
import S5B_PROMPT from "../../prompts/s5b_module_polish.txt";
// @ts-expect-error — Wrangler Text rule
import S6_CLAIM_EXTRACT_PROMPT from "../../prompts/s6_claim_extract.txt";
// @ts-expect-error — Wrangler Text rule
import S6_CLAIMS_VERIFY_BATCH_PROMPT from "../../prompts/s6_claims_verify_batch.txt";
// @ts-expect-error — Wrangler Text rule
import S7_MODULE_JUDGE_PROMPT from "../../prompts/s7_module_judge.txt";
import BEDROCK_SHELF_JSON from "../../prompts/bedrock_shelf.json";
import ANALOG_SEED_JSON from "../../prompts/analog_seed_bibliography.json";

const LEARNING_GAPS_QUEUE_DB_ID = "35ebac9a-7841-41bc-91fd-224b58feb9a3";
const READING_PARKING_LOT_DB_ID = "f3a2418b-6c9a-4ac3-92ad-3df613bf5772";

const MODEL_S1: AnthropicModel = "claude-sonnet-4-6";
const MODEL_S2: AnthropicModel = "claude-haiku-4-5-20251001";
const MODEL_S2_5: AnthropicModel = "claude-sonnet-4-6";
const MODEL_S4: AnthropicModel = "claude-sonnet-4-6";
const MODEL_S5B: AnthropicModel = "claude-sonnet-4-6";
const MODEL_S6_EXTRACT: AnthropicModel = "claude-sonnet-4-6";
// §8.4a.21 W5 post-dry-run-#11: swapped from Haiku to Sonnet after empirical
// test on Module 5 — Haiku batched returned 0ok/23fail (100% false-negative),
// Sonnet returned 16ok/7fail (70% verify rate + caught real defects). Cost
// impact: ~3x per claim, ~$0.10 increase per gap.
const MODEL_S6_VERIFY: AnthropicModel = "claude-sonnet-4-6";
const MODEL_S7: AnthropicModel = "claude-sonnet-4-6";

export interface Uc3Env {
	UC3_DB: D1Database;
	ANTHROPIC_API_KEY: string;
	BRAVE_SEARCH_API_KEY: string;
	NOTION_TOKEN: string;
	WEBHOOK_SECRET: string;
	N8N_BASE_URL: string;
	S5_DRAFT_QUEUE: Queue<S5DraftMessage>;
	TTS_CACHE: R2Bucket;
	// §8.4a.21 W6 additions
	ELEVENLABS_API_KEY: string;
	ELEVENLABS_DEFAULT_VOICE_ID?: string;
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
					gap_title: row.gap_title, // §8.4a.21 W9 UX-fix: persist for list-gaps
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
					const id = await insertLearningModule(env.UC3_DB, {
						gap_id,
						position_in_series: m.position,
						learning_objective: m.objective,
						dependencies_json: JSON.stringify(m.depends_on || []),
					});
					// §8.4a.23 — assign rotation voice once, persist on the module.
					// Same voice for brief + full audio later. Survives regenerations.
					const v = pickVoiceForPosition(m.position);
					await setModuleVoiceId(env.UC3_DB, id, v.voice_id);
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

		// ── Listened-doc-ids (one Notion call, used by S3 + S4 per module) ───
		// Done OUTSIDE the per-module steps so we don't fan-out a wasted Notion
		// query per module; each step.do then gets the list as a deterministic
		// input. The step.do itself caches the result for retries.
		const listenedIds: string[] = await step.do(
			"fetch-listened-page-ids",
			{ retries: { limit: 2, delay: "2 seconds" }, timeout: "30 seconds" },
			async () => await listListenedPageIds(env),
		);

		// ── S2 fan-out: one step.do per module, each in its own Worker invocation ─
		// Fresh subrequest budget per module — fixes the "Too many subrequests by
		// single Worker invocation" error when Promise.all batched all per-module
		// work into one step. step.do parallelism via Promise.all of step.do calls.
		// Returns {uses_analog} per module for S2.5 gating.
		const s2Results: Array<{ position: number; uses_analog: boolean }> = await Promise.all(
			modules.map((m) =>
				step.do(
					`S2-module-${m.id}`,
					{ retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "3 minutes" },
					async () => {
						const out = await runS2(env, gap.domain, m);
						return { position: m.position_in_series, uses_analog: out.uses_analog };
					},
				),
			),
		);

		// ── S3 fan-out (parallel with S2.5; independent inputs) ──────────────
		await Promise.all(
			modules.map((m) =>
				step.do(
					`S3-module-${m.id}`,
					{ retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" },
					async () => {
						await runS3(env, m, listenedIds);
						return { position: m.position_in_series };
					},
				),
			),
		);

		// ── S2.5 fan-out: only modules where S2 judged uses_analog=true ──────
		const analogModules = modules.filter((_m, i) => s2Results[i]?.uses_analog === true);
		if (analogModules.length > 0) {
			await Promise.all(
				analogModules.map((m) =>
					step.do(
						`S2.5-module-${m.id}`,
						{ retries: { limit: 1, delay: "10 seconds" }, timeout: "5 minutes" },
						async () => {
							await runS2_5(env, m);
							return { position: m.position_in_series };
						},
					),
				),
			);
		}

		// Mark progress before S4.
		await step.do(
			"mark-pre-S4",
			{ retries: { limit: 2, delay: "2 seconds" }, timeout: "20 seconds" },
			async () => {
				await upsertPipelineState(env.UC3_DB, { gap_id, stage: "S2.5", status: "running" });
				await patchGapStatus(env, gap_id, { last_stage: "S2.5" });
				return { ok: true };
			},
		);

		// ── S4 fan-out: outline generation per module ────────────────────────
		await Promise.all(
			modules.map((m) =>
				step.do(
					`S4-module-${m.id}`,
					{ retries: { limit: 1, delay: "10 seconds" }, timeout: "5 minutes" },
					async () => {
						const citations = await listCitationsByModule(env.UC3_DB, m.id);
						const analogs = await listAnalogsByModule(env.UC3_DB, m.id);
						const advanceAnalogs = analogs.filter((a) => a.advance_to_drafting === 1);
						const corpus = await queryCorpus(env, m.learning_objective, listenedIds);
						const depTexts =
							(JSON.parse(m.dependencies_json || "[]") as number[])
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
							return { position: m.position_in_series, ok: false, error: r.error };
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
							return { position: m.position_in_series, ok: false, error: "parse failed" };
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
						return { position: m.position_in_series, ok: true };
					},
				),
			),
		);

		// Mark S4 complete + auto-advance to S5 (no Campbell gate here per W5 plan).
		await step.do(
			"mark-S4-complete",
			{ retries: { limit: 2, delay: "2 seconds" }, timeout: "20 seconds" },
			async () => {
				await upsertPipelineState(env.UC3_DB, { gap_id, stage: "S4", status: "running" });
				await patchGapStatus(env, gap_id, { status: "Drafted", last_stage: "S4" });
				return { ok: true };
			},
		);

		// Refetch modules with outline_json now that S4 populated it.
		const modulesWithOutlines = await step.do(
			"S5-refetch-modules-with-outlines",
			{ retries: { limit: 2, delay: "2 seconds" }, timeout: "15 seconds" },
			async () => {
				const r = await env.UC3_DB
					.prepare(
						"SELECT id, position_in_series, learning_objective, dependencies_json, outline_json FROM learning_modules WHERE gap_id = ? ORDER BY position_in_series ASC",
					)
					.bind(gap_id)
					.all<{ id: number; position_in_series: number; learning_objective: string; dependencies_json: string; outline_json: string | null }>();
				return r.results ?? [];
			},
		);

		// ═════════════════════════════════════════════════════════════════════
		// W5 — S5 section drafting (Queue fan-out + per-module polish)
		// ═════════════════════════════════════════════════════════════════════

		// S5a-prepare: fan-out per-module (each module gets its own Worker invocation
		// with its own subrequest budget — ~14 section inserts + 1 sendBatch per
		// module is well under the per-invocation cap).
		await Promise.all(
			modulesWithOutlines.map((m) =>
				step.do(
					`S5a-enqueue-module-${m.id}`,
					{ retries: { limit: 2, delay: "5 seconds" }, timeout: "1 minute" },
					async () => {
						if (!m.outline_json) return { module_id: m.id, enqueued: 0 };
						const outline = JSON.parse(m.outline_json) as {
							hook?: unknown;
							core_concept?: unknown;
							sub_concepts?: unknown[];
							integration?: unknown;
							self_checks?: unknown[];
						};
						const messages: S5DraftMessage[] = [];
						const enqueueOne = async (type: SectionType, position: number) => {
							const section_id = await insertSection(env.UC3_DB, {
								module_id: m.id,
								position,
								section_type: type,
								status: "queued",
							});
							messages.push({ module_id: m.id, section_id, gap_id });
						};
						if (outline.hook) await enqueueOne("hook", 1);
						if (outline.core_concept) await enqueueOne("core", 1);
						if (Array.isArray(outline.sub_concepts)) {
							for (let i = 0; i < outline.sub_concepts.length; i++) await enqueueOne("sub_concept", i + 1);
						}
						if (outline.integration) await enqueueOne("integration", 1);
						if (Array.isArray(outline.self_checks)) {
							for (let i = 0; i < outline.self_checks.length; i++) await enqueueOne("self_check", i + 1);
						}
						if (messages.length > 0) {
							await env.S5_DRAFT_QUEUE.sendBatch(messages.map((body) => ({ body })));
						}
						return { module_id: m.id, enqueued: messages.length };
					},
				),
			),
		);

		// (S5a-mark-enqueued removed — was hitting subrequest cumulative limit due
		// to CF Workflow runtime bundling consecutive step.do calls into one
		// Worker invocation.)

		// S5a-wait: poll D1 until all sections for this gap are drafted (or fail
		// after ~9 minutes — covers Worker queue retry headroom). Uses step.sleep
		// between polls so each poll iteration gets its own Worker invocation with
		// fresh subrequest budget (instead of accumulating 60+ D1 polls in one
		// invocation).
		let drafts = { total: 0, drafted: 0 };
		for (let i = 0; i < 60; i++) {
			drafts = await step.do(
				`S5a-check-drafts-${i}`,
				{ retries: { limit: 2, delay: "2 seconds" }, timeout: "20 seconds" },
				async () => await countSectionsByStatusForGap(env.UC3_DB, gap_id),
			);
			if (drafts.total > 0 && drafts.drafted >= drafts.total) break;
			await step.sleep(`S5a-wait-${i}`, "10 seconds");
		}
		if (!(drafts.total > 0 && drafts.drafted >= drafts.total)) {
			throw new Error(`S5a wait exhausted — drafted ${drafts.drafted}/${drafts.total}`);
		}

		// Force isolate refresh before S5b polish phase (resets subrequest counter).
		await step.sleep("pre-S5b-isolate-refresh", "5 seconds");

		// S5b: per-module polish (Promise.all of step.do fan-out — fresh Worker
		// invocation per module so subrequest budget stays per-module).
		await Promise.all(
			modulesWithOutlines.map((m) =>
				step.do(
					`S5b-polish-module-${m.id}`,
					{ retries: { limit: 1, delay: "10 seconds" }, timeout: "5 minutes" },
					async () => {
						const sections = await listSectionsByModule(env.UC3_DB, m.id);
						const draftedBeats = sections.map((s) => ({
							section_type: s.section_type,
							position: s.position,
							draft_text: s.draft_text,
							citations_used: s.citations_json ? JSON.parse(s.citations_json) : [],
						}));
						const outline = m.outline_json ? JSON.parse(m.outline_json) : {};
						const prompt = fillTemplate(S5B_PROMPT as unknown as string, {
							MODULE_POSITION: m.position_in_series,
							TOTAL_MODULES: modulesWithOutlines.length,
							LEARNING_OBJECTIVE: m.learning_objective,
							AUDIO_RATIONALE: outline.audio_voice_notes ?? "",
							DRAFTED_BEATS_JSON: JSON.stringify(draftedBeats),
						});
						const promptHash = await sha256Hex(prompt);
						const r = await callAnthropic({
							apiKey: env.ANTHROPIC_API_KEY,
							model: MODEL_S5B,
							user: prompt,
							// 8192 = current Sonnet max. W6 dry-run #17 Mod 1 hit 6144 cap
							// with 14 sections × ~400 words → ~6000-word polished output;
							// JSON envelope pushed past cap and truncated mid-string.
							maxTokens: 8192,
						});
						if (!r.ok || !r.text) {
							await logVerification(env.UC3_DB, {
								module_id: m.id,
								stage: "S5b",
								model: MODEL_S5B,
								prompt_hash: promptHash,
								ok: false,
								error_text: r.error,
							});
							return { ok: false };
						}
						const parsed = extractJson<{
							polished_transcript?: string;
							citations?: unknown;
							estimated_total_seconds?: number;
							polish_notes?: string;
						}>(r.text);
						if (!parsed || !parsed.polished_transcript) {
							await logVerification(env.UC3_DB, {
								module_id: m.id,
								stage: "S5b",
								model: MODEL_S5B,
								prompt_hash: promptHash,
								response_json: r.text.slice(0, 4000),
								ok: false,
								error_text: "S5b output did not parse",
							});
							return { ok: false };
						}
						const r2Key = await putTranscript(env.TTS_CACHE, m.id, parsed.polished_transcript);
						await setModuleTranscriptR2(env.UC3_DB, m.id, r2Key);
						await logVerification(env.UC3_DB, {
							module_id: m.id,
							stage: "S5b",
							model: MODEL_S5B,
							prompt_hash: promptHash,
							response_json: JSON.stringify({ ...parsed, polished_transcript: parsed.polished_transcript.slice(0, 600) + "…" }),
							ok: true,
						});
						return { ok: true };
					},
				),
			),
		);

		// Force isolate refresh before S6 phase.
		await step.sleep("pre-S6-isolate-refresh", "5 seconds");

		// ═════════════════════════════════════════════════════════════════════
		// W5 — S6 per-claim verification (sequential per-module — see note below)
		// ═════════════════════════════════════════════════════════════════════

		// Sequential per-module (NOT Promise.all) — CF Workflows bundles Promise.all
		// step.do calls into one Worker invocation, blowing the subrequest budget
		// when each module's S6 makes ~30 subrequests (extract + per-claim verify +
		// D1 writes). Sequential gives each module its own clean invocation.
		// Latency cost: ~5 modules × ~30s = ~150s. Acceptable for v1.
		for (const m of modules) {
			await step.do(
					`S6-verify-module-${m.id}`,
					{ retries: { limit: 1, delay: "10 seconds" }, timeout: "10 minutes" },
					async () => {
						const transcript = await getTranscript(env.TTS_CACHE, m.id);
						if (!transcript) {
							await logVerification(env.UC3_DB, {
								module_id: m.id,
								stage: "S6",
								ok: false,
								error_text: "no transcript in R2",
							});
							return { ok: false };
						}
						const citations = await listCitationsByModule(env.UC3_DB, m.id);

						// 1) Extract claims via Sonnet
						const extractPrompt = fillTemplate(S6_CLAIM_EXTRACT_PROMPT as unknown as string, {
							LEARNING_OBJECTIVE: m.learning_objective,
							POLISHED_TRANSCRIPT: transcript,
							CITATIONS_JSON: JSON.stringify(citations.map((c) => ({ name: c.source_name, url: c.source_url }))),
						});
						const extractHash = await sha256Hex(extractPrompt);
						const extractR = await callAnthropic({
							apiKey: env.ANTHROPIC_API_KEY,
							model: MODEL_S6_EXTRACT,
							user: extractPrompt,
							maxTokens: 3072,
						});
						if (!extractR.ok || !extractR.text) {
							await logVerification(env.UC3_DB, {
								module_id: m.id,
								stage: "S6-extract",
								model: MODEL_S6_EXTRACT,
								prompt_hash: extractHash,
								ok: false,
								error_text: extractR.error,
							});
							return { ok: false };
						}
						const extractParsed = extractJson<{
							claims?: Array<{ claim_text: string; cited_source_name?: string | null; cited_source_url?: string | null }>;
						}>(extractR.text);
						const claims = extractParsed?.claims ?? [];
						await logVerification(env.UC3_DB, {
							module_id: m.id,
							stage: "S6-extract",
							model: MODEL_S6_EXTRACT,
							prompt_hash: extractHash,
							response_json: JSON.stringify({ claim_count: claims.length }),
							ok: true,
						});

						// 2) Insert claims (assigned to first section per module for v1 — claim-to-section
						//    granular mapping is a polish item; the verification trail still works).
						const firstSection = (await listSectionsByModule(env.UC3_DB, m.id))[0];
						const sectionIdFallback = firstSection?.id ?? 0;
						const claimIds: Array<{ id: number; claim_text: string; source_name: string | null; source_url: string | null }> = [];
						for (const c of claims) {
							const id = await insertClaim(env.UC3_DB, {
								section_id: sectionIdFallback,
								module_id: m.id,
								claim_text: c.claim_text,
								cited_source_name: c.cited_source_name ?? null,
								cited_source_url: c.cited_source_url ?? null,
							});
							claimIds.push({
								id,
								claim_text: c.claim_text,
								source_name: c.cited_source_name ?? null,
								source_url: c.cited_source_url ?? null,
							});
						}

						// 3) Verify ALL claims in ONE batched Haiku call.
						// (W5 design pivot 2026-05-17: per-claim verification + auto-rewrite
						// loop hit CF Worker subrequest limits — ~200 subrequests/module
						// blew the cumulative budget. Batched call cuts that to ~5/module.
						// Auto-rewrite removed; failed claims go straight to needs_human_review.)
						let verified = 0;
						let failed = 0;
						const claimsForPrompt = claimIds.map((c) => ({
							id: c.id,
							claim_text: c.claim_text,
							cited_source_name: c.source_name,
							cited_source_url: c.source_url,
						}));
						if (claimsForPrompt.length > 0) {
							const verifyPrompt = fillTemplate(S6_CLAIMS_VERIFY_BATCH_PROMPT as unknown as string, {
								LEARNING_OBJECTIVE: m.learning_objective,
								CLAIMS_JSON: JSON.stringify(claimsForPrompt),
							});
							const r = await callAnthropic({
								apiKey: env.ANTHROPIC_API_KEY,
								model: MODEL_S6_VERIFY,
								user: verifyPrompt,
								maxTokens: 4096,
							});
							if (!r.ok || !r.text) {
								// Mark all claims as unverified + flag for review.
								for (const c of claimIds) {
									await setClaimVerification(env.UC3_DB, c.id, false, `batch verify failed: ${r.error}`);
									await flagClaimForHumanReview(env.UC3_DB, c.id);
									failed += 1;
								}
							} else {
								const parsed = extractJson<{
									verdicts?: Array<{ id: number; verified?: boolean; notes?: string }>;
								}>(r.text);
								const verdictById = new Map<number, { verified: boolean; notes: string | null }>();
								for (const v of parsed?.verdicts ?? []) {
									verdictById.set(v.id, { verified: v.verified === true, notes: v.notes ?? null });
								}
								for (const c of claimIds) {
									const v = verdictById.get(c.id) ?? { verified: false, notes: "no verdict returned" };
									await setClaimVerification(env.UC3_DB, c.id, v.verified, v.notes);
									if (v.verified) {
										verified += 1;
									} else {
										await flagClaimForHumanReview(env.UC3_DB, c.id);
										failed += 1;
									}
								}
							}
						}

						await insertVerificationPass(env.UC3_DB, {
							module_id: m.id,
							pass_number: 1,
							pass_type: "per_claim",
							model: MODEL_S6_VERIFY,
							verdict: failed === 0 ? "approved" : "revise",
							rationale: `verified ${verified}/${claimIds.length} claims; ${failed} failed and flagged for human review`,
						});
						return { ok: true, verified, failed, total: claimIds.length };
					},
				);
		}

		// (mark-S6-complete removed — see note above.)

		// Force isolate refresh before S7 phase.
		await step.sleep("pre-S7-isolate-refresh", "5 seconds");

		// ═════════════════════════════════════════════════════════════════════
		// W5 — S7 holistic LLM-as-judge (sequential per-module, same isolation
		// reason as S6 — each module's S7 makes ~1 Anthropic call + few D1 ops,
		// but bundling all 5 into one invocation hit the limit.)
		// ═════════════════════════════════════════════════════════════════════

		for (const m of modules) {
			await step.do(
					`S7-judge-module-${m.id}`,
					{ retries: { limit: 1, delay: "10 seconds" }, timeout: "3 minutes" },
					async () => {
						const transcript = await getTranscript(env.TTS_CACHE, m.id);
						if (!transcript) {
							await logVerification(env.UC3_DB, {
								module_id: m.id,
								stage: "S7",
								ok: false,
								error_text: "no transcript in R2",
							});
							return { ok: false };
						}
						const citations = await listCitationsByModule(env.UC3_DB, m.id);
						const claims = await listClaimsByModule(env.UC3_DB, m.id);
						const s6Trail = claims.map((c) => ({
							claim: c.claim_text,
							source: c.cited_source_name,
							verified: c.verified_pass1 === 1,
							needs_human_review: c.needs_human_review === 1,
							notes: c.verification_notes,
						}));
						const prompt = fillTemplate(S7_MODULE_JUDGE_PROMPT as unknown as string, {
							MODULE_POSITION: m.position_in_series,
							TOTAL_MODULES: modules.length,
							LEARNING_OBJECTIVE: m.learning_objective,
							POLISHED_TRANSCRIPT: transcript,
							CITATIONS_JSON: JSON.stringify(citations.map((c) => ({ name: c.source_name, url: c.source_url }))),
							S6_TRAIL_JSON: JSON.stringify(s6Trail),
						});
						const promptHash = await sha256Hex(prompt);
						const r = await callAnthropic({
							apiKey: env.ANTHROPIC_API_KEY,
							model: MODEL_S7,
							user: prompt,
							maxTokens: 2048,
						});
						if (!r.ok || !r.text) {
							await logVerification(env.UC3_DB, {
								module_id: m.id,
								stage: "S7",
								model: MODEL_S7,
								prompt_hash: promptHash,
								ok: false,
								error_text: r.error,
							});
							await insertVerificationPass(env.UC3_DB, {
								module_id: m.id,
								pass_number: 2,
								pass_type: "pedagogy",
								model: MODEL_S7,
								verdict: "revise",
								rationale: `S7 call failed: ${r.error}`,
							});
							return { ok: false };
						}
						const parsed = extractJson<{
							verdict?: string;
							cross_source_consistency?: { ok: boolean; concerns?: string[] };
							internal_consistency?: { ok: boolean; concerns?: string[] };
							pedagogical_soundness?: { ok: boolean; teaches_objective?: boolean; concerns?: string[] };
							rationale?: string;
						}>(r.text);
						const verdict = (parsed?.verdict === "approved" || parsed?.verdict === "reject") ? parsed.verdict : "revise";
						await insertVerificationPass(env.UC3_DB, {
							module_id: m.id,
							pass_number: 2,
							pass_type: "pedagogy",
							model: MODEL_S7,
							verdict,
							rationale: parsed?.rationale ?? null,
						});
						await logVerification(env.UC3_DB, {
							module_id: m.id,
							stage: "S7",
							model: MODEL_S7,
							prompt_hash: promptHash,
							response_json: JSON.stringify(parsed),
							ok: true,
						});
						return { ok: true, verdict };
					},
				);
		}

		// ═════════════════════════════════════════════════════════════════════
		// W5+ — Revision loop (1 pass): for any module S7 flagged revise,
		// fire one revise step per module (each step.do = fresh Worker
		// invocation = own subrequest budget).
		// ═════════════════════════════════════════════════════════════════════

		// Identify modules needing revision (latest S7 verdict = revise).
		const modulesToRevise: number[] = [];
		for (const m of modules) {
			const passes = await env.UC3_DB
				.prepare("SELECT verdict FROM verification_passes WHERE module_id = ? AND pass_number = 2 ORDER BY decided_at DESC LIMIT 1")
				.bind(m.id)
				.first<{ verdict: string }>();
			if (passes?.verdict === "revise") modulesToRevise.push(m.id);
		}

		if (modulesToRevise.length > 0) {
			await step.sleep("pre-revise-isolate-refresh", "5 seconds");
			// Up to 2 revision passes per module — break early on approved.
			const REVISION_PASS_CAP = 2;
			for (const mid of modulesToRevise) {
				for (let pass = 1; pass <= REVISION_PASS_CAP; pass++) {
					await step.do(
						`revise-module-${mid}-pass${pass}`,
						{ retries: { limit: 1, delay: "10 seconds" }, timeout: "8 minutes" },
						async () => await reviseModule(env, mid),
					);
					const latest = await step.do(
						`revise-check-${mid}-pass${pass}`,
						{ retries: { limit: 2, delay: "2 seconds" }, timeout: "20 seconds" },
						async () =>
							await env.UC3_DB
								.prepare(
									"SELECT verdict FROM verification_passes WHERE module_id = ? AND pass_number = 2 ORDER BY decided_at DESC LIMIT 1",
								)
								.bind(mid)
								.first<{ verdict: string }>(),
					);
					if (latest?.verdict === "approved") break;
				}
			}
		}

		// ═════════════════════════════════════════════════════════════════════
		// W6 — S8 review brief assembly (script via Sonnet + audio via ElevenLabs)
		// Sequential per-module — script + TTS each fresh Worker invocation
		// (fresh subrequest budget). Generated for ALL modules regardless of
		// S7 verdict so W7 voice feedback can react to imperfect modules.
		// ═════════════════════════════════════════════════════════════════════

		await step.sleep("pre-S8-isolate-refresh", "5 seconds");

		for (const m of modules) {
			await step.do(
				`S8-brief-script-${m.id}`,
				{ retries: { limit: 1, delay: "10 seconds" }, timeout: "5 minutes" },
				async () => await generateBriefScript(env, m.id),
			);
			await step.do(
				`S8-brief-tts-${m.id}`,
				{ retries: { limit: 1, delay: "10 seconds" }, timeout: "5 minutes" },
				async () => await generateBriefAudio(env, m.id),
			);
		}

		// Final state — set module + pipeline status based on aggregate.
		// (Reads post-revision verification_passes since revise updates them.)
		await step.do(
			"mark-S7-complete",
			{ retries: { limit: 2, delay: "2 seconds" }, timeout: "1 minute" },
			async () => {
				let anyRevision = false;
				for (const m of modules) {
					const needsReview = await moduleHasHumanReviewClaims(env.UC3_DB, m.id);
					const latestS7 = await env.UC3_DB
						.prepare("SELECT verdict FROM verification_passes WHERE module_id = ? AND pass_number = 2 ORDER BY decided_at DESC LIMIT 1")
						.bind(m.id)
						.first<{ verdict: string }>();
					if (needsReview || latestS7?.verdict !== "approved") {
						await setModuleStatus(env.UC3_DB, m.id, "revision-requested");
						anyRevision = true;
					} else {
						await setModuleStatus(env.UC3_DB, m.id, "review-brief-pending");
					}
				}
				await upsertPipelineState(env.UC3_DB, {
					gap_id,
					stage: "S8",
					status: anyRevision ? "paused" : "completed",
				});
				await patchGapStatus(env, gap_id, {
					status: anyRevision ? "Revision-Requested" : "Review-Brief-Pending",
					last_stage: "S8",
				});
				return { ok: true, anyRevision };
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
