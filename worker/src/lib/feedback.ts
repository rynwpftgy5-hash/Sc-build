// §8.4a.25 — UI feedback capture (universal 🚩 button).
//
// D1 ui_feedback is source of truth. Notion mirror is best-effort. The
// `surface` field is the route path the user was on when they hit 🚩 — that
// plus view_state_json lets Claude Code reproduce context without Campbell
// having to translate "where I saw it" later.
//
// Adversarial pass (analyzeBlindspot) is fired separately by the route layer
// so this lib stays single-purpose.

import { FEEDBACK_TYPES } from "./feedback-types";

export interface FeedbackEnv {
	UC3_DB: D1Database;
	NOTION_TOKEN: string;
	FEEDBACK_DB_ID?: string;
	TTS_CACHE?: R2Bucket;
}

export interface CreateFeedbackInput {
	surface: string;
	view_state_json?: Record<string, unknown> | string;
	type: "bug" | "confusion" | "feature" | "question";
	notes_text?: string;
	voice_transcript?: string;
	audio_r2_key?: string;
	user_agent?: string;
	captured_at?: number; // optional client-supplied, clamped server-side
}

export interface CreateFeedbackResult {
	ok: boolean;
	feedback_id?: number;
	notion_page_id?: string | null;
	error?: string;
}

export interface FeedbackRow {
	id: number;
	surface: string;
	view_state_json: string | null;
	type: string;
	notes_text: string | null;
	voice_transcript: string | null;
	audio_r2_key: string | null;
	user_agent: string | null;
	captured_at: number;
	status: string;
	resolution_note: string | null;
	resolved_at: number | null;
	notion_page_id: string | null;
	claude_session_ref: string | null;
}

function titleFromFeedback(input: CreateFeedbackInput): string {
	const body = (input.notes_text ?? input.voice_transcript ?? "").trim();
	const excerpt = body.replace(/\s+/g, " ").slice(0, 70);
	const typeEmoji = ({ bug: "🐛", confusion: "🤔", feature: "✨", question: "❓" } as const)[input.type];
	return `${typeEmoji} ${input.surface} · ${excerpt}${body.length > 70 ? "…" : ""}`;
}

export async function createFeedback(env: FeedbackEnv, input: CreateFeedbackInput): Promise<CreateFeedbackResult> {
	if (!FEEDBACK_TYPES.includes(input.type)) {
		return { ok: false, error: `invalid type '${input.type}' (must be one of ${FEEDBACK_TYPES.join(", ")})` };
	}
	if (!input.surface) {
		return { ok: false, error: "surface is required (e.g. '/uc3', '/desk')" };
	}
	const notes = (input.notes_text ?? input.voice_transcript ?? "").trim();
	if (!notes) {
		return { ok: false, error: "either notes_text or voice_transcript must be non-empty" };
	}

	const now = Math.floor(Date.now() / 1000);
	const captured_at = clampTimestamp(input.captured_at, now);
	const view_state_str = typeof input.view_state_json === "string"
		? input.view_state_json
		: JSON.stringify(input.view_state_json ?? {});

	// 1. D1 insert (blocking).
	let feedback_id: number;
	try {
		const r = await env.UC3_DB
			.prepare(
				`INSERT INTO ui_feedback (surface, view_state_json, type, notes_text, voice_transcript, audio_r2_key, user_agent, captured_at, status)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
			)
			.bind(
				input.surface,
				view_state_str,
				input.type,
				input.notes_text ?? null,
				input.voice_transcript ?? null,
				input.audio_r2_key ?? null,
				input.user_agent ?? null,
				captured_at,
			)
			.run();
		feedback_id = Number((r.meta as { last_row_id?: number }).last_row_id);
	} catch (err) {
		return { ok: false, error: `D1 insert failed: ${(err as Error).message}` };
	}

	// 2. Notion mirror — best-effort. Same shape as module_errata.
	let notion_page_id: string | null = null;
	if (env.FEEDBACK_DB_ID && env.NOTION_TOKEN) {
		const properties: Record<string, unknown> = {
			Title: { title: [{ type: "text", text: { content: titleFromFeedback(input) } }] },
			Surface: { rich_text: [{ type: "text", text: { content: input.surface } }] },
			Type: { select: { name: input.type } },
			Notes: { rich_text: [{ type: "text", text: { content: notes.slice(0, 2000) } }] },
			Status: { select: { name: "open" } },
			"View state": { rich_text: [{ type: "text", text: { content: view_state_str.slice(0, 2000) } }] },
		};
		try {
			const resp = await fetch("https://api.notion.com/v1/pages", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${env.NOTION_TOKEN}`,
					"Notion-Version": "2022-06-28",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ parent: { database_id: env.FEEDBACK_DB_ID }, properties }),
				signal: AbortSignal.timeout(15_000),
			});
			if (resp.ok) {
				const json = (await resp.json()) as { id?: string };
				notion_page_id = json.id ?? null;
				if (notion_page_id) {
					await env.UC3_DB
						.prepare("UPDATE ui_feedback SET notion_page_id = ? WHERE id = ?")
						.bind(notion_page_id, feedback_id)
						.run();
				}
			} else {
				const txt = (await resp.text()).slice(0, 500);
				console.error(`feedback notion mirror failed: ${resp.status} ${txt}`);
			}
		} catch (err) {
			console.error(`feedback notion mirror error: ${(err as Error).message}`);
		}
	}

	return { ok: true, feedback_id, notion_page_id };
}

function clampTimestamp(client_ts: number | undefined, server_now: number): number {
	if (!client_ts || !Number.isFinite(client_ts)) return server_now;
	// Allow up to 24h skew either direction; otherwise trust server.
	if (Math.abs(client_ts - server_now) > 86400) return server_now;
	return client_ts;
}

export async function listFeedback(
	db: D1Database,
	filter: { status?: string; surface?: string; type?: string; limit?: number },
): Promise<FeedbackRow[]> {
	const clauses: string[] = [];
	const binds: Array<string | number> = [];
	if (filter.status) { clauses.push("status = ?"); binds.push(filter.status); }
	if (filter.surface) { clauses.push("surface = ?"); binds.push(filter.surface); }
	if (filter.type) { clauses.push("type = ?"); binds.push(filter.type); }
	const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
	const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
	const r = await db
		.prepare(`SELECT * FROM ui_feedback ${where} ORDER BY captured_at DESC LIMIT ?`)
		.bind(...binds, limit)
		.all<FeedbackRow>();
	return r.results ?? [];
}

export async function resolveFeedback(
	db: D1Database,
	id: number,
	status: "in_progress" | "resolved" | "wontfix",
	resolution_note?: string,
): Promise<{ ok: boolean; error?: string }> {
	const now = Math.floor(Date.now() / 1000);
	try {
		await db
			.prepare(
				`UPDATE ui_feedback SET status = ?, resolution_note = ?, resolved_at = ? WHERE id = ?`,
			)
			.bind(status, resolution_note ?? null, status === "in_progress" ? null : now, id)
			.run();
		return { ok: true };
	} catch (err) {
		return { ok: false, error: (err as Error).message };
	}
}
