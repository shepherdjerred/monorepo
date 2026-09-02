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

The production manifests land in layers. In the Glitter layer, the existing
legacy core and agent Deployments remain in place while the combined Glitter
Deployment is replaced by `temporal-glitter-corpus-worker` and
`temporal-glitter-context-worker`. The gateway, home, reports, infra, repo, and
Scout Deployments arrive in the later ingress and operations layers; the table
above describes the final topology.

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
Scout extraction uses two capable image releases. The pre-entrypoint pin creates
no pod. Copy the first capable candidate pin to stable; that creates only the
credentialless stable poller. A later distinct candidate pin creates the ramp
target, and `start --stable-build-id` establishes stable before sending 10% to
candidate. The embedded poller remains only to drain old unversioned histories.
Production remains embedded until beta acceptance completes.

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

Record the cutover timestamp. **Run `migrate:namespaces -- audit` with it
before restarting the gateway**, not later:

```bash
TEMPORAL_ADDRESS=<private-temporal-host>:443 TEMPORAL_TLS=true TEMPORAL_NAMESPACE=prod \
  bun run migrate:namespaces -- audit --cutover-at <recorded-timestamp>
```

The audit compares each target against its source byte for byte. The gateway's
first reconciliation adds `Environment`, `Domain`, `Trigger`, and
`ReleaseCommit` search attributes plus static summaries to every target, which
the frozen sources never had, so that comparison can never match again once the
gateway has run. Auditing after the restart reports `does not match source` for
a migration that was in fact correct.

After the restart, the remaining invariants are still checkable directly:
every source paused, every target carrying the recorded `cutoverAt`, and no
executions or new starts in the legacy namespace.

Rollback is allowed only before a target workflow starts; after that, recover
forward.

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
| [Review threads (CI gate)](AGENTS.md#review-threads-ci-gate)                                             | Provider-neutral CI review gate                                  |
| [GitHub webhook](AGENTS.md#github-webhook-merge-conflict-check--pr-closed-build-cancel)                  | Merge-conflict status and PR-closed Buildkite build cancellation |
| [HA presence](AGENTS.md#ha-presence-welcomehome--leavinghome--reconcilelock--debounce-model)             | Presence debounce model and the front-door lock reconciler       |
