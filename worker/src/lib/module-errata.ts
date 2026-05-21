// §8.4a.21 W8 — Module Errata: in-flight claim flags during playback.
//
// D1 is source of truth; Notion is best-effort mirror. If MODULE_ERRATA_DB_ID
// env is unset OR Notion write fails, we still return ok=true with notion_page_id=null.
//
// The Notion DB schema (Campbell creates manually):
//   Title (title) | Module ID (number) | Claim ID (number) | Timestamp (s) (number)
//   Notes (rich_text) | Status (select: open/investigating/resolved)
//   Module Audio URL (url)

import { logVerification } from "./d1-uc3";

export interface ModuleErrataEnv {
	UC3_DB: D1Database;
	NOTION_TOKEN: string;
	MODULE_ERRATA_DB_ID?: string;
}

export interface CreateErrataInput {
	module_id: number;
	claim_id?: number | null;
	timestamp_seconds?: number | null;
	notes: string;
}

export interface CreateErrataResult {
	ok: boolean;
	errata_id?: number;
	notion_page_id?: string | null;
	module_audio_url?: string;
	error?: string;
}

const WORKER_BASE = "https://spacesc-mcp.75xnd2784n.workers.dev";

function buildModuleAudioUrl(module_id: number): string {
	return `${WORKER_BASE}/api/uc3/module-audio?module_id=${module_id}`;
}

function buildTitle(notes: string, module_id: number): string {
	const excerpt = notes.replace(/\s+/g, " ").trim().slice(0, 80);
	return `Mod ${module_id}: ${excerpt}${notes.length > 80 ? "…" : ""}`;
}

export async function createErrata(env: ModuleErrataEnv, input: CreateErrataInput): Promise<CreateErrataResult> {
	const now = Math.floor(Date.now() / 1000);
	const notes = input.notes.trim();
	if (!notes) return { ok: false, error: "notes is required" };

	// 1. D1 insert (blocking — D1 is source of truth)
	let errata_id: number;
	try {
		const r = await env.UC3_DB
			.prepare(
				`INSERT INTO module_errata (module_id, claim_id, timestamp_seconds, notes, status, created_at)
				 VALUES (?, ?, ?, ?, 'open', ?)`,
			)
			.bind(input.module_id, input.claim_id ?? null, input.timestamp_seconds ?? null, notes, now)
			.run();
		errata_id = Number((r.meta as { last_row_id?: number }).last_row_id);
	} catch (err) {
		const msg = (err as Error).message;
		await logVerification(env.UC3_DB, { module_id: input.module_id, stage: "S12-errata-insert", ok: false, error_text: msg });
		return { ok: false, error: `D1 insert failed: ${msg}` };
	}

	const module_audio_url = buildModuleAudioUrl(input.module_id);

	// 2. Notion mirror — best-effort.
	let notion_page_id: string | null = null;
	if (env.MODULE_ERRATA_DB_ID && env.NOTION_TOKEN) {
		const properties: Record<string, unknown> = {
			Title: { title: [{ type: "text", text: { content: buildTitle(notes, input.module_id) } }] },
			"Module ID": { number: input.module_id },
			Notes: { rich_text: [{ type: "text", text: { content: notes.slice(0, 2000) } }] },
			Status: { select: { name: "open" } },
			"Module Audio URL": { url: module_audio_url },
		};
		if (input.claim_id != null) properties["Claim ID"] = { number: input.claim_id };
		if (input.timestamp_seconds != null) properties["Timestamp (s)"] = { number: input.timestamp_seconds };

		try {
			const resp = await fetch("https://api.notion.com/v1/pages", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${env.NOTION_TOKEN}`,
					"Notion-Version": "2022-06-28",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					parent: { database_id: env.MODULE_ERRATA_DB_ID },
					properties,
				}),
				signal: AbortSignal.timeout(15_000),
			});
			if (resp.ok) {
				const json = (await resp.json()) as { id?: string };
				notion_page_id = json.id ?? null;
				if (notion_page_id) {
					await env.UC3_DB
						.prepare("UPDATE module_errata SET notion_page_id = ? WHERE id = ?")
						.bind(notion_page_id, errata_id)
						.run();
				}
			} else {
				const txt = (await resp.text()).slice(0, 500);
				await logVerification(env.UC3_DB, {
					module_id: input.module_id,
					stage: "S12-errata-notion",
					ok: false,
					error_text: `Notion ${resp.status}: ${txt}`,
				});
			}
		} catch (err) {
			await logVerification(env.UC3_DB, {
				module_id: input.module_id,
				stage: "S12-errata-notion",
				ok: false,
				error_text: `Notion fetch error: ${(err as Error).message}`,
			});
		}
	}

	await logVerification(env.UC3_DB, {
		module_id: input.module_id,
		stage: "S12-errata-insert",
		response_json: JSON.stringify({ errata_id, notion_page_id, has_notion_db: !!env.MODULE_ERRATA_DB_ID }),
		ok: true,
	});

	return { ok: true, errata_id, notion_page_id, module_audio_url };
}

export interface ErrataRow {
	id: number;
	module_id: number;
	claim_id: number | null;
	timestamp_seconds: number | null;
	audio_context_url: string | null;
	notes: string;
	status: string;
	notion_page_id: string | null;
	created_at: number;
	resolved_at: number | null;
}

export async function listErrata(
	db: D1Database,
	filter: { module_id?: number; status?: string },
): Promise<ErrataRow[]> {
	const clauses: string[] = [];
	const binds: Array<string | number> = [];
	if (filter.module_id != null) {
		clauses.push("module_id = ?");
		binds.push(filter.module_id);
	}
	if (filter.status) {
		clauses.push("status = ?");
		binds.push(filter.status);
	}
	const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
	const r = await db
		.prepare(`SELECT * FROM module_errata ${where} ORDER BY created_at DESC`)
		.bind(...binds)
		.all<ErrataRow>();
	return r.results ?? [];
}

export async function countErrataByModule(db: D1Database, module_id: number): Promise<number> {
	const r = await db
		.prepare("SELECT COUNT(*) AS n FROM module_errata WHERE module_id = ?")
		.bind(module_id)
		.first<{ n: number }>();
	return r?.n ?? 0;
}
