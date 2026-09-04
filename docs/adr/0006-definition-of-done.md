# 0006. Evidence-based Definition of Done

- **Status:** ACCEPTED
- **Date:** 2026-05-19
- **Supersedes:** none
- **Superseded by:** none
- **Tags:** workflow, quality, governance, single-principal

## Context

SpaceSC is a single-principal workbench: there is no team of QA testers, no
second engineer to catch regressions, no product owner to write acceptance
criteria. When an agent reports work complete, Campbell is the only loop
member who can verify the claim. Empirically, agents have been treating
Campbell as their post-implementation QA layer — declaring work "done" the
moment the code compiles, then deferring discovery of broken behavior to the
next time Campbell touches the surface. This inverts the intended division
of labor: Campbell defines outcomes and adjudicates them; agents implement
and verify.

The cost of this inversion is concrete and recurring. Campbell spends review
time on defects that the implementing agent could have caught with a few
additional minutes of testing, and the quality of the human review surface
itself degrades — it is harder to spot subtle design issues when the obvious
ones are still being filtered out.

The patterns this ADR adopts are not new to the field. The
happy-path / sad-path distinction, the charters and tours of exploratory
testing (Whittaker, Bach), Bolton's FEW HICCUPPS oracles, evidence-based
completion ("show the receipt"), and adversarial review under separation of
implementer and reviewer roles are all established discipline outside
SpaceSC. The decision here is to adopt their combined form as the project's
default completion gate.

## Decision

SpaceSC adopts an **Evidence-Based Completion Receipt** as the mandatory
artifact an agent must produce before declaring any non-trivial task
complete. The receipt is enforced by a Claude Code `Stop` hook (see
implementation notes) so it cannot be skipped silently.

### What counts as non-trivial

A task is **non-trivial** — and therefore requires a receipt — whenever the
agent has done any of the following in the session:

- Modified any file under version control.
- Run a shell command that changed state (writes, deploys, migrations, MCP
  writes).
- Invoked a tool whose effect persists outside the conversation (Notion
  write, GitHub action, D1 / R2 / Pinecone write).
- Authored a recommendation that Campbell is expected to act on.

A task is **trivial** — and the receipt is waived, but its absence must be
stated explicitly — when the session was read-only (research, clarification,
conversation, file reading only). The triviality claim itself is auditable.

### The completion receipt template

Every non-trivial turn ends with a receipt in this shape:

```
## Completion receipt — <one-line task title>

**Customer end state (restated, testable form):**
<One to three sentences. What does success look like from Campbell's seat?>

**Acceptance criteria, each judged with evidence:**
- [ ] AC1: <criterion>
      → ✓ / ✗
      → Evidence: <command + pasted output | file:line | screenshot path | log excerpt>
- [ ] AC2: ...

**Adversarial review (mandatory for changes touching code, prompts, or
external state):**
<Summary of findings from a separately-invoked reviewer agent or a
self-critique pass under an opposing persona. Include the reviewer's
verdict and any blocking issues.>

**What was NOT tested, and why:**
<List. "I did not test on iPhone because no device access in this session"
is a valid entry; silence is not.>

**Top three ways this is likely still broken:**
1. ...
2. ...
3. ...
For each, state whether it was checked and how.

**Self-grade (0–10) on confidence this delivers the stated end state:**
N — because <brief reason>. If below 8, do not declare done; continue.
```

### Adversarial review

For any change that touches Worker code, prompts, ADRs, or external state
(Notion / D1 / R2 / Pinecone), the agent must produce an adversarial review
before the receipt. Two valid forms:

1. **Subagent review.** Spawn a fresh agent (`Agent` tool, typically
   `general-purpose` or a dedicated `code-reviewer` agent) with only the
   acceptance criteria and the diff — not the implementer's narrative.
   Report the subagent's verdict in the receipt.
2. **Self-critique under opposing persona.** When subagent spawn is
   unavailable, the same agent re-reads the change in the explicit role of
   a hostile reviewer ("you are reviewing this PR with the goal of finding
   the most damaging defect"). The critique must be visible in the receipt,
   not summarized away.

Form 1 is preferred. Form 2 is the fallback.

### Enforcement layers

The receipt is enforced by four layers, in increasing order of teeth:

1. **CLAUDE.md instruction** referencing this ADR (orientation; can drift
   under context pressure).
2. **Stop hook** in `.claude/settings.json` that injects a system reminder
   at every turn-end requiring the receipt or an explicit triviality
   declaration (harness-enforced; the model cannot opt out).
3. **GitHub Action** on `pull_request: opened` that runs an independent
   review pass before merge (external CI gate, follow-up workstream).
4. **Campbell's review.** When all three above pass, the human review
   surface is narrow enough to be tractable.

## Consequences

**Easier:**

- Campbell stops being the first QA loop. Agents own verification of their
  own work and produce auditable evidence of having done so.
- Defects that would have surfaced during Campbell's review surface during
  the agent's self-review instead, shortening the round trip.
- The receipt becomes a reusable artifact: it can be pasted into
  PROJECT_LOG entries, PR descriptions, and ADR provenance footers.
- New agents joining a session inherit the discipline automatically via
  CLAUDE.md + the Stop hook, with no per-session reminder from Campbell.

**Harder:**

- Trivial tasks gain a sentence of overhead (the triviality declaration).
  Acceptable.
- Adversarial review adds latency, especially when delegating to a subagent.
  Acceptable for changes that touch persistent state; over-applied to
  conversational replies it would be wasteful — hence the trivial /
  non-trivial distinction.
- The Stop hook injects an extra system reminder into every turn. If the
  reminder phrasing is wrong it will produce false-positive ceremony.
  Reviewable and tunable as one config line.

**New obligations:**

- The hook command and its phrasing become part of the project's surface
  area. Future ADRs that change completion expectations must update the
  hook script in the same PR.
- OPS_PLAYBOOK gains a section documenting the receipt format and the
  triviality shortcut so Campbell can adjudicate edge cases consistently
  across sessions.

## Implementation notes

- **Hook installation:** `.claude/settings.json` registers a `Stop` hook
  that runs `.claude/hooks/stop-reminder.sh`. The script echoes the
  reminder text; the harness pipes that text into the next turn as a
  system reminder. The hook is reminder-only (exit 0); it does not block
  the turn from ending.
- **Receipt placement:** at the end of the agent's last assistant message
  in the turn, after any concluding prose. The receipt is the last thing
  Campbell sees before adjudicating.
- **Triviality declaration shortcut:** one line, e.g. *"Trivial — read-only
  session, no state changed, no recommendation requiring action."*
- **Subagent review template:** see OPS_PLAYBOOK §<TBD by librarian> for
  the standing prompt the implementer hands to the reviewer subagent.

## Open questions

- Whether to extend the receipt requirement to skills (which run as
  side-channel agents with their own state). Defer to first incident.
- Whether the Stop hook should *block* the turn (exit non-zero) for
  high-blast-radius operations (Worker deploy, Notion bulk write, D1
  migration) rather than only injecting a reminder. Start with
  reminder-only; tighten if discipline slips.
- Whether the GitHub Action review pass (layer 3) is best implemented as
  an `@claude` workflow trigger or as a dedicated reviewer agent. Decide
  in the follow-up dispatch that lands the CI gate.

---

*Provenance: authored fresh on 2026-05-19 in response to a recurring
agent-as-implementer / Campbell-as-QA inversion. Not migrated from a
§8.4a.\* dispatch; falls in the 0001–0020 foundational range per
`docs/adr/README.md`.*
