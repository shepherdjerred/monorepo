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

`--json-schema` **wedges claude-code 2.1.143**. Reproduced in the worker pod:

| Output config                                                | Result                     |
| ------------------------------------------------------------ | -------------------------- |
| `--output-format json --json-schema` (**exact prod config**) | 30s, **zero output**, hang |
| `--output-format json` (no schema)                           | 2s, 986 B ✓                |
| `--output-format stream-json --verbose` (no schema)          | 2s, 3150 B ✓               |

On a trivial prompt the hang caps at ~30s; in production (15 turns + tools) it ran to
the 30-min activity wall. `--json-schema` was present in the _original_ alert-remediation
commit (`c2cfca589`) — the agents never worked. Both hanging paths (alert-remediation +
agent-task) used `--json-schema`; the dormant bespoke homelab-audit path didn't.

A second, independent bug: the page meant to catch this,
`AlertRemediationDecisionsAllFailing`, used `rate()` + `clamp_min(denom, 1)` and
evaluated to ~0.0017 — mathematically incapable of exceeding `0.5`, so it never fired
even at 100% failure.

Why it stayed invisible: `claude` writes everything to **stdout** (NDJSON) and is silent
on stderr, but the wrapper read stdout as one buffered blob at process close and the idle
detector watched **stderr only** → `idleMs == elapsedMs` always ("looks wedged" whether
working or hung). We were blind to the subprocess entirely.

## What shipped

**Cure**

- Dropped `--json-schema` from both claude command builders
  (`activities/alert-remediation-command.ts`, `activities/agent-task-command.ts`); the
  required output shape is now embedded in the prompt (`buildAlertRemediationPrompt`,
  `reportOnlyPrompt`) and validated app-side by `parseAgentPayload` (Zod). Codex keeps
  its file-based `--output-schema`.
- `extractJsonPayload` (`shared/claude-result.ts`) tolerates ```json fences / surrounding
  prose now that the CLI no longer forces raw JSON.

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

- temporal: `bun run typecheck` ✓, `bun test` (575) ✓, `bun run test:e2e` ✓, eslint ✓.
- homelab: `bun run typecheck` ✓, `cd src/cdk8s && bun test` (141) ✓, eslint ✓; both
  changes confirmed in `dist/temporal.k8s.yaml` + `dist/apps.k8s.yaml`.
- In-pod repro proved `--json-schema` is the hang and `stream-json` works.

## Session Log — 2026-06-19

### Done

- Found + proved the root cause (`--json-schema` wedges claude); shipped the drop + the
  stream-json observability overhaul + SIGKILL escalation + the page `rate→increase` fix +
  the local-Temporal e2e test and two harness scripts. All gates green (see Verification).

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
