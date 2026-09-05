# packages/temporal

Temporal workflow worker for the monorepo. Consolidates ad-hoc scheduling (K8s CronJobs, in-process cron, custom job queues) under Temporal for durability, observability, and unified scheduling.

## Runtime

Production runs under **Bun**.

Unit and activity tests run with Vitest hosted by Bun through `bun run test:bun`.
The Temporal SDK's real workflow-worker tests are the sole repository exception:
`bun run test:workflows` hosts Vitest on Node because the SDK worker depends on
authentic Node `worker_threads`, VM, promise hooks, and native worker support.
Keep this exception restricted to `src/workflows`, and do not expand it to
ordinary Temporal tests. The workflow phase keeps Vitest isolation but runs
files sequentially: each file owns a native time-skipping server and authentic
Node worker threads, and concurrent environments exhaust the bounded CI agent.
`bun run test` runs both phases through the stable package interface.

Production uses the same Bun image in thirteen single-replica Kubernetes
Deployments selected by `TEMPORAL_WORKER_ROLE`. `control` owns schedule
reconciliation and public HTTP/event surfaces without a task queue. The
credentialless `workflows` role runs as stable and candidate Deployments on
`monorepo-workflows`. Both use the Temporal Worker Deployment
`monorepo-central-workflows`, exact
image Git SHA Build IDs, and default `AUTO_UPGRADE` behavior. The stable and
candidate catalog pins must remain distinct: CI advances candidate only while
the two pins are equal, retaining the deployed candidate throughout a rollout.
The package-local rollout command advances stable only after the 24-hour soak.
After rollback and candidate-history drain, rerun `rollback` with no active ramp
to copy stable back to candidate before the next CI image release may advance
it; review and commit both the catalog and pin-state changes through the normal
PR flow.
The isolated `billing` role polls only the `billing` Activity queue and owns the
OpenAI organization Usage/Costs credential; it has no Flipt access or service
account token.
Domain roles are Activity-only and own their registries in the typed contract
in `src/worker-config.ts`. The explicit local `all` role preserves the
single-process development behavior. Keep new queue ownership and capabilities in that contract so a
provider subprocess, heavy Glitter failure, or maintenance subprocess cannot
take down another domain or inherit its Kubernetes permissions.

Every new central start, schedule, and child must target
`TASK_QUEUES.WORKFLOWS`. Every Activity proxy must name the domain queue that
owns the effect and must never use the Workflow queue. Continue-as-new inherits
the current Workflow task queue, which keeps central chains on
`monorepo-workflows`.

The bootstrap contract is `TEMPORAL_NAMESPACE` plus the paired
`TEMPORAL_WORKER_DEPLOYMENT_NAME` and `TEMPORAL_WORKER_BUILD_ID`. The Build ID
must be a full lowercase 40-character Git SHA. Image runtimes resolve a missing
explicit Build ID from the baked `GIT_SHA` only when a deployment name is
configured. Activity-only roles do not opt
into Worker Deployments. A Workflow role without the paired identity fails at
startup.

Operate rollouts from this package with `bun run worker-deployment`; the target
defaults to `central`, while `--target scout-beta` and `--target scout-prod`
select Scout's stage-local deployment, queue, replay bundle, canary, image
repository, and pins. Do not add a toolkit subcommand. `TEMPORAL_ADDRESS` must identify an
operator-reachable endpoint; native calls use the existing `toolkit temporal`
passthrough. `start` requires a clean candidate-build checkout, synthetic
bundle tests, operator-selected retained-history replay via
`TEMPORAL_REPLAY_WORKFLOW_IDS`, registered pollers, zero firing `Temporal.*`
alerts, and a pinned canary; it opens a 10% ramp. An empty deployment additionally requires a distinct registered
`--stable-build-id` and establishes it as current first. `advance` permits 50%
after 30 clean minutes and 100% after two clean hours, querying alert history
for the whole window. `promote` requires a 24-hour clean history at 100%, proves
the candidate catalog image's baked `GIT_SHA`, writes the stable pin first, then
makes the candidate current and removes the ramp. `rollback` removes the exact
active candidate ramp even if a newer build registered, then resets a divergent
rejected candidate pin when rerun with no active ramp. It refuses to reset a
candidate that is already current. Other actions refuse stale Build IDs and
out-of-order transitions.
Rollout leases are shared through the `refs/temporal-worker-deployment-locks/`
namespace. If an operator host dies, first use the read-only `inspect` command
to confirm routing and lease state; it does not require healthy candidate
pollers or a clean alert window. Then remove only the named stale lease with
the inspected object as a compare-and-swap expectation:
`git push --force-with-lease=refs/temporal-worker-deployment-locks/<lock-name>:<rolloutLockObject> origin :refs/temporal-worker-deployment-locks/<lock-name>`.
If that push is rejected, inspect again; never force-delete a lease while a
rollout is running.

Roll out Scout beta before Scout production. Mutating Scout production actions
verify that the same Build ID is already the current, unramped beta version with
a healthy beta Workflow poller; rollback remains available independently.
Scout bootstrap requires two capable image releases because the unversioned
embedded poller cannot be a Worker Deployment rollback version. A pin at or
before build 12197 creates no workflow-only pod. Copy the first capable
candidate pin to stable to create only the stable poller; a later distinct
candidate pin creates the ramp target. Never remove the embedded poller before
candidate replay, canary, soak, stable-pin promotion, and a healthy stable
poller. Repeat the sequence for production only after beta runtime acceptance.

## Structure

```
src/
  worker.ts              # Worker entrypoint — connects to Temporal server, registers task queues
  client.ts              # Shared Temporal client factory (reusable by other packages)
  shared/
    task-queues.ts       # Task queue name constants
    worker-role.ts       # Strict process-role parsing and queue ownership
    schemas.ts           # Zod schemas for workflow inputs
  workflows/             # Temporal workflow definitions (deterministic, no I/O)
  activities/            # Temporal activity implementations (actual work: API calls, DB, etc.)
  schedules/
    register-schedules.ts    # Registration logic: upsert/delete/pause reconciliation on worker startup
    schedule-definitions.ts  # The declarative SCHEDULES array (split out — register-schedules.ts sits at the max-lines cap)
```

## Key Concepts

- **Workflows** are deterministic functions. No direct I/O — call activities instead.
- **Activities** do the real work (HTTP calls, DB queries, file I/O). They run outside the sandbox.
- **Schedules** replace K8s CronJobs — managed by Temporal, visible in the UI.

The Kometa and Buildkite cache maintenance schedules use the `maintenance` task
queue. A single `temporal-maintenance-worker` Deployment in the `buildkite`
namespace runs them as direct `Bun.spawn` activities, with one activity slot so
cache and database writers never overlap. The Deployment mounts the existing
Buildkite PVCs and has no Kubernetes API token or Job RBAC; Kometa reaches Plex
over the cluster network with credentials projected from namespace-local
OnePassword resources.

## Schedules (`src/schedules/register-schedules.ts`, `src/schedules/schedule-definitions.ts`)

