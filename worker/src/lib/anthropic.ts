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

// F16 fix — streaming variant. Long Sonnet generations (>100s) hit Cloudflare's
// 524 gateway timeout when non-streaming because no bytes flow until completion.
// Streaming sends SSE chunks as the model generates, so the connection stays
// alive indefinitely. Assembles all text deltas into a single result matching
// callAnthropic's return shape.
async function doAnthropicStream(input: AnthropicCallInput): Promise<AnthropicCallResult> {
	const controller = new AbortController();
	// Long ceiling (15 min) — streaming sends data continuously; the only
	// time this fires is if the connection truly dies.
	const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 15 * 60_000);
	const reqBody: Record<string, unknown> = {
		model: input.model,
		max_tokens: Math.max(1, Math.min(input.maxTokens ?? DEFAULT_MAX_TOKENS, 8192)),
		messages: [{ role: "user", content: input.user }],
		stream: true,
	};
	if (input.system && input.system.trim()) reqBody.system = input.system;
	try {
		const resp = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"x-api-key": input.apiKey,
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
				"accept": "text/event-stream",
			},
			body: JSON.stringify(reqBody),
			signal: controller.signal,
		});
		if (!resp.ok) {
			const txt = await resp.text();
			return { ok: false, status: resp.status, error: `Anthropic ${resp.status}: ${txt.slice(0, 400)}` };
		}
		if (!resp.body) {
			return { ok: false, status: 502, error: "Anthropic streaming response had no body" };
		}
		// Parse SSE. Each event has "event: <name>\ndata: <json>\n\n"
		// We collect text_delta chunks + usage from message_start/message_delta.
		const reader = resp.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		const chunks: string[] = [];
		let usage: { input_tokens?: number; output_tokens?: number } = {};
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let blankIdx;
			while ((blankIdx = buffer.indexOf("\n\n")) >= 0) {
				const event = buffer.slice(0, blankIdx);
				buffer = buffer.slice(blankIdx + 2);
				const dataLine = event.split("\n").find((l) => l.startsWith("data: "));
				if (!dataLine) continue;
				try {
					const parsed = JSON.parse(dataLine.slice(6));
					if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
						chunks.push(parsed.delta.text || "");
					} else if (parsed.type === "message_delta" && parsed.usage) {
						usage = { ...usage, ...parsed.usage };
					} else if (parsed.type === "message_start" && parsed.message?.usage) {
						usage = { ...usage, ...parsed.message.usage };
					}
				} catch (_) { /* skip malformed events */ }
			}
		}
		return { ok: true, status: 200, text: chunks.join(""), usage };
	} catch (err) {
		const e = err as Error;
		if (e.name === "AbortError") {
			return { ok: false, status: 504, error: `Anthropic streaming aborted after ${(input.timeoutMs ?? 15 * 60_000) / 1000}s` };
		}
		return { ok: false, status: 502, error: `Anthropic streaming error: ${e.message}` };
	} finally {
		clearTimeout(timer);
	}
}

// F16 — streaming variant of callAnthropic. Use for long generations.
export async function callAnthropicStreaming(input: AnthropicCallInput): Promise<AnthropicCallResult> {
	const first = await doAnthropicStream(input);
	if (first.ok || !first.status || !RETRYABLE_STATUSES.has(first.status)) return first;
	await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
	const second = await doAnthropicStream(input);
	if (!second.ok && second.error) {
		second.error = `[stream retry after ${first.status}] ${second.error}`;
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
