# packages/temporal

Temporal workflow worker for the monorepo. Consolidates ad-hoc scheduling (K8s CronJobs, in-process cron, custom job queues) under Temporal for durability, observability, and unified scheduling.

## Runtime

Runs under **Bun**. The Temporal TypeScript SDK supports Bun for workers, workflows, activities, and client.

Production uses the same Bun image in four Kubernetes Deployments selected by
`TEMPORAL_WORKER_ROLE`: `core` owns the `default` queue plus schedules and
HTTP/event surfaces; `agent` owns the `agent-task` queue under a read-only
service account with no pod-exec roles; `glitter` owns `glitter-corpus` and
`glitter-context`; `maintenance` owns the serial `maintenance` queue. The
default `all` role preserves the single-process local development behavior.
Keep new queue ownership explicit in `worker.ts` so a provider subprocess,
heavy Glitter failure, or maintenance subprocess cannot take down core
automation or inherit another role's Kubernetes permissions.

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

| To stop…             | Pause schedule id(s)                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Floor preheat        | `good-morning-weekday-preheat`, `good-morning-weekend-preheat`                                                                                                     |
| Wake-up (heat)       | `good-morning-weekday-wake`, `good-morning-weekend-wake`                                                                                                           |
| Get-up (volume ramp) | `good-morning-weekday-up`, `good-morning-weekend-up`                                                                                                               |
| Vacuum               | `vacuum-9am`, `vacuum-12pm`, `vacuum-5pm`                                                                                                                          |
| LoL / Scout data     | `scout-data-dragon-version-check`, `scout-data-dragon-weekly-refresh`, `scout-season-refresh-weekly`, `scout-showcase-refresh-weekly`, `scout-queue-windows-daily` |

### Catchup window (missed-run replay after a SERVER outage)

`catchupWindow` controls whether a run missed while the Temporal **server** was down gets
replayed on recovery. (A worker restart/deploy does **not** drop runs — the server still
creates the action on time and it queues.) Two tiers, set in `buildSchedulePolicies`:

- `CATCHUP_TIGHT` (5 min) on time-of-day home automation (vacuum, good-morning): skip rather
  than fire a wake-up/vacuum hours late.