The declarative `SCHEDULES` array plus its supporting types/data (`ScheduleDefinition`,
`CATCHUP_TIGHT`/`CATCHUP_RELAXED`) live in `schedule-definitions.ts` — split out of
`register-schedules.ts`, which sits at the repo's max-lines cap (the same pattern as
`src/observability/metrics-glitter.ts` for `metrics.ts`). Import `SCHEDULES` from
`#schedules/schedule-definitions.ts`, not from `register-schedules.ts` (no re-export —
`custom-rules/no-re-exports`). `registerSchedules()` upserts every entry in the `SCHEDULES` array on each worker startup
(create-or-update), deletes the explicit `DELETED_SCHEDULE_IDS` allow-list, and reconciles
pause state. The **declaration** of a schedule (its existence, cron, workflow, args, policy)
is source-controlled here; its **on/off pause state** is runtime/dynamic (see below).

### Disabling / pausing a schedule (live, no deploy)

Pause/unpause in the **Temporal Web UI** — `https://temporal-ui.tailnet-1a49.ts.net`
(Tailscale-gated) → **Schedules** → pick the schedule → **Pause**. A pause **persists across
worker restarts**: `registerSchedules` preserves live pause state on update (the `update`
callback spreads the previous schedule, so a UI pause survives). `registerSchedules` never
auto-pauses or auto-unpauses anything. This is intentional — pause is the one dynamic knob;
everything else about a schedule lives in source. Don't add a declarative `enabled` flag, it
would fight the UI.

| To stop…             | Pause schedule id(s)                                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Floor preheat        | `good-morning-weekday-preheat`, `good-morning-weekend-preheat`                                                                                                                                                                |
| Wake-up (heat)       | `good-morning-weekday-wake`, `good-morning-weekend-wake`                                                                                                                                                                      |
| Get-up (volume ramp) | `good-morning-weekday-up`, `good-morning-weekend-up`                                                                                                                                                                          |
| Vacuum               | `vacuum-9am`, `vacuum-12pm`, `vacuum-5pm`                                                                                                                                                                                     |
| LoL / Scout data     | `scout-data-dragon-version-check`, `scout-data-dragon-weekly-refresh`, `scout-lane-priors-weekly-refresh`, `scout-season-refresh-weekly`, `scout-showcase-refresh-weekly`, `scout-queue-windows-daily`, `scout-weekly-parlay` |

### Catchup window (missed-run replay after a SERVER outage)

`catchupWindow` controls whether a run missed while the Temporal **server** was down gets
replayed on recovery. (A worker restart/deploy does **not** drop runs — the server still
creates the action on time and it queues.) Three tiers, set in `buildSchedulePolicies`:

- `CATCHUP_TIGHT` (5 min) on time-of-day home automation (vacuum, good-morning): skip rather
  than fire a wake-up/vacuum hours late.
- `CATCHUP_RELAXED` (1 hour, the default for everything else): reports/maintenance still run
  late after an outage. Override per-schedule via the optional `catchupWindow` field.
- `CATCHUP_WEEKLY_PARLAY` (12 hours) on `scout-weekly-parlay`: replay Sunday publication
  through the full betting window when the Temporal server was unavailable.

Caveat: a long _worker_ outage can still execute a home run late (the server already created
it on time); fully preventing that needs a staleness guard inside the workflow.

### Orphan detection

The reconciler is upsert-only and trusts the hand-maintained `DELETED_SCHEDULE_IDS`, so a
renamed/removed schedule that isn't added there keeps firing silently (has happened 4×).
`detectOrphanSchedules` (`src/schedules/orphan-detection.ts`) lists live schedules on startup
and sets the `temporal_schedule_orphans` gauge + logs any that are neither declared, nor on
the delete list, nor a dynamic agent-task schedule. A schedule counts as dynamic only via the
`agent-task-` id prefix (auto-generated ids) or the `dynamicAgentTask` memo marker stamped at
creation by the `/agent-tasks` API — **not** by `workflowType === "agentTaskWorkflow"`, which
would also exempt declared schedules running that workflow (e.g. `homelab-audit-daily`) and
silently hide them if they were ever removed from `SCHEDULES`. **Alert on
`temporal_schedule_orphans > 0`**, then add the id to `DELETED_SCHEDULE_IDS` (if removed) or
back to `SCHEDULES` (if still wanted). The gauge is set to `-1` if the live-schedule listing
itself fails (count unknown) — **alert on `< 0` separately**, since a failed scan otherwise
stays at 0 and is indistinguishable from a clean "no orphans" result.

## Commands

```bash
TEMPORAL_NAMESPACE=dev TEMPORAL_WORKER_ROLE=all bun run start # Start local worker
bun run typecheck    # Type check (runs ensure-ha-schema first)
bun run lint         # ESLint
bun run test         # Run tests (incl. workflow-bundle smoke test)
bun run generate     # Regenerate src/generated/ha-schema.ts from live HA (needs HA_URL + HA_TOKEN)
bun run preview:report-emails # Write the deterministic report-email gallery under /tmp
```

The `bun run test` run includes a workflow-bundle smoke test (`src/workflows/bundle.test.ts`) that runs the same webpack pass `Worker.create()` performs at startup. If you import an activity helper into a workflow file and this test starts failing, move the helper to `src/shared/` (a pure module with no Sentry/observability imports).

## LLM observability

Every LLM call in this package must emit a `gen_ai.*` span; the archive
processor registered in `src/observability/tracing.ts` uploads prompt/response
bodies to S3 (`llm-archive` bucket) and forwards a slim span to Tempo.

- **Ordinary inference** — use `src/activities/openrouter-runtime.ts`, which
  creates the shared `@shepherdjerred/llm-runtime` and always enables AI SDK
  telemetry, OpenRouter attribution, aggregate usage/cost metrics, and private
  body archival. `generateBoundedSynthesis` in that module is the shared entry
  point for the short evidence syntheses the audit and dependency reports use.
- **Codex SDK** — generic agent tasks run through
  `src/activities/agent-task-sdk.ts`; trusted source-controlled agents run
  through `src/activities/codex-agent-sdk-runner.ts`. Both resolve stable
  catalog IDs to OpenRouter routes, pass the service-scoped OpenRouter key to
  the SDK constructor, and keep stable IDs in activity telemetry. No activity
  may launch a `claude` or `codex` subprocess; `scripts/checks/check-ai-architecture.ts`
  enforces that repo-wide.

Emit the span before cancellation, validation, or effect-reconciliation failure
checks: failed runs spent tokens and must remain visible for billing. Never
replay an effectful SDK agent solely because its final schema is invalid.

## HA schema (type-safe workflows)

Workflows that touch Home Assistant go through `src/workflows/ha/util.ts`, which wraps each activity in a schema-parameterized signature — entity IDs, domains, services, and service data are type-checked against `src/generated/ha-schema.ts`.

That file is **gitignored** (`packages/temporal/.gitignore`). It is produced by `@shepherdjerred/home-assistant`'s `ha-codegen` CLI and contains entity IDs / service definitions from the live HA instance, which is treated as sensitive (see the `HA types are sensitive, generate in CI` auto-memory).

Two committed artifacts make this work without always needing HA credentials:

- `src/generated/ha-schema.stub.ts` — a permissive `DefaultHaSchema` fallback. No sensitive content.
- `scripts/ensure-ha-schema.ts` — pre-script that copies the stub into `ha-schema.ts` when the generated file is missing. Invoked automatically by `bun run typecheck`, `bun run test`, and `bun run build`.

Workflow:

