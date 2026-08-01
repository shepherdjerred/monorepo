---
id: homelab-audit-nonzero-exit-2026-07-17-to-26
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/plans/2026-07-30_homelab-audit-agent-task-schema-fix.md
---

# Investigate homelab-audit-daily's 2026-07-17 → 2026-07-26 non-zero-exit failures

Discovered while root-causing the 2026-07-30 `homelab-audit-daily` schema
regression: a separate, still-unexplained failure mode preceded it. From
2026-07-17 through 2026-07-26 (11 consecutive daily runs), the workflow failed
with:

```
claude agent task exited with code 1 (signal=natural, durationMs=<1s-235s>)
```

This is a **non-zero exit code**, caught by a different branch in
`packages/temporal/src/activities/agent-task.ts` (`agentSubprocessFailure`)
than the schema/`structured_output` bug fixed on 2026-07-30 — it never even
reaches `parseAgentTaskResultPayload`. It is not explained by, and not fixed
by, the schema-dialect fix.

The real production LLM trace archive (S3 `llm-archive` bucket,
`llm/temporal-worker/claude_code_cli/`) shows every `agent-task` trace in this
window has `finishReasons: ["tool_use"]` — the model's last captured turn was
requesting a tool call when the process terminated with exit code 1. This is
consistent with hitting `--max-turns` (8 at the time, later bumped to 40)
while mid-tool-call, but that is a hypothesis, not confirmed — Temporal
history doesn't retain stdout/stderr for a non-retried single-attempt
activity failure (`maximumAttempts: 1`), so the actual CLI stderr/exit detail
for these specific runs is not recoverable from Temporal alone.

## Remaining

- [ ] Check Loki (`{namespace="temporal"} | json | component="agent-task"`)
      or Sentry/Bugsink for captured stderr/exception detail from this exact
      window (2026-07-17 to 2026-07-26), if retention still covers it.
- [ ] If `--max-turns` exhaustion mid-tool-call is confirmed as the cause,
      consider whether the current `maxTurns: 40` (bumped after this window)
      is sufficient headroom, or whether the activity should distinguish
      "hit max-turns" from a generic non-zero exit for clearer diagnostics
      (mirroring the `is_error` check added for the schema bug).
- [ ] Since `maxTurns` was already bumped 8→40 before this todo was filed, and
      no repeat of this exact symptom has recurred since, this may already be
      moot — confirm via the trace archive whether any `tool_use`-finishing,
      non-zero-exit run has occurred since the bump before spending more time
      here.

## Comment Log

### 2026-07-30 — filed during homelab-audit-daily schema regression investigation

- Split out as a separate, unrelated failure mode from the schema/
  `structured_output` bug (see
  `packages/docs/todos/homelab-audit-agent-task-production-verification.md`)
  so it isn't conflated with that fix's scope.
