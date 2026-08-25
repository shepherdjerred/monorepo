# @shepherdjerred/temporal

Temporal workflow worker for the monorepo. It consolidates what used to be K8s
CronJobs, in-process cron, and custom job queues into one durable, observable
scheduler: declarative schedules (home automation, reports, maintenance),
generic report-only agent tasks (Claude/Codex subprocesses) including the daily
homelab audit, deterministic PR-opening refresh jobs, and webhook ingress
(GitHub merge-conflict check and build cancel, Xcode Cloud, iOS sleep).

Production runs one image in ten single-replica Kubernetes Deployments. The
`control` role owns schedule reconciliation and public HTTP/event surfaces
without a task queue. `home`, `reports`, `infra`, `repo`, `scout`, `agent`,
`glitter-corpus`, `glitter-context`, and `maintenance` each own one queue with
their own activity registry, credentials, service account, and concurrency
budget. The retired `default` queue has no production owner or start site. The
default `all` role runs everything in one process for local development.

| Role              | Queue or surface        | Activity concurrency |
| ----------------- | ----------------------- | -------------------: |
| `control`         | schedules and HTTP APIs |                 none |
| `home`            | `home`                  |                    4 |
| `reports`         | `reports`               |                    4 |
| `infra`           | `infra`                 |                    1 |
| `repo`            | `repo-automation`       |                    1 |
| `scout`           | `scout`                 |                    1 |
| `agent`           | `agent-task`            |                    1 |
| `glitter-corpus`  | `glitter-corpus`        |                    1 |
| `glitter-context` | `glitter-context`       |                    1 |
| `maintenance`     | `maintenance`           |                    1 |

## Quick start

Run from `packages/temporal`:

```bash
bun run start        # start the worker (connects to the Temporal server)
bun run typecheck    # tsc --noEmit (stubs the HA schema first)
bun run test         # unit tests, including the workflow-bundle smoke test
bun run lint         # eslint
```

## Documentation

The complete reference is [AGENTS.md](AGENTS.md):

| Section                                                                                                  | Covers                                                           |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [Runtime](AGENTS.md#runtime) / [Structure](AGENTS.md#structure) / [Key Concepts](AGENTS.md#key-concepts) | Worker roles, source layout, workflow/activity/schedule basics   |
| [Schedules](AGENTS.md#schedules-srcschedulesregister-schedulests-srcschedulesschedule-definitionsts)     | Declarative `SCHEDULES`, pausing, catchup windows, orphan alerts |
| [Commands](AGENTS.md#commands) / [Environment Variables](AGENTS.md#environment-variables)                | Local commands and the full env-var reference                    |
| [LLM observability](AGENTS.md#llm-observability)                                                         | Required `gen_ai.*` spans for SDK and CLI LLM calls              |
| [HA schema](AGENTS.md#ha-schema-type-safe-workflows)                                                     | Type-safe Home Assistant workflows and the gitignored schema     |
| [Homelab audit](AGENTS.md#homelab-audit-daily)                                                           | The daily audit agent task and its local dev loop                |
| [Workflow failure alerts](AGENTS.md#temporal-workflow-failure--alerts-occurrences)                       | Per-failure Alertmanager occurrences                             |
| [Generic agent tasks](AGENTS.md#generic-agent-tasks)                                                     | `agentTaskWorkflow`, `/agent-tasks` API, canary, schema dialects |
| [Scheduled PR-creating workflows](AGENTS.md#scheduled-pr-creating-workflows)                             | Deterministic refresh jobs, bot-clone helpers, rehearsal check   |
| [Review threads (CI gate)](AGENTS.md#review-threads-ci-gate)                                             | Provider-neutral review gate and the review-signal collector     |
| [GitHub webhook](AGENTS.md#github-webhook-merge-conflict-check--pr-closed-build-cancel)                  | Merge-conflict status and PR-closed Buildkite build cancellation |
| [HA presence](AGENTS.md#ha-presence-welcomehome--leavinghome--reconcilelock--debounce-model)             | Presence debounce model and the front-door lock reconciler       |
