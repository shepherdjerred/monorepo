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
budget. The compatibility `default` queue is served by the core worker in the
active namespace and by a bounded drain worker in `default`; it has no
production start site. The default `all` role runs everything in one process
for local development.

Temporal namespaces are environment-scoped: local servers use `dev`, Scout
beta uses `beta`, and production plus shared control-plane jobs use `prod`.
During migration, `TEMPORAL_LEGACY_NAMESPACE=default` adds bounded worker-only
pollers so existing histories can finish without allowing new starts there.
The central Scout worker also polls its unchanged `scout` queue in `beta` for
the beta-owned weekly parlay and Bryan Bucks analytics schedules; all other
central queues remain `prod` plus the temporary `default` drain.

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

The production manifests land in layers. In the Glitter layer, the existing
legacy core and agent Deployments remain in place while the combined Glitter
Deployment is replaced by `temporal-glitter-corpus-worker` and
`temporal-glitter-context-worker`. The gateway, home, reports, infra, repo, and
Scout Deployments arrive in the later ingress and operations layers; the table
above describes the final topology.

## Quick start

Run from `packages/temporal`:

```bash
TEMPORAL_NAMESPACE=dev bun run start # start a local worker
bun run typecheck    # tsc --noEmit (stubs the HA schema first)
bun run test         # unit tests, including the workflow-bundle smoke test
bun run lint         # eslint
export TEMPORAL_ADDRESS=temporal.tailnet-1a49.ts.net:443
export TEMPORAL_TLS=true
export TEMPORAL_NAMESPACE=prod
bun run migrate:namespaces -- prepare # read-only inventory
bun run migrate:namespaces -- prepare --confirm # create paused targets
bun run migrate:namespaces -- cutover --confirm # pause default, activate targets
bun run migrate:namespaces -- rollback --confirm # only before a target workflow starts
bun run migrate:namespaces -- audit --cutover-at <ISO timestamp>
```

During the namespace migration, inventory and prepare schedules before
cutover. The gateway uses `TEMPORAL_SCHEDULE_RECONCILIATION=auto`: it checks
that all schedules in the legacy `default` namespace are paused, then
reconciles only `prod` and `beta` on its next restart. After the cutover
command succeeds, restart the gateway so it observes the drained source.

```bash
TEMPORAL_ADDRESS=<private-temporal-host>:443 TEMPORAL_TLS=true TEMPORAL_NAMESPACE=prod \
  bun run migrate:namespaces -- prepare
TEMPORAL_ADDRESS=<private-temporal-host>:443 TEMPORAL_TLS=true TEMPORAL_NAMESPACE=prod \
  bun run migrate:namespaces -- prepare --confirm
TEMPORAL_ADDRESS=<private-temporal-host>:443 TEMPORAL_TLS=true TEMPORAL_NAMESPACE=prod \
  bun run migrate:namespaces -- cutover --confirm
```

Record the cutover timestamp and use it for the final audit. Rollback is
allowed only before a target workflow starts; after that, recover forward.

The migration command always reads its source from `default` and writes only to
`prod` or `beta`; it intentionally ignores `TEMPORAL_NAMESPACE`. The other
clients and operator scripts require `TEMPORAL_NAMESPACE=dev|beta|prod`.

The migration command always inventories `default`. `prepare --confirm` writes
paused copies to `prod` and `beta`; `cutover --confirm` also pauses the source
schedules in `default` and activates their targets; `rollback --confirm` can
restore source pause state in `default` and deletes the prepared targets, but
only before any target workflow starts. `TEMPORAL_NAMESPACE` is ignored by the
migration command itself, but is still exported above because the read-only
inventory step shares the required namespace contract. The other clients and
operator scripts require
`TEMPORAL_NAMESPACE=dev|beta|prod`.

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
