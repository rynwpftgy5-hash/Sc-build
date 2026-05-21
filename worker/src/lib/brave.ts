// Brave Search API wrapper for §8.4a.21 S2 source discovery.
// Free Pro plan: 1M queries/mo. Endpoint: https://api.search.brave.com/res/v1/web/search

export interface BraveSearchInput {
	apiKey: string;
	query: string;
	count?: number;
	freshness?: "pd" | "pw" | "pm" | "py";
	timeoutMs?: number;
}

export interface BraveResult {
	url: string;
	title: string;
	description: string;
	age?: string;
}

export interface BraveSearchResult {
	ok: boolean;
	status?: number;
	results?: BraveResult[];
	error?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function searchBrave(input: BraveSearchInput): Promise<BraveSearchResult> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	const url = new URL("https://api.search.brave.com/res/v1/web/search");
	url.searchParams.set("q", input.query);
	url.searchParams.set("count", String(input.count ?? 10));
	if (input.freshness) url.searchParams.set("freshness", input.freshness);
	try {
		const resp = await fetch(url.toString(), {
			method: "GET",
			headers: {
				"X-Subscription-Token": input.apiKey,
				Accept: "application/json",
			},
			signal: controller.signal,
		});
		if (!resp.ok) {
			const txt = await resp.text();
			return { ok: false, status: resp.status, error: `Brave ${resp.status}: ${txt.slice(0, 300)}` };
		}
		const json = (await resp.json()) as {
			web?: { results?: Array<{ url: string; title: string; description: string; age?: string }> };
		};
		const results: BraveResult[] = (json.web?.results || []).map((r) => ({
			url: r.url,
			title: r.title,
			description: r.description,
			age: r.age,
		}));
		return { ok: true, status: 200, results };
	} catch (err) {
		const e = err as Error;
		if (e.name === "AbortError") {
			return { ok: false, status: 504, error: `Brave search aborted after ${input.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms` };
		}
		return { ok: false, status: 502, error: `Brave fetch error: ${e.message}` };
	} finally {
		clearTimeout(timer);
	}
}

export function filterDenyList(results: BraveResult[], patterns: string[]): BraveResult[] {
	if (!patterns || patterns.length === 0) return results;
	return results.filter((r) => {
		const u = r.url.toLowerCase();
		return !patterns.some((p) => u.includes(p.toLowerCase()));
	});
}
