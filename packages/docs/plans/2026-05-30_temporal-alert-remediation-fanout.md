# Temporal Alert Remediation Fan-Out

## Status

Complete

## Summary

Add an hourly Temporal sweep that inspects all active PagerDuty incidents and unresolved, unmuted Bugsink issues, dedupes them by stable fingerprint, and fans out one child workflow per alert. Each child investigates exactly one alert and may create a draft PR only when the fix is straightforward, repository-only, and locally verified.

## Implementation Notes

- `alertRemediationSweepWorkflow` runs on the `agent-task` queue, collects alerts via `toolkit pd` and `toolkit bugsink`, dedupes fingerprints, fans out child workflows with concurrency capped at 3 by default, and sends a Postal summary when there are PRs, skips, or failures.
- `alertRemediationChildWorkflow` checks for an existing open remediation PR, provisions an isolated workdir from `main`, invokes the agent with mutation permission scoped to a single alert, and always returns a structured child outcome.
- Existing `agentTaskWorkflow` remains report-only; remediation uses a separate workflow and prompt path so normal scheduled reports still forbid edits, commits, PRs, and live-system mutation.

## Verification Plan

- `cd packages/temporal && bun run typecheck`
- `cd packages/temporal && bun test`
- `cd packages/temporal && bun run lint`
- `cd packages/homelab && bun run typecheck` if homelab deployment config changes

## Session Log -- 2026-05-30

### Done

- Added shared alert-remediation schemas, stable fingerprint helpers, and the mutating remediation output contract in `packages/temporal/src/shared/alert-remediation.ts`.
- Added `alertRemediationSweepWorkflow` and `alertRemediationChildWorkflow` with dedupe, child fan-out, concurrency capping, child failure isolation, existing-PR detection, workdir preparation, agent execution, cleanup, and summary email aggregation.
- Added alert collection through `toolkit pd incidents` and `toolkit bugsink projects/issues`, plus normalization for PagerDuty incidents and Bugsink issues.
- Added a separate alert-remediation agent prompt that permits draft PR creation only for straightforward repository-only fixes, while leaving the generic `agentTaskWorkflow` report-only prompt unchanged.
- Registered `alert-remediation-hourly` on the `agent-task` queue with default concurrency 3.
- Added focused shared/activity/prompt/workflow tests for normalization, existing PR detection, report-only prompt preservation, fan-out, concurrency cap, failure isolation, and already-covered skips.
- Verified `packages/temporal` with typecheck, full tests, and lint.

### Remaining

- Deploy/register the updated Temporal schedules so `alert-remediation-hourly` exists in the live cluster.
- Observe the first live run with real PagerDuty, Bugsink, GitHub App, Postal, and agent credentials before trusting it unattended.

### Caveats

- The workflow can create draft PRs once deployed. Alert resolution remains manual; the prompt explicitly forbids resolving PagerDuty incidents or muting/resolving Bugsink issues.
- The automated agent path was tested with mocked activities, not a real live agent-created PR.
- Local dependency installs were needed in this worktree before verification could run.

### Verification

- `cd packages/temporal && bun run typecheck`
- `cd packages/temporal && bun run test`
- `cd packages/temporal && bun run lint -- --no-cache`
