# CI on main failing — diagnosis (build #3360)

## Status

Complete — fixes applied and verified (diagnosis + remediation)

## Root cause of the temporal Test flake (confirmed)

`src/activities/agent-task.test.ts:84` called `mock.module("#activities/agent-task-command.ts", () => ({ buildAgentTaskCommand }))` — a mock that returns **only** `buildAgentTaskCommand`. Bun's `mock.module` is process-wide and not auto-restored between files, and `#activities/agent-task-command.ts` resolves to the **same file** as the relative `./agent-task-command.ts`. When `alert-remediation-command.test.ts` ran _after_ it (nondeterministic file order), importing `reportOnlyPrompt` from `./agent-task-command.ts` hit the leaked mock, which lacks that export → `SyntaxError: Export named 'reportOnlyPrompt' not found`. The whole file aborts → CI's "1 fail, 1 error".

## Fixes applied

| #   | File                                                                        | Change                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/activities/agent-task.test.ts`                                         | Spread the real module into the mock (`...agentTaskCommandModule`) so a leaked mock keeps every real export; only `buildAgentTaskCommand` is overridden. Kills the flake.         |
| 2   | `src/observability/tracing.integration.test.ts`, `logs.integration.test.ts` | Add `metrics.disable()` to `afterAll` — resets the global MeterProvider `NodeSDK.start()` registers, removing the `Attempted duplicate registration of API: metrics` error noise. |
| 3   | `src/schedules/register-schedules.test.ts`                                  | Register `alertRemediationSweepWorkflow` in `WORKFLOWS_WITHOUT_LONG_SLEEPS` (no in-workflow `sleep()`). Fixes the deterministic assertion failure.                                |
| 4   | `package.json`                                                              | Add `src/schedules` to the `test` script so CI actually runs the schedule tests (this whole class of bug was previously invisible to CI).                                         |

## Verification

- New CI scope (`bun run test`) run **6×**: 504 pass, 0 fail, 0 anomalies each time (no "export not found", no duplicate-registration).
- Forced previously-flaky order (`agent-task.test.ts` then `alert-remediation-command.test.ts`) **3×**: 3 pass, 0 fail each.
- Both observability integration tests in one process: 2 pass, no duplicate-registration log.
- `register-schedules.test.ts`: 31 pass, 0 fail.
- `bun run typecheck`: clean. `bunx eslint` on all changed files: clean.

Note: the **Caddyfile Validate** failure was a Dagger snapshot/cache infra flake (`fail 0`, validation passed) — no code change; clears on retry.

## Question

Why is CI on `main` failing?

## Build under investigation

- Buildkite `monorepo` build **#3360**, commit `008222cb5` (`fix(root): address PR review findings…`), state `failing`.
- Prior main builds #3341–#3359 were mostly `canceled`/`skipped` (superseded by newer pushes), so #3360 is the first build in a while to run to completion. `d406f8356 fix(temporal): trigger CI rebuild` was an earlier attempt to force a green temporal run.

## Failing jobs

`bk build view 3360` → 4 non-zero jobs, only **2 are hard failures**:

| Job                                         | Hard?        | Verdict                                            |
| ------------------------------------------- | ------------ | -------------------------------------------------- |
| `:test_tube: Test` (temporal)               | yes (exit 1) | **Flaky test-runner module-load race**             |
| `:globe_with_meridians: Caddyfile Validate` | yes (exit 1) | **Dagger engine infra flake** (not a real failure) |
| `:warning: Large File Check`                | soft_fail    | does not turn build red                            |
| `:shield: Trivy Scan`                       | soft_fail    | does not turn build red                            |

## 1. temporal Test — flaky module-load failure (the real blocker)

CI error inside `bun run test`:

```
src/activities/alert-remediation-command.test.ts:
# Unhandled error between tests
SyntaxError: Export named 'reportOnlyPrompt' not found in module
  '/workspace/packages/temporal/src/activities/agent-task-command.ts'.
...
471 pass, 1 fail, 1 error  (1 fail + 1 error = this one file failing to load)
```

Findings:

- The export **does** exist (`agent-task-command.ts:17 export function reportOnlyPrompt`). All static imports in the graph resolve (`#shared/agent-task.ts` exports `AGENT_TASK_OUTPUT_JSON_SCHEMA` + `AgentTaskInput`; no circular imports). So this is a **runtime module-binding cascade**, not a source bug.
- Bun is identical CI vs local: `oven/bun:1.3.14` (`.dagger/src/constants.ts`) == local `1.3.14`. CI runs `bun run test` = `bun test src/activities src/event-bridge src/observability src/shared src/workflows src/lib` (package.json:21).
- Reproduced locally: running the **exact scoped command** failed once with `1 fail` (matching CI's 472-test count), then **passed 6 consecutive runs** (473 tests, 0 errors). ~1-in-7 flake.
- Likely trigger: Bun module-cache poisoning interacting with global side effects from the observability integration tests in the same process (`tracing.integration.test.ts` / `logs.integration.test.ts` emit `@opentelemetry/api: Attempted duplicate registration of API: metrics` when `initializeTracing` runs twice). Test-file load order is nondeterministic.
- Introduced with `c2cfca589 feat(temporal): add alert remediation fanout` (added both the test file and `agent-task-command.ts`/`alert-remediation-command.ts`).

## 2. Caddyfile Validate — Dagger infra flake (not a real failure)

```
ℹ fail 0                              # zero caddy validation failures
caddy validate … "adapted config to JSON"   # validation itself succeeded
✘ .caddyfileValidate(): ERROR
! failed to get mod meta file: failed to commit … during finalize:
  failed to stat active key during commit: snapshot … does not exist: not found
```

The caddy validation passed (`fail 0`, only a `caddy fmt` formatting _warning_). The job died on a Dagger/BuildKit **snapshot/cache** error during finalize. Transient — a retry clears it.

## Bonus: a real bug CI does NOT catch

`src/schedules/register-schedules.test.ts` fails **deterministically** locally:

```
schedule timeout vs workflow sleep > alert-remediation-hourly timeout exceeds known sleeps + slack
expect(received).toContain(expected)
Expected to contain: "alertRemediationSweepWorkflow"
```

The new `alertRemediationSweepWorkflow` (alert-remediation-hourly schedule) was added without registering it in `WORKFLOW_MAX_SLEEP_MS` or `WORKFLOWS_WITHOUT_LONG_SLEEPS`. **CI's temporal `test` script does not include `src/schedules`**, so this gap is invisible to CI today (`test:integration` and `src/schedules` are out of the default test scope).

## Recommended next steps (not yet done)

1. Retry the 2 failed jobs — Caddyfile will pass; Test passes ~6/7 of the time. (Stopgap, not a fix.)
2. Real fix for the flake: guard `initializeTracing` against duplicate OTel global registration, and/or split the observability integration tests out of the default `test` scope (they already exist as a separate concern). Follow the temporal AGENTS.md guidance about keeping helpers in pure `src/shared/` modules free of observability imports.
3. Fix the schedule-timeout bug: register `alertRemediationSweepWorkflow` in the schedule bookkeeping, and **add `src/schedules` to the `test` script** so CI catches this class of bug.

## Session Log — 2026-06-06

### Done

- Identified build #3360 on main as failing; enumerated failing jobs via `bk`.
- Diagnosed temporal `Test` as a Bun `mock.module` leak (agent-task.test.ts's partial mock stripping `reportOnlyPrompt` from a sibling file under nondeterministic file order); reproduced.
- Diagnosed `Caddyfile Validate` as a Dagger snapshot infra flake (validation itself passed, `fail 0`).
- Found + fixed a real, CI-invisible bug: `alertRemediationSweepWorkflow` missing from `register-schedules.test.ts` bookkeeping; `src/schedules` not in CI test scope.
- Applied 4 fixes (see Fixes applied table) and verified: 6× clean full-scope runs, forced-order runs clean, typecheck + eslint clean.

### Remaining

- Not committed/pushed yet — awaiting go-ahead to commit on `claude/vibrant-hopper-1051ad` and open a PR.
- `Caddyfile Validate` needs a CI job retry (infra flake; no code change possible).

### Caveats

- The temporal Test flake was order-dependent; the spread-mock fix is deterministic, but the underlying Bun behavior (process-wide `mock.module`, no per-file restore) affects any partial module mock — prefer spreading real exports in future mocks.
- Worktree `vibrant-hopper-1051ad` had `scripts/setup.ts` run to install deps for local reproduction.
