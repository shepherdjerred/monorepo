# @shepherdjerred/temporal

Temporal workflow worker for the monorepo. It consolidates what used to be K8s
CronJobs, in-process cron, and custom job queues into one durable, observable
scheduler: declarative schedules (home automation, reports, maintenance),
generic report-only Codex SDK agent tasks through OpenRouter, including the daily
homelab audit, deterministic PR-opening refresh jobs, and webhook ingress
(GitHub merge-conflict check and build cancel, Xcode Cloud, iOS sleep).

Production runs one image in thirteen single-replica Kubernetes Deployments. The
`control` role owns schedule reconciliation and public HTTP/event surfaces
without a task queue. Stable and candidate credentialless `workflows`
Deployments own deterministic Workflow execution on `monorepo-workflows` and
temporarily poll every legacy central queue so open histories can finish where
they started. Both register under the `monorepo-central-workflows` Worker
Deployment with the image's exact Git SHA as Build ID and `AUTO_UPGRADE` as the
default behavior. The domain roles
own only Activity Workers, with separate registries, credentials, service
accounts, and concurrency budgets. The default `all` role composes every role in
one process for local development.

| Role              | Queue or surface                              |           Execution concurrency |
| ----------------- | --------------------------------------------- | ------------------------------: |
| `control`         | schedules and HTTP APIs                       |                            none |
| `workflows`       | `monorepo-workflows` + legacy Workflow queues | 8 new / 2 legacy Workflow tasks |
| `home`            | `home`                                        |                               4 |
| `reports`         | `reports`                                     |                               4 |
| `infra`           | `infra`                                       |                               1 |
| `repo`            | `repo-automation`                             |                               1 |
| `scout`           | `scout`                                       |                               1 |
| `agent`           | `agent-task`                                  |                               1 |
| `glitter-corpus`  | `glitter-corpus`                              |                               1 |
| `glitter-context` | `glitter-context`                             |                               1 |
| `maintenance`     | `maintenance`                                 |                               1 |

Every central start, schedule, and child Workflow targets
`monorepo-workflows`. Every `proxyActivities` call names its domain Activity
queue explicitly. Continue-as-new inherits the execution's current queue: a new
chain remains on `monorepo-workflows`. Pre-retirement default histories are
unsupported after the legacy worker removal.

## Quick start

Run from `packages/temporal`:

```bash
bun run start        # start the worker (connects to the Temporal server)
bun run typecheck    # tsc --noEmit (stubs the HA schema first)
bun run test         # unit tests, including the workflow-bundle smoke test
bun run lint         # eslint
bun run worker-deployment inspect --build-id <image-git-sha>
bun run worker-deployment status --build-id <image-git-sha>
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