- **Local dev with HA access**: `bun run generate` populates `ha-schema.ts` with real data. Workflows get strict type safety. Don't commit the result.
- **Local dev without HA access**: stub flows in automatically via `ensure-ha-schema.ts`. Workflows typecheck against `DefaultHaSchema` (loose strings). Same compile behavior as before this feature landed.
- **CI has no HA credentials**: the stub keeps `bun run typecheck` green in the Buildkite pipeline (and anywhere else) without HA access; strict typing requires a local `bun run generate` against live HA.

## Environment Variables

- `TEMPORAL_ADDRESS` — Temporal server gRPC address (default: `temporal-server.temporal.svc.cluster.local:7233`)
- `TEMPORAL_NAMESPACE` — required active namespace: `dev`, `beta`, or `prod`.
- `TEMPORAL_WORKER_ROLE` — required process role: `all` (local only), `control`, `workflows`, `agent`, `backup`, `glitter`, `glitter-context`, `glitter-corpus`, `home`, `infra`, `maintenance`, `repo`, `reports`, or `scout`. Missing and invalid values fail startup.
- `HA_URL` — Home Assistant URL
- `HA_TOKEN` — Home Assistant long-lived access token
- `GOLINK_URL` — Golink service URL
- `FRESHRSS_API_URL`, `FRESHRSS_USER`, `FRESHRSS_CATEGORY` — FreshRSS Repo Stack reconciliation settings
- `FRESHRSS_MANIFEST_PATH`, `FRESHRSS_API_PASSWORD_FILE` — mounted FreshRSS manifest and password paths
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT` — S3/SeaweedFS credentials
- `SEAWEEDFS_BACKUP_SOURCE_ENDPOINT`, `SEAWEEDFS_BACKUP_SOURCE_ACCESS_KEY_ID`, `SEAWEEDFS_BACKUP_SOURCE_SECRET_ACCESS_KEY` — read-only source identity for the dedicated backup worker
- `R2_BACKUP_ENDPOINT`, `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY`, `R2_BACKUP_BUCKET` — destination identity scoped to the immutable backup bucket
- `REVIEW_SIGNAL_ARCHIVE_BUCKET` — S3/SeaweedFS bucket the review-signal collector writes NDJSON archives to (`review-signals/<temporal-run-id>.ndjson` — the object is keyed by the Temporal workflow run id, with no wall-clock component, so an activity retry overwrites idempotently rather than forking a second object; each NDJSON event carries its own `ts`). Optional — defaults to the existing `llm-archive` bucket (namespaced by the key prefix), so no new bucket/env is needed to start collecting
- `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY` — GitHub App credentials used to mint short-lived installation tokens for GitHub automation so GitHub attributes those actions to the app bot.
- `OPENROUTER_API_KEY` — service-scoped OpenRouter key for every ordinary text, tool, embedding, image, and structured-output call.
- Agent environments are built by `src/activities/agent-task-env.ts`. The
  OpenRouter key is passed to Codex itself and removed from tool subprocess
  environments; legacy Claude subscription fields are scrubbed and never used
  for fresh execution.
- `POSTAL_HOST`, `POSTAL_API_KEY` — Postal email service
- `RECIPIENT_EMAIL`, `SENDER_EMAIL` — Email addresses for dependency summary and homelab audit
- `AGENT_TASK_API_TOKEN` — required bearer token for the authenticated `/agent-tasks` scheduling API on port 9467
- `SLEEP_WEBHOOK_TOKEN` — bearer token for the direct iOS sleep webhook on port 9469; the listener is skipped when unset (local/dev workers can omit it)
- `SLEEP_WEBHOOK_PORT` — port for the direct sleep webhook (default `9469`)
- `RUNBOOK_PATH` — local override for the homelab-audit runbook (defaults to the bundled `runbooks/homelab-audit.md`)
- `ALERT_DASHBOARD_URL` — in-cluster Alerts API URL (homelab audit)
- `BUGSINK_URL`, `BUGSINK_TOKEN` — Bugsink REST API base + token (homelab audit)
- `GRAFANA_URL`, `GRAFANA_API_KEY` — Grafana base + API key used to provision the worker's private GCX `homelab` context; operator queries run through `toolkit prom`, `toolkit loki`, `toolkit tempo`, and `toolkit grafana`.
- `ARGOCD_SERVER`, `ARGOCD_AUTH_TOKEN` — ArgoCD server + token for `argocd app list` (homelab audit §13)
- `CLOUDFLARE_API_TOKEN` — read-only Cloudflare token used by `tofu plan -detailed-exitcode` (homelab audit §4)
- `TALOSCONFIG` — path to talosconfig (set to `/etc/talos/config` in cluster). Sourced via the projected volume that mounts 1P field `TALOSCONFIG_YAML` as a file. Marked optional in cdk8s — if the 1P field is unset, the file is absent and talosctl commands inside the audit fail fast with a clear error.
- `TELEMETRY_ENABLED`, `OTLP_ENDPOINT`, `TELEMETRY_SERVICE_NAME` — OpenTelemetry tracing → Tempo (gated by `TELEMETRY_ENABLED`)
- `SENTRY_DSN`, `ENVIRONMENT` — Sentry/Bugsink error tracking (init no-ops when DSN unset)
- `APP_METRICS_PORT` — port for the application Prometheus registry (default `9465`); separate from the SDK metrics on `:9464`
- `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` — bot identity for any activity that runs `git commit`
- `GITHUB_WEBHOOK_SECRET` — HMAC secret used to verify `X-Hub-Signature-256` on incoming GitHub webhooks (the merge-conflict check + PR-closed build-cancel ingress). **Required** when the webhook server is enabled; the server only starts when this is set.
- `GITHUB_WEBHOOK_PORT` — port for the GitHub webhook receiver (default `9466`).
- `XCODE_CLOUD_WEBHOOK_TOKEN` — unguessable token embedded in the Xcode Cloud webhook URL path (`/hook/<token>`). Xcode Cloud webhooks carry no signature/auth header, so the URL path IS the credential. **Required** to start the receiver; when unset the server is skipped.
- `XCODE_CLOUD_WEBHOOK_PORT` — port for the Xcode Cloud webhook receiver (default `9468`).
- `XCODE_CLOUD_ALERT_TTL_SECONDS` — safety auto-resolve window for a fired build-failure alert if no later `SUCCEEDED` clears it (default `21600` = 6h).
- `ALERTMANAGER_URL` — in-cluster Alertmanager base URL (`http://prometheus-kube-prometheus-alertmanager.prometheus:9093`). **Required** by three features: the Xcode Cloud webhook receiver (when enabled), the `temporal-failure-watch` schedule (see below), and `llm-catalog-refresh-weekly`, which publishes its withheld state on every run (firing when the cross-check withholds edits, resolving when it withholds none) — all POST to `/api/v2/alerts` via `src/lib/alertmanager.ts`.
- `TEMPORAL_FAILURE_ALERT_TTL_SECONDS` — how long a `TemporalWorkflowFailed` alert stays firing in Alertmanager before auto-resolving if the watcher stops re-observing it (default `87090` = 24h lookback plus the full 6.5m activity retry budget and a 5m delivery margin).

## Scout weekly parlay lifecycle

`scout-weekly-parlay` starts from the Sunday Pacific schedule and remains one
durable workflow through finalization. The first activity freezes the complete
DST-aware timeline from `workflowInfo().startTime`, which is stable even when a
worker outage delays the first workflow task. Later activity inputs retain the
period, slot, action, and progress index so retries carry the same endpoint
idempotency key. Do not derive the period again after a sleep or use
workflow-local timers outside Temporal's durable `sleep`.

