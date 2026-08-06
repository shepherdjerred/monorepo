---
id: reference-completed-2026-06-06-temporal-health-fixes
type: reference
status: complete
board: false
---

# Temporal Health Fixes

## Context

A homelab audit surfaced several misconfigurations in the Temporal worker:

- **PR bot dead (swallowed 429s):** Every specialist pass in the pr-review pipeline was failing with HTTP 429 `rate_limit_error`, but the error was swallowed, so the bot posted "0 findings" on every PR. Added a master kill switch (`PR_BOT_ENABLED`) so the webhook acks deliveries without spinning up workflows, pending a fix to the rate-limit handling.
- **Schedule/timeout misconfigs:** The homelab-audit-daily workflow ran 8 turns (~25 min) but had an 8-min agent timeout and 10-min workflow execution timeout — killing it every run. The `leavingHome` trigger workflow ran ~750s but hit the 10-min default. Alert-remediation children had a 90-min activity timeout and 2-hour child execution timeout that could stall the hourly sweep window.
- **2 orphaned schedules:** `good-morning-weekday-early` and `good-morning-weekend-early` reference workflow types that were removed; they fired and failed on every tick. Added an explicit deletion list pruned on startup.
- **Retention too short:** 7-day retention (168h) meant weekly workflow history was lost before the next run, making debugging impossible. Bumped to 30 days (720h).

## Changes

| #   | File                                                                  | Change                                                                                      |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A   | `packages/temporal/src/event-bridge/github-webhook.ts`                | Add `isPrBotEnabled()` helper + kill switch check before draft/workflow branches            |
| A   | `packages/temporal/src/event-bridge/github-webhook.test.ts`           | Test: `PR_BOT_ENABLED=false` → 200, body "pr-bot disabled", `start`/`postStatus` not called |
| A   | `packages/homelab/src/cdk8s/src/resources/temporal/worker.ts`         | Add `PR_BOT_ENABLED: "false"` env var above `PR_REVIEW_POST_ENABLED`                        |
| B   | `packages/temporal/src/event-bridge/triggers.ts`                      | Add `workflowExecutionTimeout?: Duration` to `startWorkflow` options; leavingHome → 20 min  |
| C   | `packages/temporal/src/schedules/register-schedules.ts`               | homelab-audit: `agentTimeoutMinutes` 8→45, `workflowExecutionTimeout` 10→50 min             |
| C   | `packages/temporal/src/schedules/register-schedules.test.ts`          | Update assertions to 45 min agent timeout / 50 min workflow timeout                         |
| D   | `packages/temporal/src/workflows/alert-remediation.ts`                | `agentActivities` startToCloseTimeout 90→30 min; child `workflowExecutionTimeout` 2h→35 min |
| E   | `packages/temporal/src/schedules/register-schedules.ts`               | Add `DELETED_SCHEDULE_IDS` export; delete orphaned schedules on startup                     |
| E   | `packages/temporal/src/schedules/register-schedules.test.ts`          | Test: none of DELETED_SCHEDULE_IDS appear in SCHEDULES                                      |
| F   | `packages/homelab/src/cdk8s/src/resources/temporal/namespace-init.ts` | Retention 168h→720h (both create and update commands)                                       |
| G   | `packages/docs/plans/2026-06-06_temporal-health-fixes.md`             | This document                                                                               |
