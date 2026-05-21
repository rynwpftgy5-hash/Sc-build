# 0024. UI build discipline

- **Status:** ACCEPTED
- **Date:** 2026-05-19
- **Supersedes:** none
- **Superseded by:** none
- **Tags:** ui, ux, operating-principles, build-discipline, agent-protocol

## Context

Over a single 2026-05-18 session, six iterations of the UC3 Commute Player
shipped with regressions, missing features, and dead-end UI buttons. The
root causes were not technical — they were *thinking* failures. The agent
defaulted to whatever workstream was hot in recent context, treated the
user as a debug partner instead of the customer, asked clarifying questions
that the agent's own files already answered, and surfaced bug lists for the
user to triage instead of fixing them before ship.

Each failure cost Campbell a context switch, a complaint, a re-explanation,
and another iteration. The cost compounded. The recurring pattern was:

1. Build to a feature list rather than a user journey
2. Ship without auditing against earlier promises in the conversation
3. Surface flaws as decisions for the user instead of fixing them
4. Redesign from scratch each iteration instead of patching the working file
5. Drift to a sub-system because it was top of mind, ignoring the broader system map

The session ended only when the agent was forced — through repeated direct
challenge — to slow down and run the work itself rather than letting the
user discover defects. The cost of this discipline being personality-driven
rather than structural was the entire session.

This ADR captures the discipline so future builds inherit it automatically
without requiring repeated user enforcement.

## Decision

SpaceSC adopts a four-part UI build discipline as the operating protocol
for any agent doing UI work on SpaceSC surfaces. The four parts are a
**thinking template** (executed before code — now including a *charter*
and *persona* in the exploratory-testing sense), a **self-audit
checklist** (executed before declaring done — now including
*tours*, *SFDIPOT coverage*, and explicit *oracles*), a **past-failure
register** (consulted as anti-patterns), and a **session debrief
template** (executed at end of turn). The discipline is anchored to the
use case build tree, which is served as the live system map at
`https://spacesc-mcp.75xnd2784n.workers.dev/system-map`.

The pre-flight pointer lives in `CLAUDE.md` so every Claude Code session
in this repo inherits it automatically. Sessions that touch UI without
running the pre-flight are operating out of compliance.

### Part 1 — Thinking template (before any UI work)

Before writing or modifying any UI code, write out answers to these in
plain text. They go in the conversation, not in a separate file. The goal
is to articulate the problem before reaching for solutions:

0. **Charter — the one-sentence mission.** Write a single sentence in this
   shape: *"Explore [area] with [resources] to discover whether [the user
   can reach a specific end state]."* Example: *"Explore the Commute
   Player capture flow on iPhone Safari to discover whether a user can
   record, replay, and persist a voice note across a session reload."*
   Without a charter, exploration drifts into surface mechanics; with one,
   every action is judged against the stated outcome.

