// Item 2: Daily Briefing pipeline.
//
// Once per day (via cron), assemble a ~5-min audio digest of what changed
// across Campbell's three analytical domains (policy / economics / technology)
// in the last 24h. Sources: the Notion Ingestion Log (always cloud-available)
// + the Notion Insight Mirror if configured. Sonnet writes a synthesis script;
// ElevenLabs renders to MP3; both land in R2 with a row in daily_briefings.
//
// Pattern mirrors module-audio.ts:
//   - One D1 row per briefing (UNIQUE on briefing_date)
//   - Status flips generating → ready on success, generating → failed on error
//   - audio_r2_key + transcript_r2_key + audio_bytes for player consumption
//   - last_error populated on failure so the UI can surface it (F14 lesson)

import { callAnthropic, type AnthropicModel } from "./anthropic";
import { ttsChunkedToBuffer, ELEVENLABS_DEFAULT_MODEL } from "./tts";

// Notion DB ID for the ingestion log (each row is a single ingest attempt).
const INGESTION_LOG_DB_ID = "d7494f8b-3768-4ea0-b314-dbaf1a162f93";

const DEFAULT_VOICE_FALLBACK = "ErXwobaYiN019PkySvjV"; // Antoni
const SONNET_MODEL: AnthropicModel = "claude-sonnet-4-6";
const TARGET_MAX_TOKENS = 1500; // ~5-min script at 150 wpm ≈ 750 words ≈ 1000 tokens

export interface DailyBriefingEnv {
	UC3_DB: D1Database;
	TTS_CACHE: R2Bucket;
	ANTHROPIC_API_KEY: string;
	ELEVENLABS_API_KEY: string;
	ELEVENLABS_DEFAULT_VOICE_ID?: string;
	NOTION_TOKEN: string;
	INSIGHT_MIRROR_DB_ID?: string;
}

export interface DailyBriefingResult {
	ok: boolean;
	briefing_date: string;
	audio_r2_key?: string;
	audio_bytes?: number;
	transcript_r2_key?: string;
	voice_id?: string;
	source_summary?: { ingest_count: number; insight_count: number };
	error?: string;
}

function todayDateString(): string {
	// YYYY-MM-DD in UTC. The cron fires daily so a UTC day boundary is fine.
	const d = new Date();
	return d.toISOString().slice(0, 10);
}

function notionPlainTitle(prop: unknown): string {
	const p = prop as { title?: Array<{ plain_text?: string }>; rich_text?: Array<{ plain_text?: string }> } | null;
	if (!p) return "";
	const arr = p.title || p.rich_text || [];
	return arr.map((t) => t.plain_text || "").join("").trim();
}

function notionSelectName(prop: unknown): string {
	const p = prop as { select?: { name?: string } } | null;
	return p?.select?.name ?? "";
}

