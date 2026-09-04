# SpaceSC

SpaceSC is a single-user analytical workbench for space security cooperation —
a custom RAG environment that combines Cloudflare Workers, Pinecone, Notion,
and ElevenLabs to support a welfare-theorem analytical layer applied to the
intersection of policy, economics, and technology in space security cooperation.

## Stack

- **Cloudflare Workers** — always-on cloud substrate (MCP servers, webhooks, RAG orchestration)
- **n8n** — workflow automation and ingestion pipelines
- **Pinecone** — vector store for source documents (Tier 1)
- **Notion** — long-form notebook, ops playbook, and pedagogical surface
- **ElevenLabs** — voice synthesis for audio artifacts
- **SQLite / D1** — insight ledger and research notes (Tiers 2 and 3)

## Project structure

- `worker/` — Cloudflare Worker source (MCP server, REST API, hosted surfaces, D1 migrations)
- `.claude/skills/` — skills index; the skills run from `~/.claude/skills/` on the maintainer's Mac
- `docs/` — architecture documentation and system surveys (`docs/surveys/`)
- `docs/adr/` — Architecture Decision Records

## Orientation

- See `CLAUDE.md` for agent orientation.
- See `docs/` for architecture and decisions.
