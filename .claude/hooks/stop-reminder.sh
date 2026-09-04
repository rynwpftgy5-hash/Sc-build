#!/usr/bin/env bash
# Stop hook: enforces the Evidence-Based Completion Receipt per ADR-006.
# Fires when the assistant tries to end its turn. Stdout is injected into
# the next turn as a system reminder. The hook is reminder-only (exit 0);
# it does not block the turn from ending.
#
# Edit this text to tune the reminder; do NOT edit settings.json unless the
# hook wiring itself needs to change.

cat <<'REMINDER'
Before ending this turn, decide whether the work just done was non-trivial:

NON-TRIVIAL if you have, in this session:
  - modified any file under version control, OR
  - run a state-changing command (write, deploy, migration, MCP write), OR
  - invoked a tool whose effect persists outside the conversation
    (Notion write, GitHub action, D1 / R2 / Pinecone write), OR
  - authored a recommendation Campbell is expected to act on.

If NON-TRIVIAL: produce a Completion Receipt before stopping, in this shape
(per docs/adr/0006-definition-of-done.md):

  ## Completion receipt — <task title>
  **Customer end state (restated, testable):** ...
  **Acceptance criteria, each with evidence:**
    - [ ] AC1: <criterion> → ✓/✗ → Evidence: <cmd+output | file:line | screenshot | log>
    - [ ] AC2: ...
  **Adversarial review:** <subagent reviewer verdict, OR self-critique under
    hostile-reviewer persona; mandatory for code, prompt, or external-state changes>
  **What was NOT tested, and why:** ...
  **Top three ways this is likely still broken:** 1. ... 2. ... 3. ...
    (state whether each was checked and how)
  **Self-grade (0-10) on confidence this delivers the end state:** N — because ...
    (if below 8, do NOT declare done; continue)

If TRIVIAL (read-only, conversation, clarification, file reading only): state
so explicitly in one sentence justifying the triviality claim. The claim is
auditable.

Silence is not an option. Do not stop without one of the two.
REMINDER
