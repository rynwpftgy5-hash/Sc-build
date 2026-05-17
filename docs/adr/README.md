# Architecture Decision Records (ADRs)

This directory holds **immutable** Architecture Decision Records — one
decision per file, named `NNNN-short-slug.md`, never edited in place
once accepted. New decisions that overturn an old one supersede it by
reference rather than rewriting history.

## Why this pattern

ADRs capture *why* a thing is the way it is at the moment the decision
was made. They are deliberately small (one decision, one file, one
page or two of prose), so the record stays accurate even years later
when memory has faded. The pattern was introduced by Michael Nygard in
his 2011 essay [*Documenting Architecture Decisions*][nygard] and
codified for the wider community by Martin Fowler's
[Architecture Decision Record bliki entry][fowler].

In SpaceSC, ADRs serve as the durable archive of the §8.4a.* dispatch
series. Each numbered dispatch issued during design becomes exactly one
ADR here. Run-state and narrative live in Notion (`PROJECT_LOG`); the
*decisions* themselves live in this directory so they survive
notebook reorganisations.

## Conventions

- **One file per decision.** Filename `NNNN-short-slug.md` where `NNNN`
  is zero-padded and matches the §8.4a.* dispatch number when the ADR
  migrates a dispatch (e.g. §8.4a.21 → `0021-uc3-fundamentals-learning.md`).
- **Immutable.** Once an ADR is `ACCEPTED`, do not edit its body. Fix
  typos and links only. To change a decision, write a new ADR and set
  `Supersedes:` on the new one and `Superseded by:` on the old one.
- **MADR-style frontmatter.** Status / Context / Decision / Consequences /
  Supersedes / Superseded by / Provenance. See `0000-template.md`.
- **Status values:** `PROPOSED` · `ACCEPTED` · `SUPERSEDED` · `DEPRECATED` ·
  `REJECTED`.
- **Provenance line.** ADRs migrated from Notion dispatches end with a
  one-line provenance footer noting source page and migration date.

## Numbering

- `0000-template.md` — the template (not a real decision).
- `0001`–`0020` — reserved for pre-§8.4a foundational decisions if
  migrated retroactively.
- `0021`+ — §8.4a.* dispatches migrated in dispatch-number order.

When in doubt about whether something deserves an ADR, ask: *will a
future agent or human need to know why this was decided this way, six
months from now, with no memory of the conversation?* If yes, write the
ADR.

## Further reading

- Michael Nygard, [*Documenting Architecture Decisions*][nygard] (2011)
- Martin Fowler, [*Architecture Decision Record*][fowler] (bliki)
- [MADR — Markdown Architecture Decision Records][madr] (the format
  this directory follows)

[nygard]: https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
[fowler]: https://martinfowler.com/bliki/ArchitectureDecisionRecord.html
[madr]: https://adr.github.io/madr/