Scout owns generation, Discord delivery, betting, contribution persistence, and
settlement. Temporal owns only orchestration. New executions route actions to
Scout's embedded background Activity queue. Histories that predate
`scout-weekly-parlay-embedded-activities-v1` replay through the authenticated
control endpoint until every such execution is closed and the namespace's
30-day retention has elapsed. Reminder/progress staleness is a Scout decision. Publication,
reminder, and progress use bounded delivery retries. Scoring start retries
durably until the finalization cutoff, when an unstarted market can be voided;
the final action begins at that cutoff, accepts Scout's incomplete response
through its bounded Match-V5 ingestion window. Final reconciliation uses bounded
retry slices and continues as new when a slice expires; this schedule deliberately
has no workflow execution timeout, so a prolonged outage cannot abandon pending bets.
This schedule alone uses
`ALLOW_ALL`, because a delayed prior finalization must not suppress the next
period's Sunday execution. The schedule's initial pause is the private-beta
fixture gate. After activation, pause it in Temporal for operational suspension
rather than adding a second enable switch.

`runScoutWeeklyParlayCatchupWorkflow` is the exceptional operator path for a
missed Sunday opening. It freezes `workflowInfo().startTime`, chooses the first
Pacific midnight at least the configured minimum betting duration plus the
open-action budget away, and retains the standard Sunday finalization. It may
omit the reminder and may run fewer progress updates. Only the open action
carries the frozen clocks; Scout reads its persisted definition thereafter.
Start one run with a stable period/slot ID and reject every reuse:

```bash
TEMPORAL_ADDRESS=temporal.tailnet-1a49.ts.net:443 TEMPORAL_TLS=true \
  toolkit temporal --namespace beta workflow start \
    --workflow-id scout-weekly-parlay-catchup-2026-08-24-0 \
    --type runScoutWeeklyParlayCatchupWorkflow \
    --task-queue monorepo-workflows \
    --input '{"periodKey":"2026-08-24","slot":0}' \
    --id-conflict-policy Fail \
    --id-reuse-policy RejectDuplicate
```

Do not add this workflow to `SCHEDULES`. The ordinary
`scout-weekly-parlay` schedule remains the next-week path.

## Homelab audit (daily)

`homelab-audit-daily` (cron `30 6 * * *` PT) runs the deterministic
`runHomelabAuditWorkflow` on the infra queue. Typed collectors own the six
required checks: Prometheus alerts, durable alert occurrences, Temporal
failures/stalls, Kubernetes workload health, ArgoCD state, and Buildkite main
failures with failed-job logs. An optional OpenRouter call may write only the
80-word synthesis over those collector results; it cannot choose the verdict.
Pre-versioned legacy executions still replay through the old agent activity,
which now runs Codex SDK Luna through OpenRouter (streamed redacted progress,
10 s heartbeats, cancellation, Sentry capture, and Prometheus token metrics)
and is delivered through the shared reporter as partial.

## Temporal workflow failure → Alerts occurrences

`temporal-failure-watch` (cron `*/5 * * * *`, `pollWorkflowFailuresWorkflow` on `TASK_QUEUES.REPORTS`) sends Alerts occurrences through Alertmanager for Temporal workflow executions that fail or time out — not just the workflows/thresholds covered by the hand-maintained Prometheus rules in `packages/homelab/.../monitoring/rules/temporal.ts`. Each watcher workflow has a hard budget of 100 detailed execution alerts across all activity attempts. The activity (`src/activities/workflow-failure-watch.ts`) persists both cursor progress and consumed detail budget in its heartbeat checkpoint, and conservatively rescans the full lookback on retry so the public visibility iterator cannot skip failures or reset the cap:

