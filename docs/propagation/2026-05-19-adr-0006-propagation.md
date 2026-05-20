# Propagation handoff — ADR-006 Evidence-Based Definition of Done

- **Session:** Claude Opus librarian (remote container)
- **Date:** 2026-05-19
- **Last updated:** 2026-05-19 (turn 2, after attempted execution)
- **Branch:** `claude/propagate-definition-of-done-5r0t5`
- **Trigger:** sibling session landed ADR-006 + Stop hook on
  `restructure/worker-subdirectory` (uncommitted) and asked the librarian
  to propagate across Notion + memory + the concurrent W5 session.

## What this file is (and why turn 2 didn't finish the job)

Notion page content does not live in the repo (per CLAUDE.md "What"
section). This file is a paste-ready bundle for Campbell to discharge
into Notion + local memory + the W5 session.

**Turn 1 (initial drafting).** Produced all six task drafts but could
not execute any of them — Worker URL unreachable from container,
Mac filesystem unreachable, no Notion write authority verified.

**Turn 2 (attempted execution after constraints claimed lifted).**
Verified the constraints are only *partially* lifted from this
container:

- **Worker `/api/log-append` is still unreachable.** `curl` returns
  `403 Host not in allowlist` from this container. The environment's
  network policy only permits `github.com` and similar; `*.workers.dev`
  is blocked. Even `anthropic.com` returns 403. So Task 1 (PROJECT_LOG)
  cannot use the Worker path from here.
- **Notion MCP `insert_content` times out.** Three consecutive attempts
  (one large §10 payload, one minimal §10 header, one minimal
  PROJECT_LOG header probe) all hit the MCP client's 60s timeout with
  zero commits server-side (verified by re-fetch each time). This is
  the exact stall mode CLAUDE.md warns about when it says "rate-limited
  and stalls on long sessions" — both pages are very large
  (OPS_PLAYBOOK 246K chars, PROJECT_LOG 794K chars) and `insert_content`
  appears to round-trip page state.
- **Mac filesystem still unreachable.** `/Users/campbellkane/...` does
  not exist (this is a Linux container at `/home/user/Sc-build`).
  Tasks 3, 5, 6 (sed on ADR-006, branch split, memory-file writes)
  must run from Campbell's Mac.

**What turn 2 did accomplish.** Verified the live state of both Notion
pages and corrected the §-numbering assumption (see below).

## CORRECTION — §10, not §12

Turn 1 assumed OPS_PLAYBOOK §12 was the next free section per
CLAUDE.md's "§1–§11" claim. **Direct fetch of the live OPS_PLAYBOOK
page shows top-level § sections only go up to §9** (actual headers
present at `## §N`: §2, §3, §5, §8, §9; §1/§4/§6/§7 referenced from
subsections but not as top-level headers; §10/§11/§12 don't appear
anywhere in the page).

CLAUDE.md drifted. **Smallest unused top-level § number = §10.** This
file is updated throughout to use §10 — including the OPS_PLAYBOOK
section header, the PROJECT_LOG entry body, the ADR-006 `sed` command,
and the memory note text.

(Optional follow-up Campbell might want: bring CLAUDE.md back in sync
with the live playbook — "§1–§11" should become "§1–§10" after the
paste lands.)

Once the contents have been pasted/discharged, this file can be
deleted in a follow-up commit, or left as provenance. Either is fine.

---

## Task 1 — PROJECT_LOG entry (paste via Worker `/api/log-append`)

