# SpaceSC Claude Code Skills

This directory hosts Claude Code **skills** for SpaceSC. A skill is a
small, named, reusable capability that the agent loads on demand — the
SpaceSC equivalents of `il add`, `rn add`, `ml add`, and similar
per-tier ergonomics.

Skills live in this repo (rather than only in `~/.claude/skills/` on
the Mac) so they version with the rest of the system and can be
distributed across sessions and machines.

## Folder convention

Each skill is one folder:

```
.claude/skills/<skill-slug>/
├── SKILL.md          ← required. Frontmatter + body describing the skill.
├── scripts/          ← optional. Executable helpers invoked by the skill.
├── references/       ← optional. Static reference material the skill loads.
└── assets/           ← optional. Templates, prompts, or other artifacts.
```

- **`SKILL.md`** is the only required file. It carries the skill name,
  one-sentence description, trigger conditions, and the body of
  instructions the agent reads when invoking the skill.
- **`scripts/`** holds executables (Python, shell, etc.) the skill
  shells out to. Keep them small and single-purpose.
- **`references/`** holds static material the skill loads into context
  on demand — schemas, glossaries, rubric prompts, etc.
- **`assets/`** holds templates and artifacts the skill produces or
  consumes (audio scripts, JSON templates, etc.).

## Forthcoming skills

These are sketched in `docs/adr/` and `OPS_PLAYBOOK` but not yet
present in this repo. They will land when pushed from the Mac:

- **`spacesc-insight-ledger/`** — T2 insight-ledger curation (`il add`,
  `il dictate`, search). Currently lives on the Mac il-server; will
  migrate per ADR-0021's §8.4a.22 sketch.
- **`spacesc-research-notes/`** — T3 research-notes management
  (`rn add`, synthesis, retrieval). Same migration path as above.
- **`spacesc-learning-modules/`** — T4 pedagogical artifacts
  (`ml add`, learning-gap capture). See ADR-0021 for the full build
  spec.
- **`bulk-loader/`** — T1 ingestion into Pinecone + Notion SKR.
- **`reconciliation/`** — cross-tier reconciliation utilities.

## Conventions

- **One responsibility per skill.** If two capabilities can be invoked
  independently, they are two skills.
- **Skills do not modify each other's state directly.** Cross-skill
  effects go through the canonical tier surfaces (Pinecone, D1,
  Notion, R2) so the tier model stays clean.
- **Skills are versioned with the repo.** Treat `SKILL.md` like any
  other source file — review changes in PRs, do not edit in place
  after they have been used in production sessions without bumping
  whatever version surface the skill exposes.
- **Secrets never live in skill folders.** Skills read from
  environment variables, Worker secrets, or `.dev.vars` (which is
  `.gitignore`d). See the repo `.gitignore` for the full pattern list.

See `CLAUDE.md` at the repo root for broader agent orientation.
