// RESTART-2026-09 W1-C3 fallback — Worker-side Step 3 email triage.
//
// The n8n Step 3 workflow (BNBjoqXtPylHcMjs) has been writing Ingestion Log
// rows titled "undefined [triage:undefined]" with Error Message
// "Triage classification: . Rationale:" every hour since 2026-05-04: the
// classifier's output is empty by the time the Notion write runs (§2.5 /
// §2.14 HTTP-boundary state loss). The plan's fallback is to move the
// classification into the Worker on Sonnet with a strict JSON contract and
// have n8n call this endpoint instead. This module is that endpoint's brain.
//
// Contract: NEVER return undefined fields. If the model output cannot be
// parsed or validated, the result is classification="review" with a rationale
// that says so and `degraded: true`, so the Notion row is always well-formed
// and Campbell sees the failure instead of a blank.

import { callAnthropic, type AnthropicModel } from "./anthropic";

export const TRIAGE_CLASSES = ["ingest", "review", "skip", "spam"] as const;
export type TriageClass = (typeof TRIAGE_CLASSES)[number];
const DOMAINS = ["policy", "economics", "technology"] as const;
type Domain = (typeof DOMAINS)[number];

const TRIAGE_MODEL: AnthropicModel = "claude-sonnet-5";
const MAX_BODY_CHARS = 12_000;

export interface TriageClassifyInput {
	subject?: string;
	from?: string;
	to?: string;
	date?: string;
	message_id?: string;
	body_excerpt?: string;
	attachments?: Array<{ name?: string; mime?: string; size?: number }>;
}

export interface TriageClassifyOutput {
	ok: true;
	classification: TriageClass;
	rationale: string;
	confidence: number; // 0..1
	suggested_title: string;
	domain_primary: Domain | null;
	is_newsletter_digest: boolean;
	// Ready-to-write Notion fields in the shape Step 3 already uses.
	notion_title: string; // "<title> [triage:<class>]"
	error_message: string; // "Triage classification: <class>. Rationale: <why>"
	stage: "triage" | "triage_skip";
	degraded: boolean; // true when the model output was unusable and we defaulted to review
	model: string;
	usage?: { input_tokens?: number; output_tokens?: number };
}

const SYSTEM_PROMPT =
	"You triage inbound email for a single researcher's space security cooperation corpus (policy, economics, technology of cooperation in space security). " +
	"Classify each email into exactly one class:\n" +
	"- ingest: substantive research material worth adding to the corpus — an attached PDF/DOCX report, a forwarded long-form article or paper, a policy document, a detailed analysis.\n" +
	"- review: plausibly relevant but the researcher should decide — partial content, a single article link with little body, an event summary with useful detail, ambiguous provenance.\n" +
	"- skip: no research value — receipts, calendar/meeting mail, account notices, personal mail, marketing, short pointers with nothing to ingest.\n" +
	"- spam: unsolicited bulk mail, phishing, or obviously irrelevant.\n" +
	"Newsletters (multi-story digests such as SpaceNews First Up, Military Space, China Report) are handled by a separate parking workflow: classify them as review and set is_newsletter_digest=true.\n" +
	"Return ONLY a JSON object with keys: classification (ingest|review|skip|spam), rationale (one sentence, ≤200 chars), confidence (0..1), suggested_title (≤120 chars, the document or article title if evident, else a concise description), domain_primary (policy|economics|technology|null), is_newsletter_digest (boolean). No prose, no code fences.";

function clampStr(s: unknown, max: number, fallback = ""): string {
	const v = typeof s === "string" ? s.trim() : "";
	return (v || fallback).slice(0, max);
}

function buildUserMessage(input: TriageClassifyInput): string {
	const atts = (input.attachments || [])
		.map((a) => `- ${clampStr(a?.name, 200, "(unnamed)")}${a?.mime ? ` (${clampStr(a.mime, 80)})` : ""}${typeof a?.size === "number" ? ` ${a.size} bytes` : ""}`)
		.join("\n");
	return (
		`From: ${clampStr(input.from, 300)}\n` +
		`To: ${clampStr(input.to, 300)}\n` +
		`Date: ${clampStr(input.date, 80)}\n` +
		`Subject: ${clampStr(input.subject, 500)}\n` +
		`Attachments (${(input.attachments || []).length}):\n${atts || "- none"}\n\n` +
		`Body (first ${MAX_BODY_CHARS} chars):\n${clampStr(input.body_excerpt, MAX_BODY_CHARS)}`
	);
}