- `CATCHUP_RELAXED` (1 hour, the default for everything else): reports/maintenance still run
  late after an outage. Override per-schedule via the optional `catchupWindow` field.

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
bun run start        # Start worker (connects to Temporal server)
bun run typecheck    # Type check (runs ensure-ha-schema first)
bun run lint         # ESLint
bun test             # Run tests (incl. workflow-bundle smoke test)
bun run generate     # Regenerate src/generated/ha-schema.ts from live HA (needs HA_URL + HA_TOKEN)
```

The `bun test` run includes a workflow-bundle smoke test (`src/workflows/bundle.test.ts`) that runs the same webpack pass `Worker.create()` performs at startup. If you import an activity helper into a workflow file and this test starts failing, move the helper to `src/shared/` (a pure module with no Sentry/observability imports).

## LLM observability

Every LLM call in this package must emit a `gen_ai.*` span; the archive
processor registered in `src/observability/tracing.ts` uploads prompt/response
bodies to S3 (`llm-archive` bucket) and forwards a slim span to Tempo.

- **SDK calls** — wrap with `traceAnthropic` / `traceOpenAi` from
  `@shepherdjerred/llm-observability` (deps-summary does this).
- **`claude -p` subprocesses** — call `traceClaudeCli` with the captured
  stdout after exit (agent-task and Scout season refresh). Spans
  carry `gen_ai.system="claude_code_cli"`, which
  distinguishes subscription-billed CLI runs from API-billed `anthropic`, plus
  `llm.cost_usd` from the result message.
- **`codex exec` subprocesses** — pump stdout NDJSON (`--json`) into the shared
  codex adapter; agent-task does both providers via
  `src/activities/agent-task-llm-trace.ts` (`startAgentTaskLlmTrace`). New CLI
  activities should reuse that helper rather than hand-rolling.

Emit the span **before** exit-code/cancellation failure checks — failed runs
spent tokens and must be visible for billing.

## HA schema (type-safe workflows)

Workflows that touch Home Assistant go through `src/workflows/ha/util.ts`, which wraps each activity in a schema-parameterized signature — entity IDs, domains, services, and service data are type-checked against `src/generated/ha-schema.ts`.

That file is **gitignored** (`packages/temporal/.gitignore`). It is produced by `@shepherdjerred/home-assistant`'s `ha-codegen` CLI and contains entity IDs / service definitions from the live HA instance, which is treated as sensitive (see the `HA types are sensitive, generate in CI` auto-memory).

Two committed artifacts make this work without always needing HA credentials:

- `src/generated/ha-schema.stub.ts` — a permissive `DefaultHaSchema` fallback. No sensitive content.
- `scripts/ensure-ha-schema.ts` — pre-script that copies the stub into `ha-schema.ts` when the generated file is missing. Invoked automatically by `bun run typecheck`, `bun test`, and `bun run build`.

Workflow:

- **Local dev with HA access**: `bun run generate` populates `ha-schema.ts` with real data. Workflows get strict type safety. Don't commit the result.
- **Local dev without HA access**: stub flows in automatically via `ensure-ha-schema.ts`. Workflows typecheck against `DefaultHaSchema` (loose strings). Same compile behavior as before this feature landed.
- **CI has no HA credentials**: the stub keeps `bun run typecheck` green in the Buildkite pipeline (and anywhere else) without HA access; strict typing requires a local `bun run generate` against live HA.

## Environment Variables

- `TEMPORAL_ADDRESS` — Temporal server gRPC address (default: `temporal-server.temporal.svc.cluster.local:7233`)
- `TEMPORAL_WORKER_ROLE` — process role: `all` (default/local), `core`, `agent`, `glitter`, or `maintenance`. Invalid values fail startup.
- `HA_URL` — Home Assistant URL
- `HA_TOKEN` — Home Assistant long-lived access token
- `GOLINK_URL` — Golink service URL
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT` — S3/SeaweedFS credentials
- `REVIEW_SIGNAL_ARCHIVE_BUCKET` — S3/SeaweedFS bucket the review-signal collector writes NDJSON archives to (`review-signals/<temporal-run-id>.ndjson` — the object is keyed by the Temporal workflow run id, with no wall-clock component, so an activity retry overwrites idempotently rather than forking a second object; each NDJSON event carries its own `ts`). Optional — defaults to the existing `llm-archive` bucket (namespaced by the key prefix), so no new bucket/env is needed to start collecting
- `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY` — GitHub App credentials used to mint short-lived installation tokens for GitHub automation so GitHub attributes those actions to the app bot.
- `OPENAI_API_KEY` — OpenAI API key
- `CLAUDE_CODE_OAUTH_TOKEN` — Claude Code subscription token. Auth for generic agent-task and Scout season subprocesses. These activities defensively strip any `ANTHROPIC_API_KEY` from the subprocess env so work bills against the subscription, not direct-API credits; the temporal worker does not wire `ANTHROPIC_API_KEY`.
- `POSTAL_HOST`, `POSTAL_API_KEY` — Postal email service
- `RECIPIENT_EMAIL`, `SENDER_EMAIL` — Email addresses for dependency summary and homelab audit
- `AGENT_TASK_API_TOKEN` — required bearer token for the authenticated `/agent-tasks` scheduling API on port 9467
- `SLEEP_WEBHOOK_TOKEN` — bearer token for the direct iOS sleep webhook on port 9469; the listener is skipped when unset (local/dev workers can omit it)
- `SLEEP_WEBHOOK_PORT` — port for the direct sleep webhook (default `9469`)
- `RUNBOOK_PATH` — local override for the homelab-audit runbook (defaults to fetching `https://raw.githubusercontent.com/.../packages/docs/guides/2026-04-04_homelab-audit-runbook.md`)
- `ALERT_DASHBOARD_URL` — in-cluster Alerts API URL (homelab audit)
- `BUGSINK_URL`, `BUGSINK_TOKEN` — Bugsink REST API base + token (homelab audit)
- `GRAFANA_URL`, `GRAFANA_API_KEY` — Grafana base + API key (PromQL/Loki via the `/api/datasources/proxy/<id>/...` endpoints)
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

