// §8.4a.21 W5 — S5 section drafting Queue consumer.
// Processes S5DraftMessage batches: looks up the section + outline context,
// drafts the beat via Anthropic Sonnet, writes back to module_sections.

import { callAnthropic, extractJson, sha256Hex, type AnthropicModel } from "../lib/anthropic";
import {
	getSection,
	setSectionDraft,
	markSectionFailed,
	listCitationsByModule,
	listAnalogsByModule,
	logVerification,
	type ModuleSectionRow,
} from "../lib/d1-uc3";
import type { S5DraftMessage } from "../lib/queues";

// @ts-expect-error — Wrangler Text rule
import S5A_PROMPT from "../../prompts/s5a_section_draft.txt";

const MODEL_S5A: AnthropicModel = "claude-sonnet-4-6";

export interface S5ConsumerEnv {
	UC3_DB: D1Database;
	ANTHROPIC_API_KEY: string;
}

interface OutlineBeat {
	seconds?: number;
	text?: string;
	claim?: string;
	framing?: string;
	beat?: string;
	worked_example?: string;
	sources?: string[];
	uses_analog?: boolean;
	title?: string;
	question?: string;
	model_answer?: string;
	primary_source?: string;
}

interface OutlineJson {
	hook?: OutlineBeat;
	core_concept?: OutlineBeat;
	sub_concepts?: OutlineBeat[];
	integration?: OutlineBeat;
	self_checks?: OutlineBeat[];
	audio_voice_notes?: string;
}

function fillTemplate(tpl: string, vars: Record<string, string | number | null | undefined>): string {
	let out = tpl;
	for (const [k, v] of Object.entries(vars)) {
		out = out.split(`<<${k}>>`).join(v === null || v === undefined ? "(null)" : String(v));
	}
	return out;
}

function pickBeatFromOutline(outline: OutlineJson, section: ModuleSectionRow): OutlineBeat | null {
	switch (section.section_type) {
		case "hook":
			return outline.hook ?? null;
		case "core":
			return outline.core_concept ?? null;
		case "sub_concept": {
			const idx = section.position - 1;
			return outline.sub_concepts?.[idx] ?? null;
		}
		case "integration":
			return outline.integration ?? null;
		case "self_check": {
			const idx = section.position - 1;
			return outline.self_checks?.[idx] ?? null;
		}
		default:
			return null;
	}
}

function beatBrief(beat: OutlineBeat | null, sectionType: string): string {
	if (!beat) return "(no beat brief found in outline)";
	if (sectionType === "self_check") {
		return `Q: ${beat.question ?? ""}\nA: ${beat.model_answer ?? ""}`;
	}
	const parts: string[] = [];
	if (beat.title) parts.push(`Title: ${beat.title}`);
	if (beat.claim) parts.push(`Claim: ${beat.claim}`);
	if (beat.framing) parts.push(`Framing: ${beat.framing}`);
	if (beat.text) parts.push(`Text: ${beat.text}`);
	if (beat.beat) parts.push(`Beat: ${beat.beat}`);
	return parts.join("\n") || "(empty brief)";
}

async function processOne(env: S5ConsumerEnv, msg: S5DraftMessage): Promise<void> {
	const section = await getSection(env.UC3_DB, msg.section_id);
	if (!section) {
		await logVerification(env.UC3_DB, {
			module_id: msg.module_id,
			stage: "S5a",
			ok: false,
			error_text: `section ${msg.section_id} not found`,
		});
		return;
	}
	// Fetch module + outline.
	const modRow = await env.UC3_DB
		.prepare("SELECT learning_objective, outline_json, position_in_series FROM learning_modules WHERE id = ?")
		.bind(msg.module_id)
		.first<{ learning_objective: string; outline_json: string | null; position_in_series: number | null }>();
	if (!modRow || !modRow.outline_json) {
		await logVerification(env.UC3_DB, {
			module_id: msg.module_id,
			stage: "S5a",
			ok: false,
			error_text: "module or outline_json missing",
		});
		return;
	}
	const outline = JSON.parse(modRow.outline_json) as OutlineJson;
	const beat = pickBeatFromOutline(outline, section);
	const citations = await listCitationsByModule(env.UC3_DB, msg.module_id);
	const analogs = await listAnalogsByModule(env.UC3_DB, msg.module_id);
	const advanceAnalogs = analogs.filter((a) => a.advance_to_drafting === 1);

	const targetSeconds =
		beat?.seconds ??
		(section.section_type === "self_check" ? 20 : section.section_type === "hook" ? 30 : section.section_type === "core" ? 90 : section.section_type === "integration" ? 60 : 150);

	const prompt = fillTemplate(S5A_PROMPT as unknown as string, {
		MODULE_POSITION: modRow.position_in_series ?? 0,
		TOTAL_MODULES: 5,
		LEARNING_OBJECTIVE: modRow.learning_objective,
		AUDIO_RATIONALE: outline.audio_voice_notes ?? "",
		SECTION_TYPE: section.section_type,
		SECTION_POSITION: section.position,
		TARGET_SECONDS: targetSeconds,
		BEAT_BRIEF: beatBrief(beat, section.section_type),
		WORKED_EXAMPLE: beat?.worked_example ?? "(none)",
		SECTION_SOURCES_JSON: JSON.stringify(citations),
		ANALOG_JSON: JSON.stringify(advanceAnalogs),
		CORPUS_SNIPPETS_JSON: "[]",
	});
	const promptHash = await sha256Hex(prompt);

	const r = await callAnthropic({
		apiKey: env.ANTHROPIC_API_KEY,
		model: MODEL_S5A,
		user: prompt,
		maxTokens: 2048,
	});
	if (!r.ok || !r.text) {
		await markSectionFailed(env.UC3_DB, msg.section_id);
		await logVerification(env.UC3_DB, {
			module_id: msg.module_id,
			stage: "S5a",
			model: MODEL_S5A,
			prompt_hash: promptHash,
			ok: false,
			error_text: r.error,
		});
		return;
	}
	const parsed = extractJson<{
		draft_text?: string;
		citations_used?: Array<{ source_name: string; url: string; inline_phrasing: string }>;
		estimated_seconds?: number;
		flagged_for_underspecification?: boolean;
		notes?: string;
	}>(r.text);
	if (!parsed || !parsed.draft_text) {
		await markSectionFailed(env.UC3_DB, msg.section_id);
		await logVerification(env.UC3_DB, {
			module_id: msg.module_id,
			stage: "S5a",
			model: MODEL_S5A,
			prompt_hash: promptHash,
			response_json: r.text.slice(0, 4000),
			ok: false,
			error_text: "S5a output did not parse",
		});
		return;
	}
	await setSectionDraft(env.UC3_DB, msg.section_id, parsed.draft_text, JSON.stringify(parsed.citations_used ?? []));
	await logVerification(env.UC3_DB, {
		module_id: msg.module_id,
		stage: "S5a",
		model: MODEL_S5A,
		prompt_hash: promptHash,
		response_json: JSON.stringify(parsed),
		ok: true,
	});
}

export async function handleS5Queue(batch: MessageBatch<S5DraftMessage>, env: S5ConsumerEnv): Promise<void> {
	for (const msg of batch.messages) {
		try {
			await processOne(env, msg.body);
			msg.ack();
		} catch (err) {
			console.error(`S5 consumer error on section ${msg.body?.section_id}:`, err);
			msg.retry();
		}
	}
}
