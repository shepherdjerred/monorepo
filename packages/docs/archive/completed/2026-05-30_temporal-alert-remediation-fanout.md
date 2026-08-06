---
id: reference-completed-2026-05-30-temporal-alert-remediation-fanout
type: reference
status: complete
board: false
---

# Temporal Alert Remediation Fan-Out

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