1. **Who is this for, and what is the job they're doing right now?**
   Name the person (Campbell) and the moment ("driving to work and wants
   to react to a brief that landed overnight"). Not a feature description.

2. **What surface in the use case build tree owns this?**
   Fetch `/system-map`. Identify the UC slice. Read the *next-build-action*
   banner and the surrounding phases. If the work doesn't fit into the
   build tree, that's a signal to update the tree first.

3. **What is the user's object and what are its states?**
   Enumerate every state. For each, name the next action available. Any
   state with no next action is a dead end — fix the design, not the UI.

4. **What links INTO this surface and what does it link OUT to?**
   No screen is a one-way trip. Every entry has an exit. Every push has
   a pop. Every capture has a backlink. If you can't answer this, the
   navigation graph isn't done.

5. **What in the past have I missed on similar work?**
   Read Part 3 below. Specifically check whether this build is repeating
   a previously named failure mode.

6. **What is the smallest patch that delivers value without regressing
   what's already there?**
   Iteration is patch, not redesign. If the answer is "rewrite the file,"
   stop. The right answer is a targeted edit to the working version.

7. **Persona — as whom am I testing?** Pick one concrete persona and stay
   in it for the verification work. Default: *"Campbell on the commute,
   one hand on the wheel, AirPods in, screen locked half the time."* For
   desk work: *"Campbell at his desktop in the morning, mug of coffee,
   triaging what came in overnight."* The persona blocks success paths a
   real user would not take — opening DevTools, hand-editing URLs,
   knowing the schema, curl-ing the API, running `grep` on the codebase.
   If the only way to verify the user-outcome is one of those, the build
   fails the persona test; the UI itself must support the verification.

### Part 2 — Self-audit checklist (before declaring done)

Before saying any variation of *"it's ready,"* run this audit. Find issues
and **fix them in the same turn**. Do not surface a bug list to the user
as a decision point. The user is the customer of finished work, not the QC.

The audit has three sub-parts: (a) **integrity checks** — does the code
match the promises; (b) **tours** — systematic exploration paths; (c)
**coverage and oracles** — dimensions to walk and decision criteria for
*broken vs working.* Run all three. The integrity checks alone are
insufficient — they're necessary but not sufficient.

#### Part 2a — Integrity checks

1. **Promise trace.** Re-read the conversation. For every commitment made
   to the user, find the line of code or config that fulfills it. Anything
   not found is unfinished.

2. **State coverage.** For every state of the user's object, confirm the
   UI renders a clear next action. No greyed-out buttons without inline
   explanation of what unlocks them.

3. **Navigation closure.** For every push into a screen, verify the pop
   path. For every modal or sheet, verify dismiss works. For every link
   to another surface, verify the surface exists and renders.

4. **Capture backlinks.** For every capture (insight, RN, OQ, gap, flag,
   errata), verify the captured payload includes the source context
   (which surface, which timestamp, which artifact id). No information
   should land in the system with its origin stripped.

5. **Failure mode naming.** Before claiming done, write out three concrete
   ways this could fail for the user. For each, either fix it or document
   it explicitly as a known limit in the deliverable.

6. **Jargon scan.** Grep the user-facing text for internal names,
   pipeline stage IDs, hex codes, version-control suffixes (W4, W5,
   dry-run), or system terms (SKR, errata, queue). Any hit gets renamed
   to plain language unless it's a Campbell-facing canonical name.

7. **Cross-surface awareness.** Does this UI know about the rest of the
   ecosystem? Are the links present and accurate? Does a user landing here
   from another surface have a way back?

8. **Colleague gut check.** Would the agent itself accept this work product
   from a colleague? If the honest answer is *"it works but needs polish"*
   or *"there are a few rough edges,"* the answer is no — keep working.

9. **Hidden-coupling check.** Name every assumption this change makes
   about other parts of the system. For each, verify it.

10. **Resource-search check.** Before any question to the user, confirm
    the answer isn't in: the codebase (`grep`), PROJECT_LOG, the use case
    build tree, the Downloads folder, the worker logs, prior agent
    artifacts, or any other reachable source. Asking the user is the last
    resort, not the first.

#### Part 2b — Tours (Whittaker's exploratory testing lenses)

Pick the tours that matter for this charter. Don't run all of them on
every build — pick deliberately. Each tour is a *named lens* you put on
to walk a coverage path the user would walk.

| Tour | What to do | When mandatory |
|---|---|---|
| **Feature** | Touch every visible affordance once. Every button, every link, every form field. | Always on first ship of a surface. |
| **Money** | Walk only the value-critical paths — the things the user opens the app to do. Ignore the rest. | Always before declaring "this addresses the user's complaint." |
| **Landmark** | Walk the named features in the order a user would. Maps to the user journey from Part 1, Q1. | Always when shipping a new surface. |
| **Back-alley** | The rarely-used corners. Empty states, error states, "what if I have only 1 item / 0 items / 1000 items." | Whenever a surface has list-rendering or counts. |
| **Saboteur / antisocial** | Invalid input, hostile clicks, double-taps, rapid sequence-actions, malformed data from the backend. | Whenever the UI mutates state (writes via POST/PUT). |
| **All-nighter** | Leave it running. See what leaks — memory (blob URLs, observers), state (stale caches), audio (silently stops). | Whenever the surface holds long-lived state (audio sessions, polls, websockets). |
| **Garbage-collector** | Does cleanup work? Does delete actually delete? Does logout clear the right state? | Whenever the surface has "undo," "remove," "clear," or "sign out." |

For each tour run, write a one-line note: *"Feature tour: 14 affordances,
all responded. Money tour: capture-during-article succeeds end-to-end.
Back-alley tour: empty state for 0 articles missing — fixed."* If the
tour found something, fix in this turn.

#### Part 2c — Coverage (Bach's SFDIPOT)

For UI work, walk each dimension explicitly. Don't just exercise
functions on default data on one browser:

| Dim | Cue |
|---|---|
| **S**tructure | The components, screens, files. Did I touch every part I claimed? |
| **F**unction | Every action the user can take. Did each one behave under valid input? |
| **D**ata | Empty, one, many, edge values (null, undefined, huge string, special chars, unicode, emoji, mac_offline error body). |
| **I**nterfaces | Every backend endpoint called. Every cross-surface link. Every external dependency (ElevenLabs, Notion, Anthropic). |
| **P**latform | iOS Safari (the acceptance-blocking platform per ADR-021), desktop Chrome, dark mode, light mode, narrow viewport. |
| **O**perations | The actual conditions of use — phone in cradle, AirPods, screen locking, intermittent network, multitasking. |
| **T**ime | Short session, multi-hour session, returning to the tab after sleep, blob URLs older than a minute, the 5-minute prompt cache window, the 2-min audio-cooking window. |

For each dim, write a one-line note. If a dim is genuinely not relevant
to the charter, say so explicitly — don't skip silently.

#### Part 2d — Oracles (how to decide *worked vs broken*)

"No error thrown" is **not** success. The oracle is the question *"does
this match what should be?"* For UI work in this repo, two oracles carry
most of the weight:

- **Claims oracle.** Does the behavior match the explicit claims — the
  user's stated request, the dispatch, the acceptance criteria in the
  ADR, the contract you wrote in the conversation? If you promised
  *"approve → audio queued → playable within ~2 min,"* trace each step.
- **Purpose oracle.** Does the user actually reach the end state in their
  Charter (Q0)? Not "the API returned ok=true." The actual user outcome.
  Open the player in your head as the persona, walk the charter, ask:
  *did the user finish the thing they came to do?*

The full list (Bolton's FEW HICCUPPS) — consult when needed:

| Letter | Oracle | Use when |
|---|---|---|
| F | Familiar | Does this feel like other parts of SpaceSC? |
| E | Explainable | Could I describe this to Campbell without hedging? |
| W | World | Does this match how the real world works (a Friday after-work commute, a paywalled article)? |
| H | History | Does this match how this product has behaved before? Look for silent regression. |
| I | Image | Does this match the warm-minimalism aesthetic codified in ADR-024-related work? |
| C | Comparable | Does this match how other audio apps / capture apps behave (Apple Music, Notes)? |
| C | Claims | **(Load-bearing.)** Does this match the explicit promise? |
| U | User expectations | Does this match what a real user would predict the next tap to do? |
| P | Product | Does this match the rest of the product's behavior? |
| P | Purpose | **(Load-bearing.)** Does this serve the user's stated end state? |
| S | Statutes | Are there policy / privacy / acceptance rules being honored? (e.g., no hardcoded tokens, F5.) |

### Part 3 — Past failure register (specific examples to scan before each build)

Each entry is a real failure from the 2026-05-18 session. Concrete examples
teach better than abstract rules. Before any UI work, scan this list and
check whether the current build is repeating any of them.

| # | Failure mode | What happened | The lesson |
|---|---|---|---|
| F1 | Anchoring to recent work | Built the player UI for only the §8.4a.21 learning-module slice; dropped articles, captures, nav. Recent context dominated the system map. | Zoom OUT to `/system-map` before zooming in. The current conversation thread is one signal among many; the build tree is the ground truth. |
| F2 | Asking instead of searching | Asked for desk URLs and Notion DB IDs that were already in the codebase, in PROJECT_LOG, in `worker/src/index.ts` constants, and in `/Users/campbellkane/Downloads/`. | `grep` and `Bash ls` first. Reading a file the agent already has access to is faster than waiting for a human reply. |
| F3 | Surfacing bug lists to the user | After self-audit, presented a list of 8 known bugs and asked which to fix first. The user is the customer. | Audit → fix in the same turn. The deliverable is finished work, not a triage queue. |
| F4 | Redesign instead of patch | Each "v3.1" was a fresh design that lost features from the previous version. Article playback, nav, captures all silently dropped. | Every iteration is `Edit` on the working file. "Rewrite from scratch" is almost always the wrong move. |
| F5 | Hardcoded secrets in shipped bundle | The v3 player had `HARDCODED_TOKEN = "Euf3..."` baked into the gzipped artifact. The user's live bearer token was extractable from any browser opening that file. | No secret values in client bundles, ever. Auth reads from `localStorage` at request time. |
| F6 | API-contract briefs to UI generators | Prompts to Claude Design were tables of endpoints and JSON shapes. Claude Design produces what it's asked to produce — given a spec, it built a spec-shaped admin tool. | Lead with the user journey, in story form. Endpoints are an appendix, not a brief. |
| F7 | Missing cross-surface links | The Player had no way to jump to the desk, corpus, insights, posture, etc. The user was stranded once they reached UC3. | Every surface needs the SpaceSC nav pill. Audit cross-surface links as part of every UI ship. |
| F8 | Greyed buttons with no explanation | "Listen to full episode" was greyed when the brief hadn't been approved, with no text explaining what unlocked it. The user could not infer the system's rules. | Every disabled state shows its unlock condition inline. Never an unexplained grey. |
| F9 | Not re-reading documents that changed | The use case build tree was open and visible in the user's hands during the session, and the agent kept building from its own (stale) recollection. | Re-fetch the canonical artifact at the start of each turn that touches it. Trust the document over recall. |
| F10 | "Happy path works" treated as done | Smoke-tested only the dry-run module 82 path; iOS Safari autoplay, blob URL leaks, audio onError, and capture-during-article context were all broken on first ship. | "Happy path works" is the start of QC, not the end. Walk the failure paths too. |
| F11 | Internal stage codes in user UI | Module status badges showed `S6-extract`, `S7-pass2`, `revise-pending` — pipeline-internal language leaking into the surface. | Translate every internal state to plain English at the UI boundary. No `§8.4a.*` or stage codes in user text. |
| F12 | Conflating "feature complete" with "done" | When all promised features were wired, declared done — missed that the cross-surface nav, theme toggle, and clear-cache button were all silently absent. | Done = every promise traced. The promise trace happens during the audit, not on user demand. |
| F13 | "Tests pass" treated as user-outcome reach | The audio_r2_key field had been silently dropped from the pipeline-status API response for hours. Smoke tests passed (HTTP 200, audio existed on R2), but Campbell's user-outcome — *"I approved this, can I now play the full episode?"* — was blocked. The agent's audit checked the wrong oracle. | Run the *Purpose oracle* (Part 2d) — open the surface as the persona, walk the charter, ask *did the user finish the thing they came to do?* "No error thrown" is not success. |
| F14 | Polled positive-signal-only state | Commute Player's post-approve loop polled pipeline-status every 20s for 18 tries (6 min) looking for `audio_r2_key`. On poll error, `catch (_) {}` swallowed the exception; on timeout, polling silently stopped. If the W8.1 audio queue failed, ElevenLabs ran slow, or the bearer token expired mid-commute, the UI stayed on "Approved · audio generating" forever. The sibling pattern was `_partial: true` on 207: the api helper set the flag but no caller read it, so partially-failed `module-feedback` dispatches reported as full success and the user lost half their voice intent silently. | Polling loops surface negative state explicitly. Never `catch (_) {}` inside a poll — auth errors get a reauth prompt, repeated errors get a check-failed surface, timeout gets a "taking longer than usual" surface. For multi-action endpoints (207 partial), the caller must inspect the dispatch result and tell the user which actions did and didn't apply. Name at least three failure modes per polled flow and render a distinct recovery path for each. |

### Part 3.5 — Pre-deploy gate: audit blindspots (§8.4a.25)

Before any deploy or "done" declaration on UI work, run:

```
list_open_blindspots()  →  MCP tool, status='open'
```

Each open blindspot was generated automatically when Campbell tapped 🚩 on a
SpaceSC surface to report something the system should have caught without his
intervention. The adversarial UAT pass (`analyzeBlindspot`) produced:

- `missed_check` — which existing F-entry was nearby (F13, F14, etc.) or `"new"`
- `why_text` — one-paragraph diagnosis of the specific failure mode
- `proposed_new_check` — the verification step that would have caught it

For each open row, the agent MUST:

1. **Run the proposed_new_check** against the current build. If it passes
   green, the user's reported issue was a one-off (no missing check). If it
   fails, the check is doing real work — promote it.
2. **Resolve** the blindspot via `resolve_blindspot(id, "applied", note, "F##")`
   when the check is now part of the canonical audit, OR via
   `resolve_blindspot(id, "rejected", note)` with a written argument for why
   the check would be noise rather than signal.
3. **Promote applied checks** into Part 3 of this ADR as F15, F16, …
   each with a name + signature + recovery, same format as F1–F14.

The deploy gate fails if any blindspot in the touched-surface scope remains
`open`. The user does not have to remember they reported it — the agent reads
the queue at session start (per `CLAUDE.md`) and works it down.

### Part 4 — Session debrief (after the work, before declaring closed)

End every UI-touching turn with a short structured debrief. Even one
turn is a "session" in the SBTM sense — time-boxed, charter-driven,
auditable. The debrief is what makes the work checkable by Campbell
without him having to re-derive the audit from scratch.

Template (paste into the response near the end):

```
DEBRIEF
- Charter: <verbatim from Part 1, Q0>
- Persona: <verbatim from Part 1, Q7>
- Tours run: <Feature / Money / Landmark / Back-alley / Saboteur / All-nighter / Garbage-collector — list which>
- SFDIPOT dims covered: <S/F/D/I/P/O/T — one line each>
- Oracles applied: <Claims, Purpose, plus others if relevant>
- Bugs found and fixed this session: <numbered list>
- Issues raised (deferred, not blocking): <numbered list, each named explicitly>
- User-outcome reach: <reached / partially reached / blocked — one sentence why>
- Time split: <% on charter / setup / investigation>
- New failure modes to add to Part 3 register: <if any>
```

The "User-outcome reach" line is the load-bearing one. *"Reached"* means
the persona, taking only the paths a real user would take, can complete
the charter. *"Partially reached"* names what was incomplete.
*"Blocked"* means the user cannot finish — and the turn is not done.

## Consequences

**Positive:**

- The discipline is structural, not personality-dependent. Future Claude
  Code sessions in this repo inherit it automatically via `CLAUDE.md`.
- `/system-map` becomes the canonical live source of truth for what the
  system is, eliminating the "build tree is a file in Downloads" gap.
- Past failures from 2026-05-18 cannot silently re-occur without the
  agent recognizing the pattern (F1–F14 are named).
- The user can hold any agent accountable to a specific section number
  rather than re-explaining the principle each time.

**Negative / new obligations:**

- Adds visible overhead to every UI turn — the thinking template is
  written into the conversation, not skipped.
- The audit checklist is non-trivial in length. For very small UI tweaks
  (e.g. one-line copy edit), the agent may treat sections as
  no-ops but must still confirm none apply.
- Adds a new ADR that future readers must consult; the burden is shifted
  from the user repeating themselves to the agent reading more docs.
- The past-failure register grows over time. New entries should be added
  when new failure modes surface in production work.

## Application

`CLAUDE.md` is updated to reference this ADR as a hard pre-flight gate
alongside the existing plan-mode discipline (§8.4a.5). The relevant
section reads:

> **UI build discipline** (per ADR-024). Before any UI work, fetch the
> use case build tree at `/system-map`, write the thinking template into
> the conversation, and run the self-audit checklist before declaring
> done. Past failure modes (F1–F14) are explicit anti-patterns.

`/system-map` is served by the Worker (`worker/src/index.ts`) from the
asset `worker/src/assets/system-map.html`, with the SpaceSC nav pill
injected like the other tool surfaces.

When a new failure mode is identified, the agent that surfaced it appends
an entry to Part 3 of this ADR in the same turn that fixes the underlying
issue. The register is a living artifact.

## Open questions

- **Hook-enforced compliance.** A Claude Code Stop hook could verify the
  thinking template was written and the audit checklist was executed
  before allowing the turn to end. Deferred — current pointer-based
  discipline is lighter weight; revisit if non-compliance recurs.
- **Scope of "UI work."** This ADR applies to changes that affect a
  user-facing surface. Backend-only changes (Workflow steps, D1 schema,
  Worker handlers) fall under §8.4a.5 plan-mode discipline, not this ADR.
  If a change is mixed, both disciplines apply.

---

*Provenance: authored fresh 2026-05-19 in response to a 2026-05-18 session
in which six iterations of the UC3 Commute Player shipped with regressions.
The 12-entry past-failure register at Part 3 is taken directly from that
session's failure modes.*
