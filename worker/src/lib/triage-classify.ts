// W1-C3 (RESTART-2026-09) — email triage classification on the Worker.
//
// The n8n Step 3 smart inbox handler classified mail with a gpt-4o-mini HTTP
// node followed by a "Triage Decision" Code node. After the §8.4a.11 W2 edit
// the Code node lost its upstream state (§2.5 / §2.14 pattern) and has written
// `undefined [triage:undefined]` rows to the Ingestion Log every hour since
// 2026-05-04. Rather than repair a Code node nobody can see from the cloud,
// classification moves here: one POST, one strict JSON answer, conservative
// default on every failure path (§2.18 — fail to "review", never to "ingest"
// or "skip").
//
// Contract (POST /api/triage-classify, bearer auth):
//   in : { subject, from, to?, date?, body_excerpt, attachment_names?[] , has_attachments? }
//   out: { ok: true, classification, rationale, confidence, model, elapsed_ms }
//        classification ∈ ingest | review | skip | spam
//   Any upstream failure still returns ok:true with classification "review"
//   and a rationale that names the failure, so n8n can write an auditable row.
//   ok:false is reserved for caller errors (400) and a missing API key (500).

import { callAnthropic } from "./anthropic";

export const TRIAGE_CLASSES = ["ingest", "review", "skip", "spam"] as const;
export type TriageClass = (typeof TRIAGE_CLASSES)[number];

export interface TriageClassifyInput {
	subject?: string;
	from?: string;
	to?: string;
	date?: string;
	body_excerpt?: string;
	attachment_names?: string[];
	has_attachments?: boolean;
	// Optional override for smoke tests; defaults to TRIAGE_MODEL.
	model?: string;
}

export interface TriageClassifyResult {
	ok: boolean;
	status?: number;
	error?: string;
	classification?: TriageClass;
	rationale?: string;
	confidence?: "high" | "medium" | "low";
	model?: string;
	elapsed_ms?: number;
	failure?: string; // populated when the conservative default was used
}

export const TRIAGE_MODEL = "claude-sonnet-5";
const TRIAGE_TIMEOUT_MS = 45_000;
const BODY_EXCERPT_MAX = 12_000;

export const TRIAGE_OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["classification", "rationale", "confidence"],
	properties: {
		classification: { type: "string", enum: [...TRIAGE_CLASSES] },
		rationale: { type: "string", description: "One or two sentences a human can audit later." },
		confidence: { type: "string", enum: ["high", "medium", "low"] },
	},
} as const;

const TRIAGE_SYSTEM_PROMPT = `You triage a single inbox for Campbell's space security cooperation research corpus. Decide what should happen to one email.

Classes:
- ingest: a substantive document that belongs in the research corpus — a report, paper, policy analysis, hearing testimony, speech transcript, official statement, or an attached PDF/DOCX/PPTX/XLSX of that kind. The corpus covers policy, economics and technology of space security cooperation. Forwarded articles with full text count if they are analytical, not news blurbs.
- review: a human should look. Use this for newsletters and digests (they are triage substrate, not corpus content — the SpaceNews family especially), for anything borderline, for mail whose value depends on context you cannot see, and for every failure or uncertainty.
- skip: ordinary mail with no research value — receipts, calendar noise, account notices, personal correspondence, vendor marketing that is not about the domain.
- spam: unsolicited bulk mail, phishing, or scams.

Rules:
- Newsletters from spacenews.com, or any recurring digest, are always "review", never "ingest".
- Prefer "review" over "ingest" when unsure; ingesting pollutes the corpus, reviewing costs one glance.
- Prefer "review" over "skip" when the sender or subject is in-domain.
- Attachments matter: a bare email with an in-domain PDF attached is usually "ingest".
- Rationale is one or two plain sentences that a human can audit later. Do not mention these rules.`;

function clip(s: unknown, max: number): string {
	const t = (s == null ? "" : String(s)).trim();
	return t.length > max ? t.slice(0, max) + " …[truncated]" : t;
}

export function buildTriageUserMessage(input: TriageClassifyInput): string {
	const attachments = Array.isArray(input.attachment_names) ? input.attachment_names.filter(Boolean) : [];
	const lines = [
		`From: ${clip(input.from, 300)}`,
		input.to ? `To: ${clip(input.to, 300)}` : null,
		input.date ? `Date: ${clip(input.date, 80)}` : null,
		`Subject: ${clip(input.subject, 500)}`,
		`Attachments: ${attachments.length ? attachments.map((a) => clip(a, 120)).join("; ") : input.has_attachments ? "(present, names unknown)" : "none"}`,
		"",
		"Body:",
		clip(input.body_excerpt, BODY_EXCERPT_MAX) || "(empty body)",
	].filter((l): l is string => l !== null);
	return lines.join("\n");
}

function conservative(reason: string, model: string, started: number): TriageClassifyResult {
	return {
		ok: true,
		classification: "review",
		rationale: `Routed to review automatically: ${reason}`,
		confidence: "low",
		model,
		elapsed_ms: Date.now() - started,
		failure: reason,
	};
}

export async function handleTriageClassify(
	input: TriageClassifyInput,
	env: { ANTHROPIC_API_KEY?: string },
): Promise<TriageClassifyResult> {
	if (!env.ANTHROPIC_API_KEY) {
		return { ok: false, status: 500, error: "server misconfigured: ANTHROPIC_API_KEY missing" };
	}
	if (!input || typeof input !== "object") {
		return { ok: false, status: 400, error: "request body must be a JSON object" };
	}
	const hasSignal = (input.subject && String(input.subject).trim()) || (input.body_excerpt && String(input.body_excerpt).trim());
	if (!hasSignal) {
		return { ok: false, status: 400, error: "at least one of 'subject' or 'body_excerpt' is required" };
	}
	const model = (input.model && String(input.model).trim()) || TRIAGE_MODEL;
	const started = Date.now();

	const llm = await callAnthropic({
		apiKey: env.ANTHROPIC_API_KEY,
		model,
		system: TRIAGE_SYSTEM_PROMPT,
		user: buildTriageUserMessage(input),
		maxTokens: 400,
		timeoutMs: TRIAGE_TIMEOUT_MS,
		outputSchema: TRIAGE_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
		effort: "low",
	});
	if (!llm.ok || !llm.text) {
		console.warn(`triage-classify upstream failure: ${llm.error ?? "no text"}`);
		return conservative(llm.error ? `model call failed (${llm.error.slice(0, 160)})` : "model returned no text", model, started);
	}
	let parsed: { classification?: string; rationale?: string; confidence?: string };
	try {
		parsed = JSON.parse(llm.text.trim());
	} catch {
		return conservative("model output was not valid JSON", model, started);
	}
	const cls = String(parsed.classification || "").toLowerCase();
	if (!(TRIAGE_CLASSES as readonly string[]).includes(cls)) {
		return conservative(`model returned unknown class "${cls.slice(0, 40)}"`, model, started);
	}
	const conf = ["high", "medium", "low"].includes(String(parsed.confidence)) ? (parsed.confidence as "high" | "medium" | "low") : "medium";
	return {
		ok: true,
		classification: cls as TriageClass,
		rationale: clip(parsed.rationale, 600) || "(no rationale given)",
		confidence: conf,
		model,
		elapsed_ms: Date.now() - started,
	};
}
