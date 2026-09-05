# @shepherdjerred/temporal

Temporal workflow worker for the monorepo. It consolidates what used to be K8s
CronJobs, in-process cron, and custom job queues into one durable, observable
scheduler: declarative schedules (home automation, reports, maintenance),
generic report-only Codex SDK agent tasks through OpenRouter, including the daily
homelab audit, deterministic PR-opening refresh jobs, and webhook ingress
(GitHub merge-conflict check and build cancel, Xcode Cloud, iOS sleep).

Production runs one image in twelve single-replica Kubernetes Deployments. The
`control` role owns schedule reconciliation and public HTTP/event surfaces
without a task queue. The credentialless `workflows` role owns deterministic
Workflow execution on `monorepo-workflows`. The domain roles own only Activity
Workers, with separate registries, credentials, service accounts, and
concurrency budgets. The explicit `all` role composes every role in one process
for local development.

Temporal namespaces are environment-scoped: local servers use `dev`, Scout
beta uses `beta`, and production plus shared control-plane jobs use `prod`.
The shared cluster contains only the active `beta` and `prod` namespaces plus
Temporal's internal `temporal-system` namespace. Unexpected workflow starts in
any other namespace raise `TemporalUnexpectedNamespaceStartAttempted`.

The central Scout worker also polls its unchanged `scout` queue in `beta` for
the beta-owned weekly parlay and Bryan Bucks analytics schedules; all other
central queues are `prod` only.

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
| `workflows`       | `monorepo-workflows`    |                 none |

The production manifests land in layers. The gateway, Workflow worker, and
domain Activity Workers deploy independently so each queue has its own
credentials, concurrency, health, and metrics boundary.

## Quick start

Run from `packages/temporal`:

```bash
TEMPORAL_NAMESPACE=dev TEMPORAL_WORKER_ROLE=all bun run start # start the local worker
bun run typecheck    # tsc --noEmit (stubs the HA schema first)
bun run test         # unit tests, including the workflow-bundle smoke test
bun run lint         # eslint
TEMPORAL_NAMESPACE=prod bun run worker-deployment inspect --build-id <image-git-sha>
TEMPORAL_NAMESPACE=prod bun run worker-deployment status --build-id <image-git-sha>
TEMPORAL_NAMESPACE=beta bun run worker-deployment status --target scout-beta --build-id <image-git-sha>
```

Worker Deployment rollouts use the package-local `worker-deployment` command;
no toolkit wrapper is added. `start` runs the real workflow replay suite,
replays retained IDs listed in `TEMPORAL_REPLAY_WORKFLOW_IDS` against the
candidate bundle, and runs an exact-version canary before opening a 10% ramp.
Set `TEMPORAL_ADDRESS` to an
operator-reachable endpoint; native calls use the existing `toolkit temporal`
passthrough. The first ramp also requires `--stable-build-id <sha>` so an empty
deployment has a rollback target. `advance` checks alert history across its
clean windows. `promote` checks the 24-hour history, verifies the candidate
pin's baked `GIT_SHA`, and writes the stable pin before changing routing so an
interrupted command is safe to retry. `rollback` removes the exact active ramp,
even if a newer build registered. CI retains a Workflow candidate whenever its
pin differs from stable, so a later image release cannot evict an in-flight
ramp. After rollback and candidate-history drain, rerun `rollback` with no
active ramp to reset the rejected candidate to the stable catalog value, then
review and commit both the catalog and `scripts/pin-candidates-state.json`
changes through the normal pull-request flow before the next candidate.
If an operator host dies, use `inspect` before removing a stale lease: it is a
read-only routing and lease query that remains usable when candidate health
checks or alert windows are failing.
The target defaults to `central`; `--target scout-beta` and `--target
scout-prod` select the stage-local Scout deployment, queue, replay bundle,
pinned canary, image repository, and catalog pins.

The hourly `openai-complimentary-usage-hourly` schedule starts
`runOpenAiComplimentaryUsageReconciliation` on `monorepo-workflows`. Pause it
before repairing or replacing the Workflow bundle, then resume it only after a
pinned canary and one bounded scheduled run complete. The Workflow delegates
the OpenAI Usage and Costs calls to the isolated `billing` Activity queue. Live
acceptance requires current `openai_project_usage_tokens`, zero official
`openai_project_cost_usd`, a fresh reconciliation timestamp, and Scout review
requests with `byok="true"`. The Prometheus rules use
`exported_service="scout-for-lol-backend"` for Scout telemetry and
`container="temporal-billing-worker"` for worker freshness; these labels are
stable across pod recreations.
Scout extraction uses two capable image releases. The pre-entrypoint pin creates
no pod. Copy the first capable candidate pin to stable; that creates only the
credentialless stable poller. A later distinct candidate pin creates the ramp
target, and `start --stable-build-id` establishes stable before sending 10% to
candidate. The embedded poller remains only to drain old unversioned histories.
Production remains embedded until beta acceptance completes.

## Documentation

- [Temporal overview](../docs/wiki/src/content/docs/explanation/temporal/overview.md)
  explains the deployment and ownership model.
- [Workflow families](../docs/wiki/src/content/docs/explanation/temporal/workflow-families.md)
  explains domain boundaries.
- [Schedule reference](../docs/wiki/src/content/docs/reference/temporal-schedules.md)
  lists registered schedules and their policy.
- [Workflow reference](../docs/wiki/src/content/docs/reference/temporal-workflows.md)
  lists durable workflow interfaces.
- [Worker rollout how-to](../docs/wiki/src/content/docs/how-to/roll-out-a-temporal-worker-deployment.md)
  is the operator procedure.
- [Agent task boundary](../docs/wiki/src/content/docs/explanation/temporal/agent-task-boundary.md)
  and [input reference](../docs/wiki/src/content/docs/reference/agent-task-input.md)
  define generic agent tasks.

Source remains authoritative: schedule definitions live in
`src/schedules/schedule-definitions.ts`, role registries live beside worker
startup, and command schemas live in `scripts/`. [AGENTS.md](AGENTS.md) contains
only the constraints that every package task must keep in context.