async function queryNotion(dbId: string, filter: any, notionToken: string, pageSize = 50): Promise<any[]> {
	const resp = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
		method: "POST",
		headers: { Authorization: `Bearer ${notionToken}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
		body: JSON.stringify({ page_size: pageSize, sorts: [{ timestamp: "created_time", direction: "descending" }], filter }),
		signal: AbortSignal.timeout(15_000),
	});
	if (!resp.ok) {
		console.warn(`daily-briefing notion query ${dbId} ${resp.status}:`, (await resp.text()).slice(0, 300));
		return [];
	}
	const json = (await resp.json()) as { results?: any[] };
	return json.results || [];
}

async function fetchRecentIngests(notionToken: string, sinceIso: string): Promise<Array<{ title: string; source: string; status: string }>> {
	const rows = await queryNotion(
		INGESTION_LOG_DB_ID,
		{ timestamp: "created_time", created_time: { on_or_after: sinceIso } },
		notionToken,
		50,
	);
	return rows
		.map((r) => {
			const props = r.properties || {};
			return {
				title: notionPlainTitle(props["Title"]) || notionPlainTitle(props["Name"]) || "(untitled)",
				source: notionSelectName(props["Source"]) || notionPlainTitle(props["Source"]) || "",
				status: notionSelectName(props["Status"]) || "",
			};
		})
		.filter((r) => r.title !== "(untitled)" || r.status); // drop completely empty rows
}

async function fetchRecentInsights(notionToken: string, mirrorDbId: string, sinceIso: string): Promise<Array<{ claim: string; domain: string; claim_type: string }>> {
	const rows = await queryNotion(
		mirrorDbId,
		{ timestamp: "created_time", created_time: { on_or_after: sinceIso } },
		notionToken,
		30,
	);
	return rows.map((r) => {
		const props = r.properties || {};
		return {
			claim: notionPlainTitle(props["Claim"]) || notionPlainTitle(props["Title"]) || "(empty)",
			domain: notionSelectName(props["Domain Primary"]) || "",
			claim_type: notionSelectName(props["Claim Type"]) || "observation",
		};
	});
}

function buildSynthesisPrompt(
	ingests: Array<{ title: string; source: string; status: string }>,
	insights: Array<{ claim: string; domain: string; claim_type: string }>,
): { system: string; user: string } {
	const system =
		"You are writing the morning audio briefing for Campbell, who works space security cooperation policy. " +
		"His analytical frame treats Space Security Cooperation outcomes as the product of an institutional welfare problem across three domains: policy, economics, and technology. " +
		"Voice: insightful colleague at the kitchen table, not breathless news anchor. Plain prose. No bullet points (this is audio). " +
		"Length target: 700-900 words (≈5 minutes spoken). Structure: open with the single most significant signal across the three domains; weave 2-3 specific items by analytical weight; close with one open question worth carrying into the day. " +
		"Never use jargon like 'SKR', 'Pinecone', 'pipeline', 'ingestion'. Speak about the substantive content, not the system. " +
		"If the input is sparse (zero or one items), write a short briefing acknowledging the light day rather than padding.";

	const ingestSection = ingests.length === 0
		? "No new material was ingested overnight."
		: ingests.slice(0, 30).map((i, n) => `${n + 1}. ${i.title}${i.source ? ` — ${i.source}` : ""}${i.status ? ` (${i.status})` : ""}`).join("\n");

	const insightSection = insights.length === 0
		? "No new insights captured this week."
		: insights.slice(0, 15).map((i, n) => `${n + 1}. [${i.claim_type}${i.domain ? `, ${i.domain}` : ""}] ${i.claim}`).join("\n");

	const user =
		`Today is ${new Date().toISOString().slice(0, 10)}.\n\n` +
		`=== NEW MATERIAL INGESTED IN THE LAST 24 HOURS ===\n${ingestSection}\n\n` +
		`=== RECENT INSIGHTS CAPTURED (last 7 days) ===\n${insightSection}\n\n` +
		"Write the briefing script. Output the script directly with no preamble, no headers, no closing remarks — just the spoken text.";

	return { system, user };
}

export async function generateDailyBriefing(env: DailyBriefingEnv): Promise<DailyBriefingResult> {
	const briefing_date = todayDateString();
	const nowS = Math.floor(Date.now() / 1000);
	const sinceIso = new Date(Date.now() - 86400 * 1000).toISOString();

	// 1. Upsert a row in 'generating' state. Idempotent: if today's briefing
	//    already exists in 'ready', return early to avoid double-billing.
	const existing = await env.UC3_DB
		.prepare("SELECT id, status, audio_r2_key, transcript_r2_key, audio_bytes, voice_id FROM daily_briefings WHERE briefing_date = ?")
		.bind(briefing_date)
		.first<{ id: number; status: string; audio_r2_key: string | null; transcript_r2_key: string | null; audio_bytes: number | null; voice_id: string | null }>();

	if (existing && existing.status === "ready" && existing.audio_r2_key) {
		return {
			ok: true,
			briefing_date,
			audio_r2_key: existing.audio_r2_key,
			audio_bytes: existing.audio_bytes ?? undefined,
			transcript_r2_key: existing.transcript_r2_key ?? undefined,
			voice_id: existing.voice_id ?? undefined,
		};
	}

	await env.UC3_DB
		.prepare(
			`INSERT INTO daily_briefings (briefing_date, generated_at, status)
			 VALUES (?, ?, 'generating')
			 ON CONFLICT(briefing_date) DO UPDATE SET generated_at = excluded.generated_at, status = 'generating', last_error = NULL`,
		)
		.bind(briefing_date, nowS)
		.run();

	const setFailed = async (err: string) => {
		await env.UC3_DB
			.prepare("UPDATE daily_briefings SET status = 'failed', last_error = ? WHERE briefing_date = ?")
			.bind(err.slice(0, 1000), briefing_date)
			.run()
			.catch(() => {});
	};

	try {
		// 2. Pull source material from Notion (cloud-only, no Mac dependency).
		const ingests = await fetchRecentIngests(env.NOTION_TOKEN, sinceIso);
		const sinceInsightsIso = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
		const insights = env.INSIGHT_MIRROR_DB_ID
			? await fetchRecentInsights(env.NOTION_TOKEN, env.INSIGHT_MIRROR_DB_ID, sinceInsightsIso)
			: [];

		// 3. Build the prompt + call Sonnet.
		const { system, user } = buildSynthesisPrompt(ingests, insights);
		const llm = await callAnthropic({
			apiKey: env.ANTHROPIC_API_KEY,
			model: SONNET_MODEL,
			system,
			user,
			maxTokens: TARGET_MAX_TOKENS,
		});
		if (!llm.ok || !llm.text) {
			const errText = `Sonnet synthesis failed: ${llm.error ?? "no text returned"}`;
			await setFailed(errText);
			return { ok: false, briefing_date, error: errText };
		}
		const script = llm.text.trim();
		if (script.length < 200) {
			const errText = `Synthesis output too short to render: ${script.length} chars`;
			await setFailed(errText);
			return { ok: false, briefing_date, error: errText };
		}

		// 4. TTS via ElevenLabs (chunked to handle ~5min payloads).
		const voice_id = env.ELEVENLABS_DEFAULT_VOICE_ID || DEFAULT_VOICE_FALLBACK;
		const tts = await ttsChunkedToBuffer(script, voice_id, ELEVENLABS_DEFAULT_MODEL, undefined, env.ELEVENLABS_API_KEY);
		if (!tts.ok) {
			const errText = `TTS failed: ${tts.error}`;
			await setFailed(errText);
			return { ok: false, briefing_date, error: errText };
		}

		// 5. Persist transcript + audio to R2.
		const transcript_r2_key = `daily-briefings/${briefing_date}.txt`;
		const audio_r2_key = `daily-briefings/${briefing_date}.mp3`;
		await env.TTS_CACHE.put(transcript_r2_key, script, { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
		await env.TTS_CACHE.put(audio_r2_key, tts.buf, { httpMetadata: { contentType: "audio/mpeg" } });

		const audio_bytes = tts.buf.byteLength;
		const source_summary = JSON.stringify({ ingest_count: ingests.length, insight_count: insights.length });

		// 6. Flip row to 'ready'.
		await env.UC3_DB
			.prepare(
				`UPDATE daily_briefings SET status = 'ready', transcript_r2_key = ?, audio_r2_key = ?, audio_bytes = ?, voice_id = ?, source_summary = ?, last_error = NULL
				 WHERE briefing_date = ?`,
			)
			.bind(transcript_r2_key, audio_r2_key, audio_bytes, voice_id, source_summary, briefing_date)
			.run();

		return {
			ok: true,
			briefing_date,
			audio_r2_key,
			audio_bytes,
			transcript_r2_key,
			voice_id,
			source_summary: { ingest_count: ingests.length, insight_count: insights.length },
		};
	} catch (err) {
		const errText = (err as Error).message;
		await setFailed(errText);
		return { ok: false, briefing_date, error: errText };
	}
}
