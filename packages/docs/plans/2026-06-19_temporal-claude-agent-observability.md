# Temporal `claude -p` agents: root-cause fix + observability + local testing

## Status

Complete (branch `feat/temporal-agent-stream-obs`; verified locally, pending PR + deploy)

## Context

The `temporal` Bugsink project was dominated by one problem: the alert-remediation
agent (and the generic agent-task) `claude -p` subprocesses spawned, produced **zero
output for ~30 minutes**, ignored the soft-kill SIGINT, and were hard-killed
(SIGTERM/143) at the activity timeout. 24h Prometheus before the fix: 108 runs, 100%
SIGTERM, **zero successes**. It survived multiple cycles because each cycle added
_wrapper_ instrumentation while the subprocess stayed a black box (#1230 was explicitly
"instrument first" — it never found the cause).

### Root cause (found this session, proven in-pod)

We passed `--json-schema` a **file path**, but the flag takes the **schema JSON inline**.
claude-code wedges on the path string (zero output until killed). `--json-schema` itself
is **not** broken — it works when given the schema content inline. Reproduced in the
worker pod:

| Invocation                                              | Result                                          |
| ------------------------------------------------------- | ----------------------------------------------- |
| `--json-schema schema.json` (file path — **prod code**) | 30s, **zero output**, hang                      |
| `--json-schema '{...inline...}'` (real alert schema)    | 26s real work, `is_error:false`, valid output ✓ |

Second fact: the schema-validated object comes back in the result message's
**`structured_output`** field, **not** `result` (the model's prose). Our code read
`.result` — also wrong. Both bugs were present in the _original_ alert-remediation commit
(`c2cfca589`), so the agents never worked. On a trivial prompt the file-path hang caps at
~30s; in production (15 turns + tools) it ran to the 30-min activity wall. Both hanging
paths (alert-remediation + agent-task) used the file path; the dormant bespoke
homelab-audit path didn't.

A second, independent bug: the page meant to catch this,
`AlertRemediationDecisionsAllFailing`, used `rate()` + `clamp_min(denom, 1)` and
evaluated to ~0.0017 — mathematically incapable of exceeding `0.5`, so it never fired
even at 100% failure.

Why it stayed invisible: `claude` writes everything to **stdout** (NDJSON) and is silent
on stderr, but the wrapper read stdout as one buffered blob at process close and the idle
detector watched **stderr only** → `idleMs == elapsedMs` always ("looks wedged" whether
working or hung). We were blind to the subprocess entirely.

## What shipped

**Cure** (use the native feature correctly — not drop it)

- Pass `--json-schema` **inline** (`JSON.stringify(<SCHEMA>)`, never a file path) in both
  claude command builders (`activities/alert-remediation-command.ts`,
  `activities/agent-task-command.ts`). Codex keeps its file-based `--output-schema`.
- Read the validated object from the result message's **`structured_output`** field
  (`shared/claude-result.ts` adds it to `ClaudeResultMessage`); `parseAgentPayload`
  validates it with the existing Zod schema and fails fast if it's absent. Codex still
  reads its `--output-last-message` file. (An interim "drop the flag + prompt-coax JSON +
  `extractJsonPayload`" approach was abandoned once the inline fix was found.)

**Observability** (shared, benefits both active `claude -p` activities)

- `--output-format json` → `--output-format stream-json --verbose`.
- `shared/agent-subprocess.ts`: added a stdout NDJSON line-pump symmetric to stderr;
  idle/hang detection is now **output-agnostic** (`OutputState`, was stderr-only);
  `maxIdleMs` includes the trailing gap so a zero-output run reports
  `maxIdleMs == durationMs`; added `firstOutputLatencyMs` (undefined = never spoke);
  **SIGINT→SIGKILL escalation** (`SIGKILL_GRACE_MS`, overridable via `sigkillGraceMs`)
  reclaims the slot instead of waiting ~90s for Temporal's SIGTERM.
- `parseClaudeResultMessage` is NDJSON-aware (finds the last `type:"result"`) with legacy
  single-object fallback; `summarizeClaudeStreamLine` emits per-turn `phase=agent-event`
  logs (system init, assistant turns + tool names, result) wired in both activities.
- Worker env hygiene (defensive, not the cure): `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`,
  `DISABLE_AUTOUPDATER=1` (`cdk8s/.../temporal/worker.ts`).

**Page fix** — `AlertRemediationDecisionsAllFailing` `rate()` → `increase()`
(`cdk8s/.../rules/temporal.ts`); verified the fixed expr = 1.0 > 0.5 at 100% failure.

**Local testing** (per request)

- `src/alert-remediation.e2e.test.ts` — real local Temporal (`createLocal`) with a real
  worker running the real `runAlertRemediationAgent` against a PATH-injected fake `claude`
  (zero prod change; `agentEnv` passes PATH). Proves the full
  worker→activity→stream-json→parse loop. Run via `bun run test:e2e` (out of the default
  suite).
- `scripts/run-alert-remediation-local.ts` (Layer-2, real claude) and
  `scripts/trigger-alert-remediation.ts` (one child workflow vs `localhost:7233`).

## Verification

- temporal: `bun run typecheck` ✓, `bun run test` (571) ✓, `bun run test:e2e` ✓, eslint ✓.
  (Bare `bun test` shows false failures: it pulls in `integration.test.ts`, which needs a
  live `localhost:7233`, and the e2e file, whose `mock.module` leaks into
  `github-app-token.test.ts`. CI runs `bun run test`, which excludes both.)
- homelab: `bun run typecheck` ✓, `bun run test` ✓, eslint ✓; both changes confirmed in
  `dist/temporal.k8s.yaml` + `dist/apps.k8s.yaml`.
- In-pod repro proved the real root cause (file-path-vs-inline) and that inline
  `--json-schema` + `stream-json` works end-to-end with `structured_output`.

## Session Log — 2026-06-19

### Done

- Found + proved the root cause: `--json-schema` was handed a **file path** (it needs the
  schema **inline**) AND we read `.result` instead of `.structured_output`. Shipped the
  correct native usage (inline `--json-schema` + read `structured_output`) plus the
  orthogonal wins — stream-json observability overhaul, SIGKILL escalation, the page
  `rate→increase` fix, the local-Temporal e2e test, and two harness scripts. PR #1264.
  (An interim "drop the flag" approach was committed first, then corrected once the inline
  fix was found — the user flagged that dropping a working native feature over our own bug
  was the wrong call.)

### Remaining

- Open PR, monitor CI, deploy. Post-deploy: tail one hourly sweep
  (`kubectl logs -n temporal deploy/temporal-temporal-worker -f | grep -E
'"phase":"agent-event"|"phase":"exited"|decision'`) and confirm
  `alert_remediation_decisions_total{outcome!="failed"}` returns + the page can fire.
- Bulk-resolve the 228 Bugsink dupes via the web-UI bulk action once green
  (REST API is read-only — see `reference_bugsink_resolve_via_ui`).
- Optional follow-up: apply the same stream-json treatment to the dormant bespoke
  `homelab-audit.ts` (its own spawn loop; uses `--output-format json`, no `--json-schema`,
  so it doesn't hang — left untouched).

### Caveats

- Dropping `--json-schema` means output correctness now rests on prompt instructions +
  app-side Zod (`parseAgentPayload` + `extractJsonPayload`). Watch the first real runs for
  parse failures.
- The e2e test uses `mock.module` (process-wide) but runs in its own process (test:e2e),
  so no cross-file leak. `createLocal` boots a real test server (~2-30s).