Paste the body below into the existing Worker webhook flow (CLAUDE.md:
"Append entries via the Worker `/api/log-append` webhook, NOT via the
slow Notion `update_content` path"). Target page:
`34548344-93df-81ed-972f-c524406eeb04`.

```
[2026-05-19 §completion-discipline-ADR-006-LANDED]
Author: Claude Opus (librarian session)

The problem. Agent sessions were finishing turns by declaring success
("done", "shipped", "ready for review") on the strength of intent rather
than evidence — leaving Campbell to act as the QA layer that verified
the agent's work after the fact. This inverts the intended division of
labour: the agent should produce evidence that the work meets its
acceptance criteria; Campbell adjudicates from that evidence rather
than re-deriving it. Repeated occurrences of the inversion across W4
and the §8.4a.21 design loop motivated a durable guardrail.

What landed. Four artifacts on restructure/worker-subdirectory
(uncommitted at time of this entry):
  1. docs/adr/0006-definition-of-done.md — ACCEPTED 2026-05-19. Defines
     the Completion Receipt template, the trivial / non-trivial
     distinction (with explicit triviality declaration as the escape
     clause), the adversarial-review requirement, and four enforcement
     layers.
  2. .claude/hooks/stop-reminder.sh — Stop-hook script. Echoes the
     reminder text on every stop. Reminder-only (exit 0); does not
     block the stop.
  3. .claude/settings.json — wires the Stop hook into the project-shared
     settings file. NEW project-shared settings file; the existing
     .claude/settings.local.json was left untouched (it remains
     gitignored per .gitignore).
  4. CLAUDE.md — added an "Evidence-Based Definition of Done" bullet
     under "How (build conventions)" pointing at ADR-006.

Enforcement layers, status now:
  Layer 1 (ADR + CLAUDE.md cross-reference) — LIVE. Any session reading
     CLAUDE.md or browsing docs/adr/ will encounter the discipline.
  Layer 2 (Stop hook reminder) — LIVE in any NEW session opened in this
     repo. The hook does NOT retroactively reach into already-running
     sessions, so concurrent sessions started before the hook landed
     (notably the W5 session on restructure/worker-subdirectory) will
     not see the reminder until they restart.
  Layer 3 (CI gate that fails PRs without a receipt in the description) —
     PENDING. Deferred to a follow-up GitHub Action; not blocking.
  Layer 4 (human review at PR time) — ALWAYS-ON. Unchanged; Campbell
     was already performing this layer manually.

Escape clause. Sessions whose work is genuinely trivial or
conversational (read-only exploration, single-line typo, advisory
chat, planning-only turns) may discharge the discipline with a
one-line triviality declaration in place of the full receipt. The
declaration template lives in OPS_PLAYBOOK §10.

Not done yet. (a) OPS_PLAYBOOK §10 section — drafted in this librarian
session, pending Campbell paste into Notion page
35248344-93df-81a7-9cfa-ece289a95248. (b) GitHub Action enforcement
(Layer 3) — explicitly deferred; will land in a separate dispatch
once the receipt template has had a soak window. (c) Notification of
the concurrent W5 session — drafted as a one-line message for
Campbell to paste into that session manually (it cannot receive the
hook without restart).
```

---

## Task 2 — OPS_PLAYBOOK new section (paste into Notion page `35248344-93df-81a7-9cfa-ece289a95248`)

Assigned **§10** — verified against live OPS_PLAYBOOK in turn 2 via
Notion MCP `notion-fetch`. Actual top-level `## §N` headers present
are §2, §3, §5, §8, §9; §10/§11/§12 do not appear anywhere. CLAUDE.md
("§1–§11") is drifted; §10 is the smallest unused slot. No further
re-numbering needed at paste time.

```
## §10 — Completion discipline (Evidence-Based DoD)

Operational handbook companion to ADR-006. Read the ADR for the
"why"; this section is the runbook for "how to discharge".

### When the receipt is required vs. when triviality declaration suffices

Adjudicate in this order — stop at the first YES:

  1. Did the turn modify external state (Notion, Cloudflare, R2,
     D1, Pinecone, GitHub, deployed Worker, ElevenLabs)?
       YES → receipt required.
  2. Did the turn change committed files (code, config, ADRs, hooks,
     skills, prompts) beyond a single-line typo fix?
       YES → receipt required.
  3. Did the turn make an architectural claim that downstream
     sessions will rely on (e.g. "S5 fan-out runs through Queue X")?
       YES → receipt required.
  4. Was the turn a read-only investigation, a planning conversation,
     a single-line typo, or an advisory chat with no artifact?
       YES → triviality declaration suffices.

When in doubt, write the receipt. The cost of an unnecessary receipt
is low; the cost of a missing one is the Campbell-as-QA inversion.

### Completion Receipt template (paste-ready)

```
## Completion Receipt

**Acceptance criteria.** <copy from the dispatch, ADR, or implicit
contract of the request — bulleted, each one independently verifiable>

**Evidence per criterion.**
  - AC1: <command run + output excerpt | file path + line range |
          screenshot reference | verification trail link>
  - AC2: <same shape>
  - ...

**Adversarial review.** Reviewer subagent: <subagent name or "inline
self-review against the template below">. Findings: <none | list>.
Resolution of findings: <committed in <sha> | declined because <reason>>.

**Out of scope.** <anything the dispatch asked for that this turn
deliberately did NOT do, with rationale>

**Known follow-ups.** <bulleted; each one names a workstream or
session-type that owns it>
```

### Triviality declaration template (one-liner)

```
**Triviality declaration.** This turn was <read-only investigation |
planning conversation | single-line typo | advisory chat>; no external
state changed; no committed artifact beyond the declaration itself. No
Completion Receipt produced per ADR-006.
```

### Subagent reviewer prompt template

Hand the reviewer subagent ONLY the acceptance criteria and the diff.
Do not include the implementer narrative — narrative biases the
reviewer toward agreement.

```
You are an adversarial reviewer. You have not seen the implementation
conversation. Below are (a) the acceptance criteria the implementer
agreed to and (b) the diff the implementer produced. Your job is to
find any criterion that is NOT met by the diff, any criterion that is
met by accident rather than by design, and any obvious regression the
diff introduces in adjacent code.

Acceptance criteria:
<verbatim from the dispatch>

Diff:
<git diff --stat + git diff output, or PR link>

Output format:
  - Per-criterion verdict: MET | NOT MET | MET BY ACCIDENT
  - Regressions found: <list or "none">
  - Recommendation: APPROVE | REQUEST CHANGES with <specific items>
```

### Escape hatch — overriding the Stop hook for genuinely conversational sessions

The Stop hook is reminder-only (exit 0) — it cannot block. So an
"override" is conceptual rather than technical: discharge the
reminder by emitting the triviality declaration one-liner (above).
No need to disable the hook, edit .claude/settings.json, or pass
--no-hooks. Sessions that are entirely advisory should emit the
declaration once at end-of-turn and continue.

If a hook ever becomes blocking (Layer 3 CI gate, when it lands),
the override remains the same: the PR description carries either a
receipt or a triviality declaration, and the gate parses for either.

### Cross-reference

See `docs/adr/0006-definition-of-done.md` for the canonical decision
and rationale.
```

---

## Task 3 — Close the ADR-006 forward reference

ADR-006 contains the string `OPS_PLAYBOOK §<TBD by librarian>`.
Replace with `OPS_PLAYBOOK §10`. Per `docs/adr/README.md` ("Fix
typos and links only"), this kind of edit is explicitly permitted
even after ACCEPTED.

Concrete edit (run on the Mac, on the branch where ADR-006 lives):

```bash
# from spacesc-mcp root, on restructure/worker-subdirectory
sed -i '' 's/§<TBD by librarian>/§10/' docs/adr/0006-definition-of-done.md
git add docs/adr/0006-definition-of-done.md
git commit -m "ADR-006: close forward reference (OPS_PLAYBOOK §10)"
```

If §10 turned out to be taken when Campbell pasted Task 2 into Notion
and a different §N was used, substitute that number in the `sed`
above.

---

## Task 4 — One-line message for the concurrent W5 session

Recommendation **(b)** from the dispatch. Campbell pastes this into
the running W5 session:

```
NEW DoD discipline landed at docs/adr/0006-definition-of-done.md (OPS_PLAYBOOK §10); the Stop hook will fire for you on next launch but not in this session — please produce a Completion Receipt for the W5 work once it lands, retroactively if necessary.
```

(Single line on purpose so it survives copy-paste without losing
intent. The W5 session can then read ADR-006 + §10 itself.)

---

## Task 5 — Branch / commit strategy recommendation

**Recommendation: cherry-pick the four ADR-006 artifacts onto a fresh
`docs/definition-of-done` branch and open a separate PR.** Keep PR #7
scoped to the worker/ restructure. Reasons:

  - PR #7's review surface stays narrow (one concern: subdirectory
    move). Reviewer cognitive load matters at single-principal scale.
  - The DoD discipline is orthogonal to the worker/ restructure and
    will be referenced by future PRs regardless of whether #7 lands.
  - If PR #7 hits a snag in review, the DoD discipline does not get
    stuck behind it.
  - The Stop hook (`.claude/hooks/stop-reminder.sh` + the
    `.claude/settings.json` wiring) is process infrastructure that
    benefits from a clean commit message and a focused PR description
    that future sessions can grep for.

**Exact git commands Campbell would run on his Mac (do not execute
from this remote container):**

```bash
# Stand at restructure/worker-subdirectory with the four uncommitted
# artifacts in the working tree.

# 1. Stage and commit ONLY the four DoD artifacts as one logical commit.
git add docs/adr/0006-definition-of-done.md \
        .claude/hooks/stop-reminder.sh \
        .claude/settings.json \
        CLAUDE.md
git commit -m "Evidence-Based Definition of Done (ADR-006 + Stop hook)"

# 2. Note the SHA so we can cherry-pick it onto a fresh branch.
DOD_SHA=$(git rev-parse HEAD)

# 3. Move the commit OFF restructure/worker-subdirectory so PR #7 stays
#    scoped. Reset the worker branch one commit back; the DoD commit
#    survives in the reflog and as DOD_SHA.
git reset --hard HEAD~1

# 4. Branch from main (NOT from restructure/worker-subdirectory) so the
#    DoD PR doesn't carry the W5 work as ancestry.
git fetch origin main
git switch -c docs/definition-of-done origin/main
git cherry-pick "$DOD_SHA"

# 5. Push and open the PR (small, clean diff).
git push -u origin docs/definition-of-done
gh pr create --base main --head docs/definition-of-done \
  --title "Evidence-Based Definition of Done (ADR-006 + Stop hook)" \
  --body "$(cat <<'EOF'
Lands ADR-006 and the Stop-hook reminder. Layer 1 (ADR + CLAUDE.md)
and Layer 2 (Stop hook) become live on merge. Layer 3 (CI gate) is
deferred; Layer 4 (human review) is already in place.

See ADR-006 and OPS_PLAYBOOK §10 for full discipline.
EOF
)"
```

**Safety notes for Campbell before running:**

  - Step 3 is `git reset --hard HEAD~1`. Confirm `git status` is clean
    of *other* uncommitted W5 work first, and that `$DOD_SHA` is set.
    The DoD commit survives in the reflog and via the variable.
  - If there are other uncommitted W5 changes mixed into the working
    tree, stash them BEFORE step 1 so they don't ride along, then pop
    after step 3.

This librarian session is propagation-only; the propagation branch
(`claude/propagate-definition-of-done-5r0t5`, this file) is independent
of the four-artifact commit above. Two separate PRs result:

  - PR #7 (existing) — worker/ subdirectory restructure. Unchanged.
  - PR #N — docs/definition-of-done (the four artifacts).
  - PR #N+1 — this propagation handoff (optional; can be merged after
    Campbell discharges the Notion writes and deletes this file).

