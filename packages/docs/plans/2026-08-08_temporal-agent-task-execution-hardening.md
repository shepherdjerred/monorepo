---
id: temporal-agent-task-execution-hardening
type: plan
status: in-progress
board: true
verification: operator
disposition: blocked
---

# Temporal agent-task execution hardening

## Summary

Harden the two independent failure surfaces behind PD issues #7024, #7026,
and #7033, #7035, #7040, #7047, #7050, and #7058:

- Treat Claude structured output as a versioned provider contract. Generate a
  draft-07 schema, remove `$schema` and nonessential `format` annotations,
  validate the returned `structured_output` with Zod, and never parse prose or
  fenced JSON as fallback output.
- Replace aggregate timeout paging with one per-execution failure alert plus
  Temporal history classification and agent-task worker health signals.

## Implementation decisions

- Claude continues to run through
  `claude -p --output-format stream-json --verbose --json-schema <inline-schema>`.
- The Temporal image pins Claude Code `2.1.220`, above the `2.1.205` minimum
  where structured-schema failures could silently return unstructured text.
- Contract failures record the result subtype, result-message keys, schema
  fingerprint, and bounded redacted final-text excerpt. The metric has only
  provider and bounded failure-reason labels.
- `temporal-failure-watch` is the only per-execution workflow-failure PagerDuty
  producer. Its `WorkflowHandle.fetchHistory()` classification distinguishes workflow-task,
  activity, execution, and unknown timeouts. A workflow-task timeout before
  any activity is called out as a worker/task-queue availability failure.
- Prometheus warns after five minutes for missing agent-task workflow pollers,
  high workflow-task schedule-to-start latency, and worker metrics scrape loss.
  Replica and concurrency changes remain out of scope until these signals show
  starvation.

## Verification

- Focused Temporal tests cover draft-07 schema shape, annotation removal,
  valid output, missing `structured_output`, `is_error`, redaction, CLI flags,
  image version, and history classification.
- Homelab tests cover the rendered per-execution Alertmanager route and ensure
  removed aggregate timeout alert names cannot page.
- After deployment, run
  `bun run canary:agent-task` against the real `agent-task` queue with the
  worker image and OAuth token. Confirm the tagged report-only email and
  successful structured parsing.
- Keep this plan and
  `packages/docs/todos/homelab-audit-agent-task-production-verification.md`
  open until the canary is followed by seven successful daily
  `homelab-audit-daily` runs with one email per run and no duplicate timeout
  incidents.

## Remaining

- [ ] Build and deploy the Temporal worker image containing the contract and
      monitoring changes.
- [ ] Run the tagged production structured-output canary and record its
      workflow ID, run ID, parser success, and email delivery.
- [ ] Verify seven consecutive daily homelab audits and close the production
      verification TODO only after all seven pass.

## Comment Log

### 2026-08-08 — implementation started

- Replaced the hourly aggregate timeout watcher with the existing per-execution
  failure watch plus SDK worker-task guardrails.
- Added the Claude contract fingerprint, diagnostics, image minimum test, and
  operator canary command.

### 2026-08-08 — local verification boundary

- Focused Temporal tests pass (109 tests), and rendered homelab/Alertmanager
  tests pass (21 tests). Temporal typecheck reaches only pre-existing missing
  Glitter Context/LLM Models workspace artifacts; no changed-file diagnostics
  remain.
- The current cluster worker is still image `2.0.0-8036` with Claude Code
  `2.1.175`; deployment of the new image is still required. The local Docker
  daemon, production Temporal endpoint override, and Claude OAuth token are not
  available, so the canary and seven-day bake remain operator verification.
