// Self-bootstrap B: Notion mirror DB lookup + on-demand creation.
//
// The Item-1 mirror writes (insight + RN) used to require Campbell to create
// two Notion DBs by hand and `wrangler secret put` their IDs. This module
// replaces that with lazy auto-creation:
//
//   1. getMirrorDbId(env, kind): D1 runtime_config lookup, env-secret-first.
//      Read-only — used by captures-today so opening the Captures tab
//      doesn't accidentally create DBs.
//   2. getOrCreateMirrorDbId(env, kind): same lookup, but creates the DB
//      under PROJECT_LOG on first miss, stores the ID in runtime_config.
//      Used by writeInsightMirror + writeRnMirror.
//
// Security envelope: reuses existing NOTION_TOKEN. Creation happens inside
// already-bearer-gated capture handlers, so only authenticated requests can
// trigger it. New DBs are parented under PROJECT_LOG (already shared with
// the integration). No new tokens, no new access scope. See discussion in
// the commit message that introduces this file.

// PROJECT_LOG page ID — already shared with NOTION_TOKEN integration (proven
// by the long-running /api/log-append flow). The two mirror DBs land as
// children here. Campbell can move them anywhere in his workspace after
// creation; Notion preserves the database_id across moves.
const PROJECT_LOG_PAGE_ID = "34548344-93df-81ed-972f-c524406eeb04";

export type MirrorKind = "insight" | "rn";

interface MirrorEnv {
	UC3_DB: D1Database;
	NOTION_TOKEN: string;
	INSIGHT_MIRROR_DB_ID?: string;
	RESEARCH_NOTE_MIRROR_DB_ID?: string;
}

const RUNTIME_KEY: Record<MirrorKind, string> = {
	insight: "insight_mirror_db_id",
	rn: "research_note_mirror_db_id",
};

const ENV_OVERRIDE: Record<MirrorKind, keyof MirrorEnv> = {
	insight: "INSIGHT_MIRROR_DB_ID",
	rn: "RESEARCH_NOTE_MIRROR_DB_ID",
};

// Schema for each mirror DB. Field names must match exactly what the
// writeInsightMirror / writeRnMirror helpers send. If a property type needs
// to change, bump this AND the writer in worker/src/index.ts together.
const MIRROR_SCHEMA: Record<MirrorKind, { title: string; properties: Record<string, unknown> }> = {
	insight: {
		title: "Insight Mirror",
		properties: {
			Title: { title: {} },
			Claim: { rich_text: {} },
			"Domain Primary": {
				select: {
					options: [
						{ name: "Policy" },
						{ name: "Economics" },
						{ name: "Technology" },
						{ name: "Cross-cutting" },
					],
				},
			},
			"Domain Secondary": {
				select: {
					options: [
						{ name: "Policy" },
						{ name: "Economics" },
						{ name: "Technology" },
						{ name: "Cross-cutting" },
					],
				},
			},
			"Claim Type": {
				select: {
					options: [
						{ name: "observation" },
						{ name: "hypothesis" },
						{ name: "synthesis" },
						{ name: "framing-shift" },
					],
				},
			},
			Confidence: {
				select: {
					options: [{ name: "low" }, { name: "medium" }, { name: "high" }],
				},
			},
			"Source Doc IDs": { rich_text: {} },
			"Query Context": { rich_text: {} },
		},
	},
	rn: {
		title: "Research Note Mirror",
		properties: {
			Title: { title: {} },
			"Research Question": { rich_text: {} },
			Reasoning: { rich_text: {} },
			Assessment: { rich_text: {} },
			"Cited Sources": { rich_text: {} },
			"Falsifiable Tests": { rich_text: {} },
			"Source Surface": {
				select: {
					options: [
						{ name: "Commute Player" },
						{ name: "Reading Workspace" },
						{ name: "Corpus Query" },
						{ name: "Create Product" },
						{ name: "CLI" },
					],
				},
			},
		},
	},
};

// Read-only: returns the DB ID if known (env override OR D1 runtime_config),
// or null. Never touches Notion. Use this from query/read paths.
export async function getMirrorDbId(env: MirrorEnv, kind: MirrorKind): Promise<string | null> {
	const overrideKey = ENV_OVERRIDE[kind];
	const fromEnv = (env as Record<string, string | undefined>)[overrideKey as string];
	if (fromEnv && fromEnv.trim()) return fromEnv.trim();
	try {
		const row = await env.UC3_DB
			.prepare("SELECT value FROM runtime_config WHERE key = ?")
			.bind(RUNTIME_KEY[kind])
			.first<{ value: string }>();
		return row?.value ?? null;
	} catch (_) {
		return null;
	}
}

// Lookup, or create under PROJECT_LOG on first miss and persist the ID.
// Used by write paths (writeInsightMirror, writeRnMirror) so the first
// capture self-bootstraps the mirror DB. Returns null only if NOTION_TOKEN
// is missing or the Notion create-database call fails.
export async function getOrCreateMirrorDbId(env: MirrorEnv, kind: MirrorKind): Promise<string | null> {
	if (!env.NOTION_TOKEN) return null;
	const existing = await getMirrorDbId(env, kind);
	if (existing) return existing;

	const schema = MIRROR_SCHEMA[kind];
	try {
		const resp = await fetch("https://api.notion.com/v1/databases", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.NOTION_TOKEN}`,
				"Notion-Version": "2022-06-28",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				parent: { type: "page_id", page_id: PROJECT_LOG_PAGE_ID },
				title: [{ type: "text", text: { content: schema.title } }],
				properties: schema.properties,
			}),
			signal: AbortSignal.timeout(15_000),
		});
		if (!resp.ok) {
			const body = (await resp.text()).slice(0, 500);
			console.warn(`mirror-bootstrap ${kind} create-database failed ${resp.status}: ${body}`);
			return null;
		}
		const json = (await resp.json()) as { id: string };
		const newDbId = json.id;

		// Persist. ON CONFLICT DO NOTHING means a concurrent caller that won
		// the race keeps their winning ID; this caller's create is orphaned
		// but harmless. Re-SELECT to return the canonical value either way.
		await env.UC3_DB
			.prepare(
				`INSERT INTO runtime_config (key, value, updated_at) VALUES (?, ?, ?)
				 ON CONFLICT(key) DO NOTHING`,
			)
			.bind(RUNTIME_KEY[kind], newDbId, Math.floor(Date.now() / 1000))
			.run();
		const final = await env.UC3_DB
			.prepare("SELECT value FROM runtime_config WHERE key = ?")
			.bind(RUNTIME_KEY[kind])
			.first<{ value: string }>();
		return final?.value ?? newDbId;
	} catch (err) {
		console.warn(`mirror-bootstrap ${kind} threw: ${(err as Error).message}`);
		return null;
	}
}