---

## Task 6 — Memory note recommendations

Two notes pass the "non-obvious, not derivable from code" bar. Both
fire automatically for any future session in the repo before the
session has a chance to read CLAUDE.md or ADR-006.

Path: `/Users/campbellkane/.claude/projects/-Users-campbellkane-code-spacesc-mcp/memory/`

Suggested entries (append to the relevant existing file, or create a
new `dod.md`):

```
## Stop hook fires automatically in this repo

A Stop hook at `.claude/hooks/stop-reminder.sh` runs on every session
stop in spacesc-mcp. It emits a reminder about the Evidence-Based
Definition of Done. It is reminder-only (exit 0) and does NOT block
the stop. The hook is wired via `.claude/settings.json` (project-shared,
checked in). If you see a Stop-hook reminder you did not configure, it
is this one — not stale tooling. The reminder text is the
canonical text from ADR-006.
```

```
## Completion Receipt template lives in ADR-006

The receipt template + triviality-declaration escape clause + the four
enforcement layers are defined in `docs/adr/0006-definition-of-done.md`.
The operational runbook (when to use the receipt vs. the declaration,
subagent reviewer prompt, etc.) lives in OPS_PLAYBOOK §10. Default to
emitting a receipt at end-of-turn for any non-trivial turn; use the
triviality one-liner only for read-only / advisory / typo-only turns.
```