## Homelab audit (daily)

`homelab-audit-daily` (cron `30 6 * * *` PT) runs the deterministic
`runHomelabAuditWorkflow` on the default queue. Typed collectors own the six
required checks: Prometheus alerts, durable alert occurrences, Temporal
failures/stalls, Kubernetes workload health, ArgoCD state, and Buildkite main
failures with failed-job logs. An optional model call may write only the
80-word synthesis over those collector results; it cannot choose the verdict.
Pre-versioned legacy executions still replay through the old agent activity and
are delivered through the shared reporter as partial.

## Temporal workflow failure → Alerts occurrences

`temporal-failure-watch` (cron `*/5 * * * *`, `pollWorkflowFailuresWorkflow` on `TASK_QUEUES.DEFAULT`) sends an Alerts occurrence through Alertmanager with the specific error for **every** Temporal workflow execution that fails or times out — not just the workflows/thresholds covered by the hand-maintained Prometheus rules in `packages/homelab/.../monitoring/rules/temporal.ts`. The activity (`src/activities/workflow-failure-watch.ts`) heartbeats a best-effort batch checkpoint and conservatively rescans the full lookback on retry so the public visibility iterator cannot skip failures:

1. Queries the Temporal visibility API for `ExecutionStatus IN ("Failed", "TimedOut")` closed in the last 24 hours so a worker outage can be recovered by the next poll (safe to overlap because Alertmanager dedups alerts by label set and each alert expires from the execution's close time, not from the latest poll).
2. For each match, calls `getHandle(workflowId, runId).fetchHistory()` and then `.result()`, with bounded concurrency and Alertmanager batches so recovery can page partial progress before the activity deadline. The history classifies timeouts as `workflow-task`, `activity`, `execution`, or `unknown`; an agent-task timeout before any `ACTIVITY_TASK_STARTED` event is explicitly a worker/task-queue availability failure, including scheduled-but-undispatched activities. The closed `result()` rejects immediately with `WorkflowFailedError`, whose `.cause` carries the same failure type/message/stack the Temporal UI shows.
3. Builds one `AlertmanagerAlert` per execution via the pure `buildWorkflowFailureAlert` helper (`src/shared/workflow-failure-alert.ts`) — labels `{alertname: "TemporalWorkflowFailed", workflowType, taskQueue, workflowId, runId}` for identity/dedup, plus a summary/description with the actual error, timeout classification/diagnosis, and a direct link to the failed run in the Temporal UI (`temporalUiExecutionUrl`).
4. Posts the batch via `createAlertmanagerPoster` (`src/lib/alertmanager.ts`, shared with the Xcode Cloud webhook), which routes through the existing Alertmanager Alerts receiver.

No exclusion list — every workflow type produces an occurrence on any failure, including per-PR bots (`prReview`/`prSummary`) that the older threshold-based rules deliberately exclude. Revisit with an exclusion list if that proves too noisy. See `packages/docs/plans/2026-07-30_temporal-workflow-failure-pagerduty-alerts.md` for the full design rationale.

## Generic agent tasks

`agentTaskWorkflow` supports explicit one-off and cron-based report-only Claude/Codex tasks. It runs on `TASK_QUEUES.AGENT_TASK` so long LLM subprocesses do not block HA or event-cron work.

Create/update a task from a doc block locally as an operator:

```bash
cd packages/temporal
TEMPORAL_ADDRESS=localhost:7233 bun run scripts/schedule-agent-task.ts --from-doc ../../packages/docs/guides/example.md
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

**`claude -p --json-schema` gotcha (claude-code).** Pass the schema **inline** (`--json-schema "$(cat schema.json)"`), never a file path — a path wedges the CLI (zero bytes on stdout+stderr until killed) and was the 100% root cause of the agent-task / alert-remediation 30-min SIGTERM(143) hangs (PR #1264). The validated object is in the result message's **`structured_output`** field, NOT `result` (which is the model's prose) — read `parseClaudeResultMessage(stdout).structured_output` and Zod-validate it. A successful process without `structured_output` is a contract failure; never parse prose or fenced JSON. Keep `--output-format stream-json --verbose` and pump **stdout** line-by-line for liveness: `claude -p` is silent on stderr, so a stderr-only idle detector is structurally blind. The Claude schema is draft-07 with `$schema` and `format` annotations removed, and the image pin is `2.1.220` (minimum `2.1.205`).

**Claude and Codex need different schema dialects — never share one constant.** `AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE` (`shared/agent-task.ts`) is a versioned draft-07 **plain** JSON Schema: optional fields simply absent from `required`, no nullable unions, with a logged schema fingerprint. `AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX` (generated via OpenAI's `zodResponseFormat()`) is OpenAI Structured-Outputs **strict mode**: every field in `required`, optional fields modeled as nullable. Codex's `--output-schema` needs strict mode; Claude's `--json-schema` gets the provider-specific plain contract. Contract failures log the CLI result subtype, result-message keys, fingerprint, and a bounded redacted final-text excerpt, while the metric labels remain low-cardinality.

Run the post-deploy canary only after the worker image containing the change is
live and the production worker has its `CLAUDE_CODE_OAUTH_TOKEN` configured.
From an operator machine, use the externally reachable Temporal TLS endpoint;
the in-cluster service name is only resolvable inside Kubernetes:

```bash
cd packages/temporal
TEMPORAL_ADDRESS=temporal.tailnet-1a49.ts.net:443 TEMPORAL_TLS=true \
  bun run canary:agent-task
```

This production-only contract check starts one real `agentTaskWorkflow` on the
`agent-task` queue and
must complete through the deployed Claude parser and deliver the tagged
`[agent-task-canary]` report-only email. It does not accept or forward a local
OAuth token; authentication is verified in the deployed worker. Keep
`packages/docs/todos/homelab-audit-agent-task-production-verification.md` open
until the canary and independent seven-day agent-task queue bake pass; the
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
TEMPORAL_ADDRESS=temporal.tailnet-1a49.ts.net:443 TEMPORAL_TLS=true \
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

**Cluster RBAC** — the core and agent worker SAs get the cluster-wide read-only
`temporal-worker-audit-reader` ClusterRole (see
`packages/homelab/src/cdk8s/src/resources/temporal/audit-rbac.ts`). A separate
TaskNotes namespace Role grants `pods/exec` only to the core worker so the
engine-status token never leaves that pod. The agent worker is intentionally
absent from every pod-exec RoleBinding; provider subprocesses therefore cannot
exec into TaskNotes or deterministic maintenance targets even if they disregard
the report-only prompt. Its deployment env is also explicit: provider auth,
basic runtime/TLS settings, and non-secret Prometheus/alert-dashboard endpoints
only. Provider auth remains in the parent worker, which exposes one
provider-specific loopback broker per run; the uid-1001 subprocess receives only
an ephemeral broker credential. The broker accepts only the provider's fixed
inference paths and injects the real credential into a fixed upstream origin.
The Temporal poller runs as root with every capability dropped except `SETUID`;
`setpriv` launches provider commands as uid 1001 with no retained capabilities.
A `NET_ADMIN` init container
installs owner-matched pod firewall rules rejecting uid-1001 traffic to Temporal
gRPC (`7233`), the UI (`8080`), and both Tailscale ingress addresses on `443`.
This pod-local rule is the current enforcement
layer because the homelab uses Flannel without a NetworkPolicy controller; the
separate agent `NetworkPolicy` records the intended boundary for a future
policy-capable CNI but is not treated as current enforcement. Generic agent
clones of this public repository are unauthenticated, and
new agent email delivery activities execute on `TASK_QUEUES.DEFAULT`. Replayed
histories preserve their original agent-queue activity command for Temporal
determinism; that credential-free compatibility activity delegates a fixed
`deliverReportWorkflow` to `TASK_QUEUES.DEFAULT`. Postal and report-state S3
credentials therefore remain in the core worker in both paths. The outer email
activity budget must exceed the complete delegated delivery retry window; both
durations are defined in `src/shared/report-delivery-policy.ts`.

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
version; `llm-catalog-refresh.ts` hashes the proposed `catalog.json`) or from
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
when the remote tip's author differs from the identity our own commit just
used. Do not swap that for a tree comparison (a branch derived from workflow
args legitimately changes content every run) or a commit count against main
(`scout-season-refresh` clones `--depth 1`, so that history is absent).

**Retry-stable is not sufficient — the key must also be stable across scheduled
runs.** The workflow run id survives retries but changes weekly, so while a
proposal sits unmerged `main` still holds the old artifact, the next run
regenerates the identical diff under a new branch, and `openSeasonRefreshPr`
opens a duplicate PR for a change already awaiting review. A content hash is
stable on both axes and additionally gives a genuinely changed proposal its own
PR, rather than force-pushing over one an operator is part-way through
adjudicating.

To add a "regenerate X on a schedule, open a PR if it changed" job, mirror `data-dragon.ts`: a deterministic activity (no Claude), GitHub App token, path-scoped `git add`, plus a thin workflow, an export in `src/workflows/index.ts`, and a `SCHEDULES` entry (cron, `America/Los_Angeles`, `TASK_QUEUES.DEFAULT`). The worker pod has bun/git/gh/kubectl (in-cluster SA — `homelab-crd-imports-daily` runs `kubectl get crds` with the read-only `temporal-worker-crd-reader` ClusterRole) but **not** helm — add tools to the worker image build (`Dockerfile`) if the job needs them (`bunx turbo run smoke --filter=temporal` builds + smoke-tests the image; CI builds/smokes/pushes it on merge to main). CLIs a job needs from the repo itself (e.g. `cdk8s` for the CRD imports) come from the bot clone's workspace install via a package devDependency, not the image.

### Bot-clone environment — use `bot-clone.ts`, never hand-rolled installs

Every PR-creating activity clones the monorepo into `/tmp` and must prepare that clone through `src/activities/bot-clone.ts`:

- **`rootInstallWithoutHooks(repoDir)`** — root `bun install --frozen-lockfile --ignore-scripts`. Bot clones are **not dev checkouts**: historically a plain root install ran a root `prepare` script that armed the full dev pre-commit suite for the bot's later `git commit` inside the worker pod, where it couldn't pass (no gitleaks binary, no per-package toolchains) — this exact mistake broke `scout-season-refresh-weekly` and `readme-refresh-weekly` every week through June–July 2026. In dev, lefthook is armed manually (`bunx lefthook install`, not by an install script), and the bot must keep the hook-free `--ignore-scripts` install regardless: it's faster and skips any postinstall side-effects, while the Buildkite pipeline running on the bot's opened PR (plus a human reviewer) is the real gate.
- **`buildLlmModels(repoDir)` / `buildGlitterContext(repoDir)` / `installScoutWorkspace(repoDir)`** — the shared producers have gitignored `dist/` entrypoints, so a fresh clone must build them before Scout can run. `installScoutWorkspace` is the single owner of the hook-free root install plus both producer builds; Scout activity callers must not call `rootInstallWithoutHooks` before it.

The **`scripts/rehearse-bot-clone.ts`** rehearsal script drives these same helpers plus a canary for the hook-free commit path. It is exposed as the `check:rehearsal` turbo task (`bunx turbo run check:rehearsal --filter=@shepherdjerred/temporal`, driven by `scripts/check-schedule-rehearsal.ts`; `cache:false` because it copies the whole repo tree and shells out to real tools turbo can't hash). It is part of the root `bun run verify` graph, which the Buildkite pipeline runs on every PR — nothing runs it on push, because the repo has no `pre-push` hook and the `pre-commit` hook only checks staged files. So a break in a scheduled activity's install/repo-path assumptions is caught by CI pre-merge rather than surfacing silently on the weekend; to catch it before you push, run it yourself with `bunx turbo run check:rehearsal --filter=@shepherdjerred/temporal`. If you add a new repo-path or install-step dependency to a scheduled activity, extend the rehearsal script in the same PR.

## Review threads (CI gate)

The Buildkite pipeline has a **blocking** review gate on PR builds (`scripts/wait-for-review.ts`, `.buildkite/pipeline.yml`, step key `review-gate`): every non-outdated Qodo review finding that still applies to the latest revision must be resolved before the aggregate `buildkite/monorepo/pr` required status can go green. The gate implementation remains provider-neutral, and all provider-specific knowledge lives in `@shepherdjerred/code-review`, but the repository-required provider is centrally pinned to Qodo so CI and the durable signal collector cannot drift. `REVIEW_PROVIDER` may be omitted or explicitly set to `qodo`; any other value fails loudly. This CI gate is wholly separate from the GitHub webhook server (`## GitHub webhook` below), which handles only the merge-conflict check and PR-closed build cancellation.

- **Gate on review threads, not the provider's own status.** A thread blocks iff authored by the active provider (`isProviderAuthor`, which strips the REST `[bot]` suffix so GraphQL `greptile-apps` / `chatgpt-codex-connector` and their `[bot]` REST forms compare equal) AND `!isResolved` AND `!isOutdated` AND its severity is at/above the threshold. Providers auto-resolve/outdate their own threads as referenced lines change.
- **Completion detection is provider-specific** (`CompletionStrategy` in the package). Qodo — the required provider — uses `issue-comment`: it keeps every finding in one persistent issue comment and posts a **separate acknowledgement** naming the commit it just read (`… was updated up to the latest commit <sha>`). That acknowledgement is the completion signal, not the review comment: Qodo relinks the review comment's findings to a new head within seconds of a push, long before re-reading the code, so the body alone proves nothing. While a re-review runs it replaces the rendered review with a `New Review Started` placeholder, which carries the review heading but no findings and is deliberately ignored. For context, the other strategies: Greptile posts a check-run per reviewed commit (`.greptile/config.json` `statusCheck:true`), useful only as a "reviewed this head?" marker since it goes green with comments unresolved (verified on PR #1026); Codex posts no check-run and is reviewed once its latest PR review's `commit_id === head`, leaving only a 👍 reaction on a clean PR (`thumbsup-reaction`).
- **A PR the provider never reviews can time out.** Qodo does **not** reliably re-review on push — it may relink its comment without re-reading — so a PR whose head was never reviewed stays `reviewing` until the gate times out. Re-trigger by commenting `/review` on the PR; the acknowledgement for the new head follows within a few minutes. (Greptile's empty-diff PRs post `No reviewable files…`, handled by the provider skip marker; Codex re-triggers with `@codex review`.) Such a PR needs a genuine reviewable diff, to be closed, or admin-merged once any conflict is cleared.

### Durable review-signal collector (`review-signals-collect`)

Separate from the CI gate above: `review-signals-collect` (cron `0 */6 * * *` PT, `observeReviewSignalsWorkflow` on `TASK_QUEUES.DEFAULT`) is a scheduled job, not a per-PR gate. Every 6 hours it lists the most-recently-updated PRs (`GET /repos/{repo}/pulls?state=all&sort=updated&direction=desc`, `ObserveReviewSignalsInput.limit`, default 30) and, for each, builds the same provider-neutral `ReviewSignalEvent` the gate computes (`src/activities/observe-review-signals.ts`, mirroring `scripts/probe-review-signal.ts` / `scripts/wait-for-review.ts` including the head-commit latency guard). It records `review_*` Prometheus metrics (`src/observability/metrics.ts`) and writes the batch as NDJSON to S3 at `review-signals/<temporal-run-id>.ndjson` in `REVIEW_SIGNAL_ARCHIVE_BUCKET` (default `llm-archive`; same shared `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`S3_ENDPOINT` credentials as every other S3 writer in this package — see `homelab-audit-archive.ts` for the pattern this follows) — a durable, queryable "what did the review bot do and when" dataset independent of ephemeral CI logs. The object is keyed by the workflow run id (not a wall-clock timestamp) so an activity retry overwrites the same object idempotently; each event carries its own `ts` for time-filtering. A single PR's fetch failing is logged + skipped (`errored` in the result); a token-mint or PR-listing failure fails the whole run. The pure aggregation helper (`src/shared/review-signals.ts`, `summarizeReviewSignals`) is unit-tested and safe to import from workflow code — no I/O, no Sentry.

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
