---
id: homelab-audit-agent-task-production-verification
type: todo
status: in-progress
board: true
verification: operator
disposition: blocked
origin: packages/docs/archive/superseded/agent-task-workflow-broken.md
---

# Verify homelab-audit agent tasks in production

The historical timeout and JSON-schema invocation defects produced PD issues
and #7024, #7026, #7033, #7035, #7040, #7047, #7050, and #7058. The durable fix is
tracked in
[`2026-08-08_temporal-agent-task-execution-hardening.md`](../plans/2026-08-08_temporal-agent-task-execution-hardening.md): Claude now has a
versioned draft-07 contract, and timeout diagnosis is per execution with
worker-task health signals rather than an aggregate timeout pager.

## What happened (2026-07-30 investigation)

- `homelab-audit-daily` (provider `claude`) succeeded through 2026-07-16, then
  failed continuously:
  - 2026-07-17 → 2026-07-26: `claude agent task exited with code 1`, no
    captured stdout — a distinct, still-unexplained failure mode (see the new
    `homelab-audit-nonzero-exit-2026-07-17-to-26` todo).
  - 2026-07-27 → 2026-07-29: `stop_sequence`/quota-related failures
    (2026-07-29 was a Claude weekly-subscription-quota 429).
  - 2026-07-30: the exact error `agent produced no structured output
(expected --json-schema structured_output / --output-schema file)` at
    `packages/temporal/src/shared/agent-task.ts:173`.
- The original leading hypothesis was that Claude's `--json-schema` silently
  dropped `structured_output` when fed Codex's strict/nullable dialect. The
  long-term contract now makes that provider boundary explicit: Claude gets a
  draft-07 plain-optional schema, while Codex keeps its strict wire schema.
- The Claude schema is stripped of `$schema` and `format`, fingerprinted, and
  semantically validated with Zod. A successful Claude process without
  `structured_output` is still a failure; prose and fenced JSON are never
  accepted. Contract failures record bounded subtype, result-message keys,
  schema fingerprint, and redacted final-text diagnostics.
- The image pins Claude Code `2.1.220`, above the `2.1.205` minimum enforced by
  the command/image tests. The old aggregate timeout watcher and rules are
  removed; `temporal-failure-watch` fetches history and reports workflow-task,
  activity, execution, or unknown classification, explicitly calling out a
  workflow-task timeout before any activity as worker/task-queue availability.
- Prometheus warns after five minutes for agent-task workflow poller loss,
  schedule-to-start latency, or worker metrics scrape loss.

## Remaining

- [ ] Build and deploy the worker image containing the `2.1.220` Claude CLI
      pin; record the deployed image digest.
- [ ] Run `bun run canary:agent-task` with the production Temporal address and
      `CLAUDE_CODE_OAUTH_TOKEN`; record workflow ID, run ID, successful parser
      outcome, and the tagged `[agent-task-canary]` email.
- [ ] Record seven consecutive `homelab-audit-daily` terminal outcomes as
      `COMPLETED`, with successful structured parsing, one Postal delivery per
      run, and no duplicate timeout incidents.
- [ ] Confirm the queue-health alerts remain inactive during the bake window;
      if one fires, inspect poller/schedule-to-start evidence before changing
      replicas or concurrency.

## Operator-only post-deploy canary

Run this once after deploying the worker image. It starts a real
`agentTaskWorkflow` and sends a tagged report email, so it must not be included
in the recurring report-only homelab audit:

```bash
cd packages/temporal
TEMPORAL_ADDRESS=temporal.tailnet-1a49.ts.net:443 \
TEMPORAL_TLS=true \
  bun run canary:agent-task
```

Record the workflow ID, run ID, successful structured parsing, and the tagged
`[agent-task-canary]` email in the remaining checklist above.

## Comment Log

### 2026-07-27 — split from workflow umbrella

- Created as the sole current production-health criterion for the scheduled
  audit workflow.

### 2026-07-30 — regression found, hypothesized fix applied

- Live Temporal cluster + git history investigation found the exact failure
  had regressed on 2026-07-28 (correlated with the schema-dialect change), not
  merely "not yet proven fixed" as this doc previously implied. A fix was
  applied via the Claude/Codex schema split (see PR) on the leading hypothesis
  that the strict/nullable dialect breaks Claude's `--json-schema`. Local
  empirical verification of the fix was inconclusive (see caveat above), and
  the schema, model, and turn limit all differed between the compared runs, so
  the schema dialect is not isolated as the cause — status kept at
  `in-progress` pending the real production cron run rather than marked
  complete. Treat the schema-dialect explanation as unconfirmed until that run
  (or an independent reproduction) confirms it.

### 2026-08-02 — deployment prerequisite satisfied

- Confirmed the current healthy Temporal worker `2.0.0-7749` contains PR #1864.
- The latest run `019fc2aa-c7ed-71a2-a940-ae400bee948a` predates that deployment and failed with `agent produced no structured output`, so it is not acceptance evidence for the deployed fix.

### 2026-08-08 — long-term hardening implemented

- The implementation and focused tests are complete in source; production
  acceptance remains intentionally open until the image canary and seven daily
  audits provide evidence.
- The current cluster worker is still on `2.0.0-8036` with Claude Code
  `2.1.175`; build/deploy of the `2.1.220` image is therefore still required.
- The local workspace has no production Temporal endpoint override or
  `CLAUDE_CODE_OAUTH_TOKEN`, so the tagged canary was not run.
