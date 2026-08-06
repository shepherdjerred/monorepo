---
id: reference-completed-2026-05-17-temporal-agent-task-scheduler
type: reference
status: complete
board: false
---

# Temporal Agent Task Scheduler

## Summary

Generic Temporal scheduler for explicit one-off and cron-based report-only Claude/Codex tasks. This replaces bespoke prompt-plus-email workflows over time, starting with the daily homelab audit.

## Design

- `agentTaskWorkflow` runs on a dedicated `agent-task` queue so long Claude/Codex subprocesses do not block HA, PR review, or PR summary workflows.
- Inputs support either `runAt` for one-off delayed work or `cron` plus `scheduleId` for recurring work.
- Agents run in report-only mode. The prompt and runner forbid edits, commits, PRs/issues, and live-system mutation.
- Claude uses `claude -p` with a strict output JSON schema and a read/report tool allowlist.
- Codex uses `codex exec --sandbox read-only` with the same output schema.
- Postal email remains the delivery mechanism.
- Agents may request one follow-up task through structured output.
- Agents may request cron cancellation only when `allowSelfCancel` is set; cancellation pauses the Temporal Schedule instead of deleting it.

## Implementation Notes

- Explicit docs blocks use `<!-- temporal-agent-task ... -->`.
- Local scheduling is via `packages/temporal/scripts/schedule-agent-task.ts`.
- Authenticated HTTP scheduling is exposed at `/agent-tasks` and requires `AGENT_TASK_API_TOKEN`; missing auth fails worker startup rather than disabling the endpoint.
- `homelab-audit-daily` now starts `agentTaskWorkflow` instead of the bespoke homelab audit workflow. The old code remains in tree as a rollback path until the generic path is proven.

## Verification

- `cd packages/temporal && bun run typecheck`
- `cd packages/temporal && bun run test`
- `cd packages/temporal && bun run lint`
- `cd packages/homelab && bun run typecheck`
- `cd packages/homelab && bun run lint`
- `cd .dagger && bunx tsc --noEmit --ignoreDeprecations 6.0`
