---
id: reference-completed-2026-06-26-temporal-schedule-drift-catchup
type: reference
status: complete
board: false
---

# Temporal schedules: audit drift, stop replaying missed runs, document dynamic disable

## Context

Session started from "can we make an easy way to disable workflows from Temporal?" and
evolved through three asks about the homelab Temporal worker's recurring schedules
(`packages/temporal/src/schedules/register-schedules.ts`, upserted on every worker startup
by `registerSchedules()`):

1. **Disable a schedule live (e.g. the wake-up)** — already possible via the Temporal Web UI
   (`https://temporal-ui.tailnet-1a49.ts.net`); a UI pause persists across worker restarts
   (verified against `@temporalio/client@1.17.2`: `handle.update` spreads `...prev` so
   `state.paused` round-trips, and `reconcileSchedulePauseState` only auto-unpauses the two
   env-gated `pr-review-*` schedules). No code needed — documented instead.
2. **Don't replay runs missed by more than a small margin** after an outage — schedules set
   `overlap: SKIP` but never `catchupWindow`, so the replay margin fell to an ambiguous
   server default. Fixed with explicit, intent-based windows.
3. **List all live schedules and ensure each is in source** — a read-only audit found one
   orphan.

## Live-vs-source audit (2026-06-26, `admin@torvalds`, namespace `default`)

Read-only `kubectl port-forward` to the Temporal UI API
(`/api/v1/namespaces/default/schedules`), set-diffed against the declared `SCHEDULES` and
`DELETED_SCHEDULE_IDS`.

- **24 live vs 23 declared.** Every declared schedule exists live.
- **1 orphan — `pokeemerald-wasm-monthly`**: renamed to `pokeemerald-wasm-weekly` but the old
  id was never added to the delete list, so it kept firing a redundant `runPokeemeraldWasmUpdate`
  on the 1st of each month (next fire 2026-07-01).
- Pause-state drift (expected/intentional): `good-morning-weekend-{wake,up}` manually paused;
  `pr-review-{eval-nightly,ab-weekly-report}` paused by env-config gating.

## What shipped

### A. Delete the orphan — `register-schedules.ts`

Added `pokeemerald-wasm-monthly` to `DELETED_SCHEDULE_IDS` (with the rename rationale). The
existing startup delete loop removes it.

### B. Intent-based `catchupWindow` — `register-schedules.ts`

`catchupWindow` governs replay only when the Temporal **server** was down across a scheduled
time (a worker restart does not drop runs). Two tiers via a new `buildSchedulePolicies()`
used by both the create and update branches:

- `CATCHUP_TIGHT = "5 minutes"` on the 7 time-of-day home schedules (3 vacuum + 4
  good-morning) — skip rather than fire late.
- `CATCHUP_RELAXED = "1 hour"` default for everything else — reports/maintenance still run
  late after an outage. New optional `catchupWindow?` field on `ScheduleDefinition` allows
  per-schedule override.

### C. Orphan detection — `src/schedules/orphan-detection.ts` (new)

`detectOrphanSchedules()` runs at the end of `registerSchedules`, lists live schedules, and
sets the new `temporal_schedule_orphans` gauge (`src/observability/metrics.ts`) + warns for
any id that is neither declared, nor on the delete list, nor a dynamic agent-task schedule
(`agent-task-` id prefix or `dynamicAgentTask` memo marker — not the workflow type, which a
declared schedule can share). Non-destructive (auto-delete is unsafe given the dynamic
`/agent-tasks` schedules); detection failure is logged + sets the gauge to `-1`, never fatal.
**Alert on `temporal_schedule_orphans > 0` (orphan found) and `< 0` (detection failed).**

### Docs / tests

- `packages/temporal/AGENTS.md` — new "Schedules" section (pause-via-UI + schedule→feature
  table, catchup tiers, orphan detection).
- `register-schedules.test.ts` — catchup-window tiers + orphan classification cases
  (53 tests pass).

## Pause-state model (decision)

Existence + cron + workflow + policy = source-controlled; **pause on/off = runtime/dynamic
(Temporal UI)**, intentionally not in source. A declarative `enabled` flag was rejected
because authoritative reconcile would revert live UI pauses.

## Verification

- `cd packages/temporal && bun run typecheck` — clean.
- `bun test src/schedules/register-schedules.test.ts` — 53 pass.
- `bunx eslint` on changed files — clean.
- `bun test src/workflows/bundle.test.ts` — pass (the metrics import stays out of the
  workflow bundle; orphan-detection lives in a host-context module).
- Post-deploy: re-run the UI-API set-diff (expect 23 live = 23 declared, zero orphans);
  `temporal schedule describe --schedule-id vacuum-9am` → `Catchup Window: 5m0s`,
  `dns-audit-daily` → `1h0m0s`.

## Out of scope / follow-ups

- Worker-down (not server-down) late execution of a home run — would need a workflow-level
  staleness guard inside `goodMorningWakeUp` / `runVacuumIfNotHome`.
- A Prometheus alert rule on `temporal_schedule_orphans > 0` (homelab side).

## Session Log — 2026-06-26

### Done

- `packages/temporal/src/schedules/register-schedules.ts` — added `pokeemerald-wasm-monthly`
  to `DELETED_SCHEDULE_IDS`; added `CATCHUP_TIGHT`/`CATCHUP_RELAXED` + optional
  `catchupWindow` field + `buildSchedulePolicies()`; tightened the 7 home schedules; wired
  `detectOrphanSchedules`.
- `packages/temporal/src/schedules/orphan-detection.ts` — new module (`isOrphanSchedule`,
  `detectOrphanSchedules`).
- `packages/temporal/src/observability/metrics.ts` — new `temporal_schedule_orphans` gauge.
- `packages/temporal/src/schedules/register-schedules.test.ts` — catchup + orphan tests.
- `packages/temporal/AGENTS.md` — Schedules section.
- Verified: typecheck, eslint (changed files), 53 tests, workflow-bundle smoke test.

### Remaining

- Open PR + land; after deploy confirm the orphan is gone and catchup windows are applied.
- Optional: add the `temporal_schedule_orphans > 0` Prometheus alert in homelab.

### Caveats

- `catchupWindow` only addresses **server**-outage replay; a long worker outage can still run
  a home schedule late (server created the action on time). Documented; staleness-guard
  follow-up noted.
- Orphan classifier no longer treats `workflowType === "agentTaskWorkflow"` as proof of a
  dynamic schedule (that gap would have silently exempted the declared `homelab-audit-daily`
  if it were ever removed from source). A schedule is dynamic only via the `agent-task-` id
  prefix or the `dynamicAgentTask` memo marker stamped at creation by the `/agent-tasks` API.
  Trade-off: a **custom-id** dynamic schedule created before this marker existed (no prefix,
  no marker) will surface as an orphan once until it is re-created; this is non-destructive
  (gauge + log only) and self-corrects on the next API call for that schedule.
- `temporal_schedule_orphans = -1` is a sentinel meaning the live-schedule listing failed
  (count unknown), so a detection outage is distinguishable from a clean "no orphans" result.
  Alert on `< 0` in addition to `> 0`.