1. Queries the Temporal visibility API for `ExecutionStatus IN ("Failed", "TimedOut")` closed in the last 24 hours so a worker outage can be recovered by the next poll (safe to overlap because Alertmanager dedups alerts by label set and each alert expires from the execution's close time, not from the latest poll).
2. For at most the first 100 matches across all retries, calls `getHandle(workflowId, runId).fetchHistory()` and then `.result()`, with bounded concurrency and Alertmanager batches so recovery can page partial progress before the activity deadline. The history classifies timeouts as `workflow-task`, `activity`, `execution`, or `unknown`; an agent-task timeout before any `ACTIVITY_TASK_STARTED` event is explicitly a worker/task-queue availability failure, including scheduled-but-undispatched activities. The closed `result()` rejects immediately with `WorkflowFailedError`, whose `.cause` carries the same failure type/message/stack the Temporal UI shows.
3. Builds one `AlertmanagerAlert` per execution via the pure `buildWorkflowFailureAlert` helper (`src/shared/workflow-failure-alert.ts`) — labels `{alertname: "TemporalWorkflowFailed", workflowType, taskQueue, workflowId, runId}` for identity/dedup, plus a summary/description with the actual error, timeout classification/diagnosis, and a direct link to the failed run in the Temporal UI (`temporalUiExecutionUrl`).
4. Counts every remaining execution directly from visibility metadata without fetching history, then posts one stable critical `TemporalWorkflowFailureOverflow` alert with the omitted total and counts by workflow type/status. The overflow post must succeed before the cursor advances across omitted executions.
5. Posts via `createAlertmanagerPoster` (`src/lib/alertmanager.ts`, shared with the Xcode Cloud webhook), which routes through the existing Alertmanager Alerts receiver. Alertmanager groups the sampled details by normal `namespace`/`alertname`; the dashboard webhook independently caps each delivery at 100 alerts and records any upstream truncation.

No exclusion list — every workflow type contributes either a detailed occurrence or the overflow counts.

## Generic agent tasks

`agentTaskWorkflow` supports explicit one-off and cron-based report-only Codex
tasks. New submissions must use `provider: "codex"`; `provider: "claude"`
remains in the decoder only so existing Temporal histories replay
deterministically, and fresh Claude execution fails explicitly. It runs on
`TASK_QUEUES.AGENT_TASK` so long native SDK agents do not block HA or event-cron
work.

Create/update a task from a doc block locally as an operator:

```bash
cd packages/temporal
TEMPORAL_ADDRESS=localhost:7233 bun run scripts/schedule-agent-task.ts --from-doc /tmp/agent-task.md
```

`--from-doc` validates every `temporal-agent-task` block before connecting and
schedules all blocks in document order. Use separate blocks for distinct rollout
checkpoints.

Authenticated HTTP creation is the public ingress path:

```bash
curl -fsS https://temporal-agent-tasks.sjer.red/agent-tasks \
  -H "Authorization: Bearer $AGENT_TASK_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data @agent-task.json
```

Do not expose general-purpose Temporal scheduling as a public ingress path.
Narrow, dedicated APIs such as the authenticated sleep webhook are allowed;
agent-task creation must still go through `/agent-tasks` with
`Authorization: Bearer $AGENT_TASK_API_TOKEN`.

New inputs use `contractVersion: 2`, declare checks and independently executed
command or Prometheus collectors, and give every collector a source-defined
expectation. Command expectations evaluate an accepted exit code or typed JSON
path assertions; Prometheus expectations evaluate numeric samples with an
`all` or `any` quantifier. The worker owns those predicates and overrides a
model-authored pass when observed data fails one. Use `runAt` for one-off tasks
or `cron` + stable `scheduleId` for recurring tasks. Recurring schedules use `America/Los_Angeles`. Agents may
return one report-only `followUp`, which inherits the parent collectors, or a
`retirementRecommendation`; they cannot
pause, cancel, or delete schedules. The v1 decoder remains only for Temporal
history replay, and its undeclared output is always reported as partial.

**A v2 run is two bounded SDK phases, not one.** `investigateAgentTask` runs the
agent with its normal tool set and returns a preliminary assessment; the
declared collectors then run independently, and `finalizeAgentTask` re-runs the
agent over the merged receipt catalog with **no tools at all**.
`buildAgentTaskSdkConfig` empties `allowedTools`, but the Codex SDK exposes no
tool allow-list, so a Codex finalization thread drops
network, web search, and write access **and** `runCodexSdk` fails the run on the
first `command_execution`, `file_change`, `mcp_tool_call`, or `web_search` item
it observes during finalization; the phase contract is enforced on the event
stream rather than trusted to the sandbox. Provider evidence receipts are
extracted from the SDK's own redacted event stream, so a tool call the agent
only claims to have made cannot be cited.

**Codex structured output is an SDK result contract.** Pass the strict JSON
Schema through `thread.runStreamed({ outputSchema })`, read only the resulting
structured output, and Zod-validate it. Every field is required; optional
values are nullable. A successful stream without structured output is a
contract failure; never parse prose or fenced JSON. The legacy Claude schema
constants and provider decoder remain solely for replaying existing histories;
no new activity may select them. Contract failures log the schema fingerprint
and a bounded redacted final-text excerpt while metric labels remain
low-cardinality.

Run the post-deploy canary only after the worker image containing the change is
live and the production worker has its service-scoped `OPENROUTER_API_KEY`
configured.
From an operator machine, use the externally reachable Temporal TLS endpoint;
the in-cluster service name is only resolvable inside Kubernetes:

```bash
cd packages/temporal
TEMPORAL_ADDRESS=temporal.tailnet-1a49.ts.net:443 TEMPORAL_TLS=true \
  bun run canary:agent-task
```

This production-only contract check starts one real `agentTaskWorkflow` on the
`agent-task` queue and
must complete through the deployed Codex structured-output parser and deliver the tagged
`[agent-task-canary]` report-only email. It does not accept or forward a local
OpenRouter key; authentication is verified in the deployed worker.
Do not consider production acceptance complete until the canary and independent
seven-day agent-task queue bake pass; the
deterministic daily homelab audit no longer exercises this provider contract.

After shared reporting changes, also run `bun run
canary:report-reliability` with the same production Temporal environment. It
starts tagged v2 success, partial, and intentional-failure runs. Acceptance
requires all three emails, matching Temporal states, typed S3 report state and
Postal receipts, plus current delivery/freshness metrics.

Before enabling freshness enforcement in a namespace, run the read-only live
inventory and reconcile every live-only self-authored schedule into the
source-defined registry. The command never pauses, deletes, or updates a
schedule:

```bash
TEMPORAL_ADDRESS=temporal.tailnet-1a49.ts.net:443 TEMPORAL_TLS=true TEMPORAL_NAMESPACE=prod \
  bun run inventory:report-schedules
```

**Local deterministic audit (no Temporal)** — see `scripts/run-homelab-audit-local.ts`:

```bash
# DRY_RUN=1 runs the same typed collectors and report builder as production,
# then writes /tmp/homelab-audit-<ts>.{txt,html} without delivery.
op run --env-file=.env.audit -- DRY_RUN=1 bun run scripts/run-homelab-audit-local.ts

# Real send through the shared report sender (use a +audit-test alias):
op run --env-file=.env.audit -- bun run scripts/run-homelab-audit-local.ts
```

**Local Glitter context refresh (no Temporal)** — see
`scripts/run-glitter-context-refresh-local.ts`, exposed as `glitter:refresh-local`.
It runs the real `refreshGlitterContext` activity under `MockActivityEnvironment`
against the real corpus and the real generation-artifact cache, so it reproduces
a production failure without waiting for a worker image to ship:

```bash
cd packages/temporal
bun run glitter:refresh-local --dry-run=true --max-cost-usd=50 \
  --snapshot-id=<snapshot-id> --snapshot-sha256=<snapshot-sha256>
```

Needs `GLITTER_DISCORD_GUILD_ID`, the `GLITTER_CORPUS_S3_*` credentials, and
`OPENROUTER_API_KEY`; `--dry-run=false` also opens a PR and needs `GITHUB_APP_*`.
Artifacts are cached by request digest rather than by run, so this re-reads
whatever a production run already paid for instead of re-billing it — which is
also why pinning a snapshot reuses more cache than reading the latest one.

**Glitter context cache audit (Temporal, zero inference)** — use the operator
workflow before a manual refresh when you need exact current cache coverage:

```bash
cd packages/temporal
bun run glitter:operate context-audit \
  --snapshot-id=<snapshot-id> --snapshot-sha256=<snapshot-sha256> --wait=true
```

The audit runs on `glitter-context`, constructs the same production request
objects, fully validates current v3 artifacts, and reports exact hits, misses,
blocked synthesis stages, artifact keys, and worst-case uncached cost. It must
never call OpenRouter or write an artifact or spend receipt. The weekly refresh
is capped at $1; budget exhaustion leaves exact-key artifacts for later weekly
runs and opens no PR until a run completes. Do not add legacy-key reuse.
The shared synthesis request builder limits serialized input to 600,000 UTF-8
bytes, keeps the newest monthly summaries, and reports coverage only for the
summaries included. Its full Luna semantic-retry reservation must remain below
the weekly cap; generation and audit must both use that builder.

After deploying corpus-finalization memory changes, accept them with one fresh
daily run: attempt 1, no restart or probe failure, zero integrity failures, and
`memory.peak <= 3 GiB`. If it exceeds that threshold, split verification into
per-channel activities instead of increasing the 4 GiB limit. Follow with a
pinned cache audit and verify no new OpenRouter spans/cost or artifact/receipt
writes, then verify the next weekly run spends at most $1.

**Cluster RBAC** — the infra and agent worker SAs get the cluster-wide read-only
`temporal-worker-audit-reader` ClusterRole (see
`packages/homelab/src/cdk8s/src/resources/temporal/audit-rbac.ts`). A separate
TaskNotes namespace Role grants `pods/exec` only to the infra worker so the
engine-status token never leaves that pod. The agent worker is intentionally
absent from every pod-exec RoleBinding; the agent therefore cannot
exec into TaskNotes or deterministic maintenance targets even if it disregards
the report-only prompt. Its deployment env is also explicit: provider auth,
basic runtime/TLS settings, and non-secret Prometheus/alert-dashboard endpoints
only.

The generic agent's own environment is built by `envForProvider`
(`src/activities/agent-task-env.ts`) as an **allowlist**: basic process/TLS
settings, the read-only Kubernetes identity, the non-secret evidence endpoints,
and exactly one provider subscription credential. Every other worker
credential — Postal, S3, GitHub, Temporal, Talos, Grafana, ArgoCD — is absent,
so a prompt-injected agent has nothing to exfiltrate from its own environment.
Trusted, source-controlled agents (homelab audit, Scout season refresh) use
`envForTrustedAgent` instead, which keeps the operational read-only credentials
they need but still strips the bot's GitHub credentials, every report-delivery
credential, and **every** inference credential — direct API keys and the other
SDK's subscription token alike. These agents have Bash, so an unrelated
provider credential left in reach would be exfiltratable; each receives only
its own provider's credential, passed explicitly through `overrides`.

Native SDK agent runs execute as the worker's own uid, so the uid-1001
isolation still applies only to the deterministic evidence collectors, which
`providerSubprocessCommand` launches through `setpriv`. The Temporal poller runs
as root with every capability dropped except `SETUID`. A `NET_ADMIN` init
container installs owner-matched pod firewall rules rejecting uid-1001 traffic
to Temporal gRPC (`7233`), the UI (`8080`), and both Tailscale ingress addresses
on `443`. This pod-local rule is the current enforcement
layer because the homelab uses Flannel without a NetworkPolicy controller; the
separate agent `NetworkPolicy` records the intended boundary for a future
policy-capable CNI but is not treated as current enforcement. Restoring uid and
credential isolation for the native SDK agent itself is tracked in
`packages/docs/todos/agent-sdk-provider-isolation.md`. Generic agent
clones of this public repository are unauthenticated, and
new agent email delivery activities execute on `TASK_QUEUES.REPORTS`. Replayed
histories preserve their original agent-queue activity command for Temporal
determinism; that credential-free compatibility activity delegates a fixed
`deliverReportWorkflow` to `TASK_QUEUES.REPORTS`. Postal and report-state S3
credentials therefore remain in the reports worker in both paths. The outer email
activity budget must exceed the complete delegated delivery retry window; both
durations are defined in `src/shared/report-delivery-policy.ts`.

### Human email presentation contract

`ReportEnvelopeV1` is the persisted and replay-safe source of truth. Keep
subject selection and the human projection in
`src/shared/report-presentation.ts`, and keep HTML/plain-text formatting in
`src/shared/report-renderer.ts`; do not add presentation fields to Workflow or
Activity inputs. Both formats lead with outcome, summary, and action, then show
findings, optional context, plain-language checks, and a quiet technical footer.
The email omits internal report/workflow/run IDs, command text, coverage markers,
and evidence-receipt IDs while the archived envelope and delivery state retain
them. Evidence URLs attach to the relevant item as `View source`.

Every current report type must have a tailored subject policy. A new report type
may use the generic fallback only while its producer and tests are being built;
do not ship it without adding the exact subject matrix. Run `bun run
preview:report-emails` to inspect every current family and representative status
without Temporal, Postal, or an LLM.

### Report delivery is exclusive, not merely deduplicated

A stored `pending` delivery state is not evidence that the email was never
sent: Temporal can dispatch a new attempt once start-to-close elapses while the
previous one sits between the Postal call and its state write. Treating pending
as "not sent" duplicates the email; treating it as "sent" silently drops a
report whose owner died first. `deliverReportWithDependencies` therefore takes
an exclusive lease on the send — a conditional S3 write
(`If-None-Match`/`If-Match`) of a per-report claim object keyed off the state
key. A contending attempt never calls `send`; it fails so Temporal retries and
finds the owner's receipt. A lease older than `REPORT_SEND_CLAIM_TAKEOVER_MS`
is takeable, which is what stops a dead owner stranding the report.

Three constants in `src/shared/report-delivery-policy.ts` have to stay in
relation, and two of them are easy to break by adjusting an unrelated timeout:

- `REPORT_SEND_CLAIM_TAKEOVER_MS` must exceed the activity's start-to-close, or
  a takeover races an attempt Temporal would still accept a completion from.
- It must also exceed `REPORT_SEND_DEADLINE_MS`. Start-to-close abandons an
  attempt's _result_ but never aborts its in-flight `fetch`, so the send carries
  its own abort deadline; without that, a replaced owner's request could still
  land after the takeover already sent, turning a lost report into a duplicate.
- The first retry must start at or after the takeover bound
  (`REPORT_SEND_CLAIM_FIRST_RETRY_AT_MS`). Otherwise every remaining attempt
  lands inside the lease, throws on contention, and exhausts the budget — the
  stranded-report failure the lease exists to prevent.

`reportDeliverySendLeaseBounds()` states both margins positively and is
asserted in `agent-task-report-delivery.test.ts`.

The lease is stamped and aged on ONE clock: the start of the activity attempt
holding it, captured before any I/O and passed as `attemptStartedAt`. Every
deadline in that path is anchored to that same start; the remaining
`now()` calls are record timestamps (`updatedAt`, `acceptedAt`, `completedAt`),
never budgets. Two rules keep that true:

- **Arm a timeout where you measure it.** `AbortSignal.timeout` starts counting
  when constructed, so `reportSendAbortSignal` computes the remaining budget
  and arms the signal together, and is called inside the `send` arguments.
  Measuring before the pending-state write and arming after it let a slow write
  push the request past the takeover point — a real bug this shape produced.
- **Anchor leases to attempt start, not wall-clock now.** Timestamping at
  claim-write time lets slow pre-claim reads backdate a lease relative to its
  attempt, so a retry sees a dead owner's lease as unexpired and the report
  strands again, triggered by slow storage rather than short retries.

Recording a delivery cannot be fenced into the send: the receipt only exists
once Postal answers, so the accepted-state and receipt writes necessarily land
after it. `REPORT_SEND_PERSIST_BUDGET_MS` is the window the owner has to
persist inside its own lease.

**The receipt write is the arbiter, not the ownership check.**
`assertReportSendStillOwned` runs before persisting, but it is only a
narrowing: a takeover can land between checking and writing, so a check can
never decide this on its own. The receipt object is written create-only, so
storage picks exactly one winner atomically. An attempt that loses that write
fails instead of reporting success — its message was a duplicate and its
receipt is discarded. Do not relax the receipt write to an unconditional put,
and do not replace the create-only write with a read-then-write; that is the
bug this shape exists to prevent. S3 conditions apply to the object being
written, so the state object cannot be conditioned on the claim; the receipt
is authoritative and the read path checks it first, which is why a displaced
owner's stale `accepted` state cannot mislead a later reader.

**What this design does and does not guarantee.** It guarantees at-most-one
_recorded_ delivery — enforced by that create-only write, not by a check — and
no lost report. It does not guarantee at-most-one
_email_. Two paths reach a duplicate and neither is closable here:

- Postal accepts a message whose response never reaches the owner, so no
  receipt is written and the successor sends again.
- Postal accepts near the deadline and the owner is displaced before it can
  persist, so the successor has nothing to find.

Both need an idempotency key on the provider request — something Postal does
not offer — not a longer lease or another fence. Do not spend another round
widening timeouts against them; if duplicate emails become a real problem, the
fix is provider-side idempotency or a different transport.

- The lease compares timestamps written by different worker processes, so it
  assumes roughly synchronized clocks. Skew shifts the takeover point by the
  skew amount; the minute of margin on each bound absorbs ordinary NTP drift,
  but a badly skewed node would erode it.

## Scheduled PR-creating workflows

There are **two** Temporal scheduling patterns — don't conflate them:

- **Report-only agent-tasks** (`agentTaskWorkflow`, above) email reports and **cannot** open PRs/issues or edit files — `mode` is only `"report-only"` and the prompt forbids mutation.
- **Deterministic PR-creating workflows** (e.g. `src/activities/data-dragon.ts`, `llm-catalog-refresh.ts`, `homelab-crd-imports-refresh.ts`) regenerate artifacts then `git push --force-with-lease` + `gh pr create`, authed by a GitHub App installation token (`src/lib/github-app-token.ts` `createGitHubAppInstallationToken()`, env `GITHUB_APP_ID`/`GITHUB_APP_INSTALLATION_ID`/`GITHUB_APP_PRIVATE_KEY`). scout-for-lol's data-dragon refresh is the canonical example.

**The branch name is the idempotency key — derive it from retry-stable data.**
`openSeasonRefreshPr` prevents duplicate PRs by reusing an open PR whose head is
the branch it was given, so a branch built from a per-attempt value (a fresh
`crypto.randomUUID()`, a timestamp) silently defeats that reuse: any failure
after the PR is created retries the activity under a new branch and opens a
second PR. Derive it from the content (`data-dragon.ts` uses the Data Dragon
version; `lane-prior-refresh.ts` hashes the normalized lane-prior artifacts;
`llm-catalog-refresh.ts` hashes the proposed `catalog.json`) or from
the workflow's own args (`scout-season-refresh.ts`) — never from a value
generated inside the attempt. Scratch `/tmp` directories are the opposite: keep
those per-attempt so a retry cannot trip over a previous attempt's half-cleaned
clone.

**`--force-with-lease` does not protect the branch's CONTENT.** The lease only
proves the ref has not moved since the fetch. `openSeasonRefreshPr` builds its
commit with `git checkout -B` from a fresh main clone, so the fetched
`origin/<branch>` is never used as a base — an operator who commits an
adjudication onto an open proposal PR would have it replaced wholesale by the
next run landing on that branch. `assertRemoteBranchIsOurs` refuses the push
when the remote tip's author OR committer differs from the pair our own commit
just used. Both halves matter: `git commit --amend` keeps the original author
and records only a new committer, so an author-only check waves an in-place
edit straight through. Do not swap this for a tree comparison (a branch derived
from workflow args legitimately changes content every run) or a commit count
against main (`scout-season-refresh` clones `--depth 1`, so that history is
absent).

Data Dragon proposals are refreshed when their base is stale. The updater
regenerates from current `main`, but it first verifies the existing branch's
tip is still authored and committed by the bot. Human or amended commits are
never force-pushed over; those proposals require manual attention. Lane-prior
proposals use content-hash branches, so a changed result gets a new proposal
instead of replacing an operator's open review.

**Retry-stable is not sufficient — the key must also be stable across scheduled
runs.** The workflow run id survives retries but changes weekly, so while a
proposal sits unmerged `main` still holds the old artifact, the next run
regenerates the identical diff under a new branch, and `openSeasonRefreshPr`
opens a duplicate PR for a change already awaiting review. A content hash is
stable on both axes and additionally gives a genuinely changed proposal its own
PR, rather than force-pushing over one an operator is part-way through
adjudicating.

To add a "regenerate X on a schedule, open a PR if it changed" job, mirror `data-dragon.ts`: a deterministic activity (no Claude), GitHub App token, path-scoped `git add`, plus a thin workflow, an export in `src/workflows/index.ts`, and a `SCHEDULES` entry (cron, `America/Los_Angeles`, `TASK_QUEUES.WORKFLOWS`). Name the owning domain Activity queue on every `proxyActivities` call. The worker pod has bun/git/gh/kubectl (in-cluster SA — `homelab-crd-imports-daily` runs `kubectl get crds` with the read-only `temporal-worker-crd-reader` ClusterRole) but **not** helm — add tools to the worker image build (`Dockerfile`) if the job needs them (`bunx turbo run smoke --filter=temporal` builds + smoke-tests the image; CI builds/smokes/pushes it on merge to main). The image smoke must cover each toolkit passthrough whose native target is installed in the image. CLIs a job needs from the repo itself (e.g. `cdk8s` for the CRD imports) come from the bot clone's workspace install via a package devDependency, not the image.

Every PR-producing refresh must run `discardFormattingOnlyChanges` from `src/activities/scout-generated-preflight.ts` against its scoped generated text paths, then re-read Git status before publication. It compares generated bytes with committed `HEAD` bytes after both pass through the pinned Prettier and restores a path when they are formatter-equivalent. A formatter-only difference is no drift: it must not reach `git commit` or `gh pr create`; new files and real content changes remain eligible for review.

### Bot-clone environment — use `bot-clone.ts`, never hand-rolled installs

Every PR-creating activity clones the monorepo into `/tmp` and must prepare that clone through `src/activities/bot-clone.ts`:

- **`rootInstallWithoutHooks(repoDir)`** — root `bun install --frozen-lockfile --ignore-scripts`. Bot clones are **not dev checkouts**: historically a plain root install ran a root `prepare` script that armed the full dev pre-commit suite for the bot's later `git commit` inside the worker pod, where it couldn't pass (no gitleaks binary, no per-package toolchains) — this exact mistake broke `scout-season-refresh-weekly` and `readme-refresh-weekly` every week through June–July 2026. In dev, lefthook is armed manually (`bunx lefthook install`, not by an install script), and the bot must keep the hook-free `--ignore-scripts` install regardless: it's faster and skips any postinstall side-effects, while the Buildkite pipeline running on the bot's opened PR (plus a human reviewer) is the real gate.
- **`generateScoutBackend(repoDir)` / `buildLlmModels(repoDir)` / `buildGlitterContext(repoDir)` / `installScoutWorkspace(repoDir)`** — the hook-free install skips lifecycle scripts, so a fresh clone must explicitly generate Scout's Prisma client and branded types before snapshot tests, then build the shared producers with gitignored `dist/` entrypoints before Scout can run. `installScoutWorkspace` is the single owner of the hook-free root install plus backend generation and both producer builds; Scout activity callers must not call `rootInstallWithoutHooks` before it.

The **`scripts/rehearse-bot-clone.ts`** rehearsal script drives these same helpers plus a canary for the hook-free commit path. It is exposed as the `check:rehearsal` turbo task (`bunx turbo run check:rehearsal --filter=@shepherdjerred/temporal`, driven by `scripts/check-schedule-rehearsal.ts`; `cache:false` because it copies the whole repo tree and shells out to real tools turbo can't hash). It is part of the root `bun run verify` graph, which the Buildkite pipeline runs on every PR — nothing runs it on push, because the repo has no `pre-push` hook and the `pre-commit` hook only checks staged files. So a break in a scheduled activity's install/repo-path assumptions is caught by CI pre-merge rather than surfacing silently on the weekend; to catch it before you push, run it yourself with `bunx turbo run check:rehearsal --filter=@shepherdjerred/temporal`. If you add a new repo-path or install-step dependency to a scheduled activity, extend the rehearsal script in the same PR.

### `bun run --filter=<pkg>` ignores the cwd you passed — path flags must be absolute

`runCommand(..., { cwd })` sets the cwd of `bun` itself, but `bun run --filter=<pkg> <script>` then executes the script **with cwd set to that package**. Any repo-root-relative path handed to such a script therefore resolves against the package directory, not the repo root and not the `cwd` sitting right beside it in the same call.

This is not theoretical: the Data Dragon lane-prior step passed `--output packages/scout-for-lol/packages/data/src/lane-priors/lane-priors.generated.json` with `cwd` at the scout root, and the generator wrote to `…/packages/backend/packages/scout-for-lol/packages/data/…` on every run from 2026-05-17. It was silent until the allowlist landed (`git status` collapses that untracked tree to `packages/scout-for-lol/packages/backend/packages/`, a disallowed path), then reddened every scheduled run. The committed artifact was never once updated, and the eval step read back the same misplaced file, so it validated the wrong artifact and reported success.

- **Pass absolute paths** to any `--filter`ed script: `` `${repoDir}/${REPO_RELATIVE_CONST}` `` (`lanePriorArtifactPath` / `lanePriorEvalReportPath` in `data-dragon-lane-priors.ts`).
- **Keep the constants themselves repo-root-relative.** They also feed `git add --` and the `dataDragonDisallowedChangePaths` allowlist, both of which compare against `git status --porcelain` output. Join with `repoDir` at the call site only.
- **Assert the landing.** A generator exits 0 whether or not `--output` went where you asked, so `updateLanePriors` checks the artifact exists before the eval reads it. Prefer that over trusting the exit code.
- Alternatively resolve the path inside the CLI from `import.meta.url`, as `update-queue-windows.ts` does for its committed source of truth — cwd-independent by construction.

## Review threads (CI gate)

The Buildkite pipeline has one **blocking** Codex review gate on PR builds
(`scripts/review/wait-for-review.ts`, `.buildkite/pipeline.yml`, step key
`codex-review-gate`): every non-outdated Codex finding that still applies to the
latest revision must be resolved before the aggregate
`buildkite/monorepo/pr` required status can go green. The gate implementation
remains provider-neutral, and Qodo remains registered for optional/manual use;
it is not a required Buildkite gate for now.
These CI gates are wholly separate from the GitHub webhook server
(`## GitHub webhook` below), which handles only the merge-conflict check and
PR-closed build cancellation.

- **Gate on review threads, not the provider's own status.** A thread blocks iff authored by the active provider (`isProviderAuthor`, which strips the REST `[bot]` suffix so GraphQL `greptile-apps` / `chatgpt-codex-connector` and their `[bot]` REST forms compare equal) AND `!isResolved` AND `!isOutdated` AND its severity is at/above the threshold. Providers auto-resolve/outdate their own threads as referenced lines change.
- **Completion detection is provider-specific** (`CompletionStrategy` in the package). Qodo uses `issue-comment`: it keeps every finding in one persistent issue comment and posts a **separate acknowledgement** naming the commit it just read (`… was updated up to the latest commit <sha>`). That acknowledgement is the completion signal, not the review comment: Qodo relinks the review comment's findings to a new head within seconds of a push, long before re-reading the code, so the body alone proves nothing. While a re-review runs it replaces the rendered review with a `New Review Started` placeholder, which carries the review heading but no findings and is deliberately ignored. Codex uses `review-at-head`: its latest PR review must have `commit_id === head`, and a clean review is represented by the provider's 👍 reaction (`thumbsup-reaction`). For context, Greptile posts a check-run per reviewed commit (`.greptile/config.json` `statusCheck:true`), useful only as a "reviewed this head?" marker since it goes green with comments unresolved (verified on PR #1026).
- **A PR the provider never reviews can time out.** Qodo does **not** reliably re-review on push — it may relink its comment without re-reading — so a PR whose head was never reviewed stays `reviewing` until the gate times out. Re-trigger by commenting `/review` on the PR; the acknowledgement for the new head follows within a few minutes. (Greptile's empty-diff PRs post `No reviewable files…`, handled by the provider skip marker; Codex re-triggers with `@codex review`.) Such a PR needs a genuine reviewable diff, to be closed, or admin-merged once any conflict is cleared.

## GitHub webhook (merge-conflict check + PR-closed build cancel)

The whole in-repo PR review / summary / reaction-listener / babysit bot was
removed (it was gated off in production and carrying ~120 files of dead weight).
What remains of `src/event-bridge/github-webhook.ts` is the ingress for two
still-active, non-LLM features:

| Event                                               | Started workflow                | Purpose                                       |
| --------------------------------------------------- | ------------------------------- | --------------------------------------------- |
| `push` to `refs/heads/main`                         | `checkPrMergeConflictsWorkflow` | backfill `ci/merge-conflict` on every open PR |
| `pull_request` (opened/synchronize/reopened/edited) | `checkPrMergeConflictsWorkflow` | per-PR `ci/merge-conflict` status             |
| `pull_request` `closed`                             | `cancelBuildkiteBuildsWorkflow` | cancel still-running Buildkite builds         |

The Hono server verifies `X-Hub-Signature-256` (`GITHUB_WEBHOOK_SECRET`),
listens on `GITHUB_WEBHOOK_PORT` (9466), and is exposed as `pr-bot.sjer.red`
via a Cloudflare tunnel; the tofu webhook subscribes only `push` + `pull_request`.
Component log value: `pr-webhook`. Metrics: `pr_webhook_*` (received / skipped /
signature-failures) plus `pr_merge_conflict_check_*`.

Not to be confused with the **CI review gate** (`## Review threads (CI gate)`
above) — that is Qodo via `@shepherdjerred/code-review`, wholly separate from this
webhook.

## HA presence (welcomeHome / leavingHome / reconcileLock) — debounce model

HA `state_changed` events for `person.jerred` / `person.shuxin` flap at the home/not_home boundary (GPS / wifi / cell-tower jitter). `PRESENCE_COOLDOWN_SECONDS = 90` (`src/shared/presence.ts`) is the settle window everywhere.

**Front-door lock — owned by `reconcileLock`, not by the edge workflows.** The lock is the one side-effect that flaps audibly, so it is no longer actuated from `welcomeHome` / `leavingHome`. Instead `src/workflows/ha/reconcile-lock.ts` is a **singleton, debounced reconciler**:

- Every presence transition (both directions) calls `signalWithStart("reconcileLock", { workflowId: "reconcile-lock", signal: "presenceChanged" })` in `src/event-bridge/triggers.ts` — one workflow, started if absent, signalled if running. Attribute-only updates (`oldState === newState`, e.g. GPS coordinate churn) are ignored.
- The workflow blocks on `condition(() => edges !== seen, PRESENCE_COOLDOWN_SECONDS * 1000)` (the Temporal SDK timeout is in milliseconds); each signal bumps `edges` and restarts the wait. Reaching the timeout means a full window with no edge → the household has settled.
- Desired state is a pure function of who is home (`shouldLock(states)` — lock iff **nobody** is in the `home` zone; named zones / `unknown` count as away). It reads **live** lock + person state and **actuates only when current ≠ desired** (idempotent — a redundant trigger never clunks the bolt). A late edge during the read re-arms the loop.
- This makes lock/unlock races impossible: a single in-flight workflow, so an unlock and a lock can never both fire from one flap cycle.

**Lights / vacuums / notifications — still edge-triggered** via `welcomeHome` (arrival) and `leavingHome` (last departure). Each sleeps `PRESENCE_COOLDOWN_SECONDS` then rechecks presence (`anyoneHome()` / `everyoneAway()` from `./util.ts`); a single false transition exits as `phase=debounced`. Their workflow ids still use the `cooldownBucket()` tumbling window for dedupe — adequate for these lower-stakes effects, but note a tumbling window leaks across its boundary (it does **not** guarantee 90 s of separation); the lock no longer depends on it.

**Component log values / LogQL:** `{namespace="temporal"} | json | component="ha-presence"`. reconcileLock logs `phase=actuated` (with `desiredLocked`) or `phase=noop`.
