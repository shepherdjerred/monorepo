---
id: homelab-audit-agent-task-production-verification
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/archive/superseded/agent-task-workflow-broken.md
---

# Verify homelab-audit agent tasks in production

The historical timeout and JSON-schema invocation defects had code fixes, but
the underlying `structured_output` failure **regressed** on 2026-07-28
(`b4dd81cc9`, "fix(ci): restore observability acceptance reporting #1785").
On 2026-07-30 a fix was applied based on the leading (but **unconfirmed**)
hypothesis for that regression — see the caveat below for why local
reproduction could not prove it. The remaining question is whether
`homelab-audit-daily` now runs cleanly on the deployed generic
`agentTaskWorkflow` path with the split Claude/Codex schema constants, which is
also what will confirm or refute the hypothesis.

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
- Leading hypothesis for the 07-30 error (from code archaeology, **not**
  empirically confirmed): commit `b4dd81cc9` (2026-07-28) changed the single
  shared `AGENT_TASK_OUTPUT_JSON_SCHEMA` constant from a hand-written plain
  JSON Schema to one generated via OpenAI's `zodResponseFormat()` (strict mode:
  every field required, optional fields nullable) — fed to **both** Claude's
  `--json-schema` and Codex's `--output-schema`. Codex needs strict mode (that
  was the PR's real, correct motivation); the hypothesis is that Claude's
  `--json-schema` silently drops `structured_output` entirely when given the
  strict/nullable dialect. This is unproven — see the caveat below.
- Fix: split into `AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE` (plain, generated via
  `z.toJSONSchema(AgentTaskResultPayloadSchema)`) and
  `AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX` (strict, unchanged), plus an
  `is_error` diagnostic check on the Claude branch mirroring
  `homelab-audit.ts`'s existing pattern.
- **Caveat — empirical verification was inconclusive.** Local reproduction
  against the exact pinned production CLI (`@anthropic-ai/claude-code@2.1.175`)
  never populated `structured_output` under any combination of schema/model/
  output-format tried, including the historically-working configuration
  (plain schema + `claude-opus-4-8`). This means the schema-dialect
  explanation is the best available one from code archaeology, but is **not**
  empirically proven — local repro isn't a trustworthy oracle here (likely an
  auth/entitlement or real-agentic-run difference between an interactive
  session and the worker pod's `CLAUDE_CODE_OAUTH_TOKEN`). Production is the
  real verification environment.

## Remaining

- [ ] Confirm the deployed worker picks up the split-schema fix and inspect
      the next `homelab-audit-daily` execution (cron `30 6 * * *` PT) via
      `https://temporal-ui.tailnet-1a49.ts.net` → Schedules →
      `homelab-audit-daily`, or
      `temporal workflow list --query "WorkflowId STARTS_WITH 'homelab-audit-daily'"`
      (`TEMPORAL_ADDRESS=temporal.tailnet-1a49.ts.net:443 --tls`). Expect
      `WORKFLOW_EXECUTION_STATUS_COMPLETED` and a real report email via Postal.
- [ ] If it still fails, use its activity error (now more diagnostic thanks to
      the `is_error` check) to determine whether the schema-dialect fix was
      insufficient, and escalate to comparing against a real production trace
      via the `llm-archive` S3 bucket (`llm/temporal-worker/claude_code_cli/`)
      rather than further local CLI reproduction.
- [ ] Record seven consecutive explicit terminal outcomes, including at least
      one successful report email, with no timeout, schema, or silent
      subprocess loss.

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

## Session Log — 2026-08-02

### Done

- Cleared the deployment prerequisite and identified the exact pre-deploy run that must not be mistaken for current verification.

### Remaining

- Inspect the first post-deploy daily run, confirm a real report email, and accumulate the required terminal outcomes.

### Caveats

- The schema-dialect root-cause hypothesis remains unconfirmed until post-deploy production evidence exists.
