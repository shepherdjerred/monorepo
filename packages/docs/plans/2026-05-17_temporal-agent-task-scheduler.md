# Temporal Agent Task Scheduler

## Status

Partially Complete

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

## Session Log — 2026-05-17

### Done

- Added generic Temporal agent task schemas, workflow, activities, scheduler helper, Hono API, and local scheduling CLI under `packages/temporal/`.
- Moved `homelab-audit-daily` onto the generic `agentTaskWorkflow` with Claude as the report-only provider, while leaving the bespoke audit workflow in tree as a rollback path.
- Added the dedicated `agent-task` task queue, worker registration, app metrics, Postal email reporting, optional follow-up scheduling, and schedule self-pause support.
- Added Codex CLI installation to the Temporal worker image build path and fixed `.dagger` typechecking by adding Node test types and a typed smoke-test error path.
- Exposed the agent task API in homelab via the Temporal worker deployment, service, and Cloudflare Tunnel binding gated by `AGENT_TASK_API_TOKEN`.
- Documented follow-up scheduling patterns in root `AGENTS.md`, `packages/docs/AGENTS.md`, and `packages/temporal/AGENTS.md`.
- Verified `packages/temporal` with typecheck, tests, and lint; verified `packages/homelab` with typecheck and lint; verified `.dagger` with TypeScript compile.

### Remaining

- Deploy/register the updated Temporal schedules so `homelab-audit-daily` actually switches to the generic path in the live cluster.
- Add the `AGENT_TASK_API_TOKEN` 1Password field before exposing or using the Hono scheduling API in production.
- Exercise one live low-risk scheduled task end to end in the deployed worker to confirm real CLI auth, real Postal delivery, and follow-up scheduling behavior.

### Caveats

- The generic API is bearer-token protected but does not yet have request rate limiting or per-caller authorization.
- Claude report-only mode relies on prompt/tool allowlisting; Codex gets a stronger read-only sandbox.
- The plan remains in `packages/docs/plans/` rather than archive because the code is implemented and locally verified, but not deployed/proven live yet.

## Session Log — 2026-05-19

### Done

- Ran a local end-to-end smoke test with `temporal server start-dev`, the real worker, a fake `git`, a fake `codex`, and a fake Postal API.
- Verified the authenticated Hono API accepted a one-off Codex task and started `agentTaskWorkflow` on the `agent-task` queue.
- Verified the one-off workflow completed, invoked the Codex subprocess, parsed the output JSON, rendered the email HTML, and sent it to the fake Postal endpoint.
- Verified a cron-backed schedule could be created via the API, manually triggered, completed as `agentTaskWorkflow`, and paused itself when the agent returned `cancelCron: true`.
- Found and fixed a local/runtime coupling issue: `/agent-tasks` was previously started inside the Home Assistant event bridge path, so missing or failed HA setup prevented the independent scheduling API from starting. Optional HTTP servers now start directly from worker startup.
- Deleted the temporary local schedule and stopped the local worker, Temporal dev server, and fake Postal server.
- Re-ran `packages/temporal` verification: `bun run typecheck`, `bun run lint`, and escalated `bun run test` all pass.

### Remaining

- Deploy/register the updated Temporal schedules in the live cluster.
- Add `AGENT_TASK_API_TOKEN` to the Temporal worker 1Password item before using the public scheduling endpoint.
- Run one low-risk live task using real Claude or Codex credentials and real Postal delivery.

### Caveats

- The local E2E used fake `git`, fake `codex`, and fake Postal to avoid network, model spend, and real email. It proves orchestration and integration boundaries, not external provider auth.
- When `HA_URL` is absent locally, the HA bridge supervisor still logs retry errors; `/agent-tasks` now remains available anyway.

## Session Log — 2026-05-20

### Done

- Tightened agent task ingress auth so the Hono `/agent-tasks` API always starts with a required bearer token and the worker fails closed if `AGENT_TASK_API_TOKEN` is missing.
- Made the homelab 1Password-backed `AGENT_TASK_API_TOKEN` field required instead of optional.
- Added API tests covering unauthenticated rejection and authenticated scheduling.
- Clarified docs that direct Temporal scheduling is a local/operator path, not public ingress; public task creation must use the authenticated HTTP API.
- Added the concealed `AGENT_TASK_API_TOKEN` field to the Temporal worker 1Password item.
- Rebasing the PR branch onto `origin/main` conflicted in the Temporal worker homelab resource; resolved it by keeping main's audit env split and moving public Temporal worker HTTP services into `http-services.ts`.

### Remaining

- Deploy/register the updated Temporal schedules in the live cluster.
- Consider adding Temporal frontend auth/mTLS or keeping Temporal gRPC strictly private to prevent direct workflow scheduling from becoming a public ingress path.

### Caveats

- GitHub webhook ingress remains separately protected by HMAC signature verification.
- `/healthz` remains unauthenticated by design for service health checks.
- The branch was rebased onto `origin/main`, so the PR branch history was rewritten.