(Both can only be written from Campbell's Mac — the remote container
cannot touch `~campbellkane`.)

---

## Completion Receipt (per ADR-006, this propagation turn)

**Acceptance criteria.**
  - AC1: PROJECT_LOG entry drafted with the required structure
    (problem, four artifacts, enforcement-layer status, hook
    non-retroactivity, triviality escape clause, what's-not-done).
  - AC2: OPS_PLAYBOOK §10 section drafted with all six required
    sub-parts (flowchart, receipt template, triviality template,
    reviewer-subagent prompt template, escape hatch, ADR-006
    cross-link).
  - AC3: ADR-006 forward-reference edit specified with concrete `sed`
    command for Campbell.
  - AC4: W5 notification message drafted as a single line.
  - AC5: Branch strategy recommendation made with exact git command
    sequence and safety notes.
  - AC6: Memory note recommendations drafted with exact text and path.
  - AC7: All of the above committed to this branch and pushed.

**Evidence per criterion.**
  - AC1–AC6: this file
    (`docs/propagation/2026-05-19-adr-0006-propagation.md`), sections
    "Task 1" through "Task 6". Single-file deliverable chosen
    deliberately because the propagation surface is Notion + Campbell's
    Mac, neither reachable from this remote container.
  - AC7: see the commit landing this file on
    `claude/propagate-definition-of-done-5r0t5` and the corresponding
    `git push -u` to origin. Verify with `git log -1
    claude/propagate-definition-of-done-5r0t5` after merge.

**Adversarial review.** Inline self-review against the ADR-006
template (no subagent spawn — the propagation deltas are textual
drafts for human paste, not executable artifacts; an adversarial
subagent reviewer adds little signal over Campbell's own read at
paste time). Findings:
  - **§-numbering verified in turn 2.** Direct `notion-fetch` of the
    live OPS_PLAYBOOK page confirmed top-level `## §N` headers are
    §2, §3, §5, §8, §9 only; §10/§11/§12 absent. §10 is the smallest
    unused slot. CLAUDE.md ("§1–§11") drifted from live state. The
    drift is recoverable but worth fixing in a follow-up housekeeping
    pass — captured under "Known follow-ups" below.
  - Worker route (CLAUDE.md preferred PROJECT_LOG path) is unreachable
    from this container (`403 Host not in allowlist`), and Notion MCP
    `insert_content` times out at 60s on both target pages because of
    their size. Campbell must run the writes from a runtime that can
    reach the Worker — same constraint as turn 1, now empirically
    confirmed.

**Out of scope.**
  - Direct writes to Notion (Worker webhook unreachable from remote
    container; Notion MCP `update_content` path explicitly disallowed
    by CLAUDE.md for PROJECT_LOG).
  - Recreating the four ADR-006 artifacts on this propagation branch
    (dispatch explicitly forbade the cherry-pick from this session;
    artifacts belong on `docs/definition-of-done` per Task 5).
  - Editing ADR-006 directly to close the TBD forward reference (file
    does not exist on this branch; Task 3 specifies the edit as a
    command for Campbell to run on the Mac).
  - Writing Campbell's local memory files (different filesystem;
    Task 6 specifies exact text for Campbell to paste).
  - Pasting the W5 notification (no access to that session; Task 4
    delivers the single-line message for Campbell to paste).

**Known follow-ups.**
  - Campbell: paste Task 1 (PROJECT_LOG) via the Worker webhook from
    a Mac-runtime session (the Worker is reachable from there even
    though it is not from this container's network policy).
  - Campbell: paste Task 2 (OPS_PLAYBOOK §10) into the Notion page.
    §10 confirmed correct — no further numbering check needed.
  - Campbell: run the Task 3 `sed` on the Mac on the branch where
    ADR-006 lives, before opening the `docs/definition-of-done` PR.
  - Campbell: paste Task 4 into the running W5 session.
  - Campbell: execute the Task 5 git command sequence (the stash +
    branch split) — this librarian session was forbidden from
    executing it (and the Mac checkout is unreachable from here
    regardless).
  - Campbell: append Task 6 entries to local memory.
  - Future librarian pass: bring CLAUDE.md back in sync with the
    live OPS_PLAYBOOK numbering — change "§1–§11" to "§1–§10" once
    §10 has landed.
  - Future dispatch: implement Layer 3 (CI gate that parses PR
    descriptions for a Completion Receipt or triviality declaration).
    Deferred per ADR-006.
  - Once Campbell has discharged the items above, this propagation
    file can be deleted in a cleanup commit (or left as provenance).
