# Wave 1 — Claude Code items (RESTART_PLAN_2026-09)

Companion to the restart plan (Notion `3d148344-93df-8137-8c15-ccd39eae98d0`).
This file holds the parts of W1-C1 … W1-C5 that could not be executed from
the cloud session that wrote the code: Mac-local cleanup, the n8n node edit,
and the gated (G) data mutations with their exact statements. Everything in
the **Gated** sections waits for Campbell's greenlight.

## Where the code landed

Branch `claude/eloquent-meitner-t1bej1` (includes the survey branch). Summary:

| Item | Change | Files |
|---|---|---|
| W1-C1 | Survey branch merged; PRs #7 and #22 closed with a note each. | — |
| W1-C2 | Daily briefing skips when nothing real came in (row status `skipped`, no Sonnet/ElevenLabs spend); "real" excludes `spacenews-parking`, `claude`, and `undefined…` rows. Weekday label parses the date as a local day. New `GET /api/uc3/elevenlabs-quota` + home-screen credit banner (task #20). | `worker/src/lib/daily-briefing.ts`, `worker/src/handlers/uc3.ts`, `worker/src/assets/commute-player.html` |
| W1-C3 | New `POST /api/triage-classify` on Claude Sonnet 5 with a strict JSON schema, conservative default `review` on every failure (§2.18). | `worker/src/lib/triage-classify.ts`, `worker/src/lib/anthropic.ts` |
| W1-C4 | `POST /api/log-append` accepts `mode: "summary"` and rewrites the LATEST STATE SUMMARY section in place. | `worker/src/index.ts` |
| W1-C5 | `/api/project-log-recent` returns the newest entries (full walk, rolling window, 5-min cache); `/api/query` chunks carry `title`, `skr_page_id`, `skr_page_url` at top level; unknown paths return 404; six `*-v3-legacy.html` assets and `commute-player-v23.html` removed (bundle 3.6 MB → 2.7 MB). | `worker/src/index.ts`, `worker/src/assets/*.html` |

Verification available before deploy: `npm run type-check` clean, `oxlint`
clean, `wrangler deploy --dry-run` builds. Live verification per CLAUDE.md
Rule 3 happens at W1-C6.

## W1-C1 — Mac-side checkout reset (run on the Mac, not gated)

```bash
cd /Users/campbellkane/code/spacesc-mcp
git fetch origin
# keep the 1,182-line local diff for the record, then drop it
git diff > ~/Desktop/spacesc-local-diff-2026-05-19.patch
git stash list                      # two stashes noted in the survey; keep or drop by hand
git checkout -- . && git clean -n   # review the untracked list first
git clean -f -- .gitignore.local-backup README.md.local-backup
git checkout main && git pull --ff-only origin main
git worktree prune
git worktree list                   # remove any remaining detached ones:
# git worktree remove --force .claude/worktrees/<name>
```

**Gated (G):** committing `.claude/settings.json` + `.claude/hooks/stop-reminder.sh`
to `main`. It changes unattended behaviour for every clone; leave it local
until Campbell says otherwise.

## W1-C3 — n8n Step 3 node change (needs the n8n REST key; run from the Mac)

The Step 3 workflow (`BNBjoqXt…`) is not exposed to the n8n MCP server, and
`campbellkane.app.n8n.cloud` is blocked by the cloud session's network policy,
so the workflow edit happens from the Mac with the new API key.

1. Export the workflow: `GET /api/v1/workflows/BNBjoqXt…` and save the JSON.
2. Replace the **LLM Triage** HTTP Request node's target with the Worker:

   ```json
   {
     "method": "POST",
     "url": "https://spacesc-mcp.75xnd2784n.workers.dev/api/triage-classify",
     "authentication": "none",
     "sendHeaders": true,
     "headerParameters": { "parameters": [
       { "name": "Authorization", "value": "=Bearer {{ $vars.MCP_CLIENT_TOKEN }}" }
     ]},
     "sendBody": true,
     "specifyBody": "json",
     "jsonBody": "={{ JSON.stringify({ subject: $('TriagePrepare').item.json.subject, from: $('TriagePrepare').item.json.from, date: $('TriagePrepare').item.json.date, body_excerpt: ($('TriagePrepare').item.json.body_text || '').slice(0, 12000), attachment_names: $('TriagePrepare').item.json.attachment_names || [], has_attachments: !!$('TriagePrepare').item.json.has_attachments }) }}",
     "options": { "timeout": 60000 }
   }
   ```

   Add `MCP_CLIENT_TOKEN` as an n8n Variable first (same value as the Worker
   secret). Adjust the upstream node name if it is not `TriagePrepare`.
3. Replace the **Triage Decision** Code node body with:

   ```javascript
   // Reach back to the upstream node explicitly (§2.5): the HTTP node replaced $json.
   const src = $('TriagePrepare').item.json;
   const r = $input.item.json || {};
   const ok = ['ingest','review','skip','spam'].includes(r.classification);
   return { json: {
     ...src,
     triage_classification: ok ? r.classification : 'review',
     triage_rationale: ok ? (r.rationale || '') : `triage failure: ${r.error || 'no classification in response'}`,
     triage_confidence: r.confidence || 'low',
   } };
   ```
4. Smoke with one PDF email and one newsletter (expect `ingest` / `review`).
5. Check the next hourly Ingestion Log row: Title must not start with `undefined`.

**Gated (G):** reclassifying the 234 `undefined [triage:undefined]` Review rows.
Proposed mechanics once approved: a one-off n8n execution (or a Mac script)
that re-reads each row's `email_message_id`, re-fetches the message from
Gmail, POSTs it to `/api/triage-classify`, and updates Title / Stage History /
Error Message in place. Rows whose message no longer exists get
`triage:review` with rationale "source email not found".

## W1-C4 — archival workflow (Gated)

- **Deactivate** n8n `8sHd4N0YPG25ug1k` (§8.4a.6 — PROJECT_LOG archival). From
  the Mac: `POST /api/v1/workflows/8sHd4N0YPG25ug1k/deactivate`.
- **Delete the seven marker pages** under PROJECT_LOG (each is one paragraph
  claiming "N blocks moved"). Page IDs:

  | Page | ID |
  |---|---|
  | PROJECT_LOG_ARCHIVE_2026-05-11_AUTO | `35d48344-93df-8158-a0e2-c37b445b232f` |
  | PROJECT_LOG_ARCHIVE_2026-05-18_AUTO | `36448344-93df-81b4-951c-d2016b963c03` |
  | PROJECT_LOG_ARCHIVE_2026-06-01_AUTO | `37248344-93df-81b9-a4ef-f88dbd3e0bfb` |
  | PROJECT_LOG_ARCHIVE_2026-06-08_AUTO | `37948344-93df-8142-b1c7-cf3d0519d8e2` |
  | PROJECT_LOG_ARCHIVE_2026-07-06_AUTO | `39548344-93df-8192-b4bd-f672c7239c52` |
  | PROJECT_LOG_ARCHIVE_2026-08-03_AUTO | `3b148344-93df-810e-8f46-d224b6a8a0f2` |
  | PROJECT_LOG_ARCHIVE_2026-08-10_AUTO | `3b848344-93df-81da-8ad2-fa2dd28e0bae` |

  Not in scope: `PROJECT_LOG_ARCHIVE_2026-04` (the real April archive) and
  `PROJECT_LOG_ARCHIVE_2026-05-02_AUTO_DRYRUN` (harmless; delete only if asked).

- After deploy, the weekly housekeeping task (W2-K1) refreshes the summary with:

  ```bash
  curl -sS -X POST https://spacesc-mcp.75xnd2784n.workers.dev/api/log-append \
    -H "Authorization: Bearer $MCP_CLIENT_TOKEN" -H 'Content-Type: application/json' \
    -d '{"mode":"summary","body_markdown":"**Updated:** 2026-09-08 by housekeeping. **Phase:** …"}'
  ```

  The endpoint finds the heading containing `LATEST STATE SUMMARY`, inserts the
  new blocks right after it, then deletes the old blocks up to the next
  divider or `##` heading (cap 80 blocks; child pages are never touched).

## W1-C2 — bulk resolve in D1 (Gated)

15 stale pipeline-stall reports (all for series cancelled in May) and 11 open
blindspots. Verified against D1 on 2026-09-04: `ui_feedback` ids 11–25 are the
stall alerts; ids 4 and 27 are Campbell's own reports and stay open.

```sql
-- 15 pipeline-stall alerts → resolved
UPDATE ui_feedback
   SET status = 'resolved',
       resolution_note = 'Series cancelled 2026-05 (dry-run cleanup); stall alert obsolete. Bulk-resolved W1-C2 RESTART-2026-09.',
       resolved_at = strftime('%s','now')
 WHERE id BETWEEN 11 AND 25
   AND status = 'open'
   AND notes_text LIKE '[pipeline-stall:%';

-- 11 blindspots → applied (F6/F8/F12/F14 are already in ADR-024 Part 3)
UPDATE audit_blindspots
   SET status = 'applied',
       applied_to_adr = 'ADR-024 Part 3 (F6, F8, F12, F14)',
       resolution_note = 'Pattern already captured in the failure register; bulk-applied W1-C2 RESTART-2026-09.',
       resolved_at = strftime('%s','now')
 WHERE id BETWEEN 2 AND 12
   AND status = 'open';
```

Expected: 15 rows and 11 rows changed. Run through the Cloudflare D1 console
or the D1 MCP tool; both statements are idempotent.

## Open access items noticed while doing this

- The Claude Code cloud environment has no `CLOUDFLARE_API_TOKEN` and its
  network policy blocks `*.workers.dev`, `api.cloudflare.com`,
  `campbellkane.app.n8n.cloud`, `api.notion.com` and `api.elevenlabs.io`.
  Until the token and those hosts are allowed, `wrangler deployments list`
  and live verification can only run from the Mac or CI.
- The n8n MCP connector in claude.ai lists only the seven workflows marked
  "available in MCP"; Step 3 (`BNBjoqXt…`) is not among them.
