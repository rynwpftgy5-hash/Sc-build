// Shared Anthropic Messages API wrapper for §8.4a.21 pipeline stages.
// Mirrors the existing handleChat pattern in src/index.ts:1045.

export type AnthropicModel =
	| "claude-opus-4-7"
	| "claude-sonnet-4-6"
	| "claude-sonnet-4-5"
	| "claude-haiku-4-5-20251001";

export interface AnthropicCallInput {
	apiKey: string;
	model: AnthropicModel | string;
	system?: string;
	user: string;
	maxTokens?: number;
	timeoutMs?: number;
}

export interface AnthropicCallResult {
	ok: boolean;
	status?: number;
	text?: string;
	usage?: { input_tokens?: number; output_tokens?: number };
	raw?: unknown;
	error?: string;
}

// 120s default: §8.4a.21 W4 dry-run showed Sonnet 4.6 generating a 4096-token
// structured JSON outline (S4) routinely takes 60-90s under load. 120s gives
// headroom without blocking Workflow step timeout (10 min) needlessly.
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TOKENS = 4096;

// HTTP statuses worth retrying once with a short backoff. 524 is Cloudflare's
// upstream timeout (observed empirically on W5 dry-run #16 — 3 of 5 revision
// calls hit it intermittently). 429/502/503 are standard transient errors.
const RETRYABLE_STATUSES = new Set([429, 502, 503, 524]);
const RETRY_BACKOFF_MS = 5_000;

async function doAnthropicFetch(input: AnthropicCallInput): Promise<AnthropicCallResult> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	const reqBody: Record<string, unknown> = {
		model: input.model,
		max_tokens: Math.max(1, Math.min(input.maxTokens ?? DEFAULT_MAX_TOKENS, 8192)),
		messages: [{ role: "user", content: input.user }],
	};
	if (input.system && input.system.trim()) reqBody.system = input.system;
	try {
		const resp = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"x-api-key": input.apiKey,
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
			},
			body: JSON.stringify(reqBody),
			signal: controller.signal,
		});
		if (!resp.ok) {
			const txt = await resp.text();
			return { ok: false, status: resp.status, error: `Anthropic ${resp.status}: ${txt.slice(0, 400)}` };
		}
		const json = (await resp.json()) as {
			content?: Array<{ type: string; text?: string }>;
			usage?: { input_tokens?: number; output_tokens?: number };
		};
		const text = (json.content || [])
			.filter((c) => c.type === "text")
			.map((c) => c.text || "")
			.join("");
		return { ok: true, status: 200, text, usage: json.usage, raw: json };
	} catch (err) {
		const e = err as Error;
		if (e.name === "AbortError") {
			return { ok: false, status: 504, error: `Anthropic call aborted after ${input.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms` };
		}
		return { ok: false, status: 502, error: `Anthropic fetch error: ${e.message}` };
	} finally {
		clearTimeout(timer);
	}
}

export async function callAnthropic(input: AnthropicCallInput): Promise<AnthropicCallResult> {
	const first = await doAnthropicFetch(input);
	if (first.ok || !first.status || !RETRYABLE_STATUSES.has(first.status)) return first;
	// Retry once with backoff on transient upstream errors.
	await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
	const second = await doAnthropicFetch(input);
	if (!second.ok && second.error) {
		second.error = `[retry after ${first.status}] ${second.error}`;
	}
	return second;
}

export function extractJson<T = unknown>(text: string): T | null {
	const trimmed = text.trim();
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	const slab = trimmed.slice(start, end + 1);
	try {
		return JSON.parse(slab) as T;
	} catch {
		return null;
	}
}

export async function sha256Hex(input: string): Promise<string> {
	const buf = new TextEncoder().encode(input);
	const hash = await crypto.subtle.digest("SHA-256", buf);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