function extractJsonObject(text: string): unknown {
	const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
	try {
		return JSON.parse(trimmed);
	} catch {
		const start = trimmed.indexOf("{");
		const end = trimmed.lastIndexOf("}");
		if (start >= 0 && end > start) {
			try {
				return JSON.parse(trimmed.slice(start, end + 1));
			} catch {
				return null;
			}
		}
		return null;
	}
}

function finalize(
	cls: TriageClass,
	rationale: string,
	confidence: number,
	suggested_title: string,
	domain_primary: Domain | null,
	is_newsletter_digest: boolean,
	degraded: boolean,
	model: string,
	usage?: TriageClassifyOutput["usage"],
): TriageClassifyOutput {
	const title = suggested_title || "(untitled email)";
	return {
		ok: true,
		classification: cls,
		rationale,
		confidence: Math.max(0, Math.min(1, Number.isFinite(confidence) ? confidence : 0)),
		suggested_title: title,
		domain_primary,
		is_newsletter_digest,
		notion_title: `${title} [triage:${cls}]`,
		error_message: `Triage classification: ${cls}. Rationale: ${rationale}`,
		stage: cls === "skip" || cls === "spam" ? "triage_skip" : "triage",
		degraded,
		model,
		usage,
	};
}

export async function classifyEmailForTriage(
	input: TriageClassifyInput,
	env: { ANTHROPIC_API_KEY: string },
): Promise<TriageClassifyOutput | { ok: false; status: number; error: string }> {
	if (!env.ANTHROPIC_API_KEY) {
		return { ok: false, status: 500, error: "server misconfigured: ANTHROPIC_API_KEY secret missing" };
	}
	const hasAnything = clampStr(input.subject, 1) || clampStr(input.body_excerpt, 1) || (input.attachments || []).length > 0;
	if (!hasAnything) {
		return { ok: false, status: 400, error: "at least one of subject, body_excerpt, attachments is required" };
	}
	const fallbackTitle = clampStr(input.subject, 120, "(no subject)");
	const llm = await callAnthropic({
		apiKey: env.ANTHROPIC_API_KEY,
		model: TRIAGE_MODEL,
		system: SYSTEM_PROMPT,
		user: buildUserMessage(input),
		maxTokens: 400,
		timeoutMs: 45_000,
	});
	if (!llm.ok || !llm.text) {
		// Upstream failure: still return a well-formed row so nothing writes "undefined".
		return finalize("review", `classifier unavailable (${(llm.error || `status ${llm.status}`).slice(0, 120)}); defaulted to review`, 0, fallbackTitle, null, false, true, TRIAGE_MODEL);
	}
	const parsed = extractJsonObject(llm.text) as Record<string, unknown> | null;
	if (!parsed || typeof parsed !== "object") {
		return finalize("review", "classifier returned non-JSON output; defaulted to review", 0, fallbackTitle, null, false, true, TRIAGE_MODEL, llm.usage);
	}
	const clsRaw = clampStr(parsed.classification, 20).toLowerCase();
	const cls = (TRIAGE_CLASSES as readonly string[]).includes(clsRaw) ? (clsRaw as TriageClass) : null;
	if (!cls) {
		return finalize("review", `classifier returned unknown class "${clsRaw || "(empty)"}"; defaulted to review`, 0, fallbackTitle, null, false, true, TRIAGE_MODEL, llm.usage);
	}
	const domRaw = clampStr(parsed.domain_primary, 20).toLowerCase();
	const domain = (DOMAINS as readonly string[]).includes(domRaw) ? (domRaw as Domain) : null;
	const confidence = typeof parsed.confidence === "number" ? parsed.confidence : Number(parsed.confidence);
	return finalize(
		cls,
		clampStr(parsed.rationale, 200, "no rationale given"),
		confidence,
		clampStr(parsed.suggested_title, 120, fallbackTitle),
		domain,
		parsed.is_newsletter_digest === true,
		false,
		TRIAGE_MODEL,
		llm.usage,
	);
}
