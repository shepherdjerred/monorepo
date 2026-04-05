# Temporal Migration Plan

## Context

The monorepo has a Temporal server deployed on K8s (v1.29.5, PostgreSQL backend, gRPC on 7233, UI on 8080 via Tailscale) but zero workflows or workers. Multiple packages implement ad-hoc workflow patterns: custom job queues, cron schedulers, orchestration primitives, and K8s CronJobs. This plan consolidates them under Temporal for durability, observability, and unified scheduling.

## Critical: Bun Compatibility

The Temporal TypeScript SDK worker uses a native Rust core (`neon-load-or-build`) and Node.js `vm` for workflow sandboxing. **Bun does not support this.** The worker must run under Node.js. Activities are normal async functions (Bun-compatible). The `@temporalio/client` package works under Bun for triggering workflows from other services.

## Package Structure

New package: `packages/temporal/`

```
packages/temporal/
  package.json              # @temporalio/client, worker, workflow, activity, zod
  tsconfig.json             # Node.js-compatible target
  Dockerfile                # Node.js base image
  CLAUDE.md
  src/
    worker.ts               # Worker entrypoint
    client.ts               # Shared client factory
    shared/
      task-queues.ts        # Task queue name constants
      schemas.ts            # Zod schemas for workflow inputs
    workflows/
      ha/                   # HA automation workflows
      fetcher/              # Skill Capped fetcher
      deps-email/           # Dependency summary pipeline
      sentinel/             # Agent job orchestration
      scout/                # Scout for LoL periodic tasks
    activities/
      ha/                   # HA REST API calls (replaces @digital-alchemy for orchestration)
      fetcher/              # Firebase + S3
      deps-email/           # Git, release notes, LLM, email
      sentinel/             # Claude Agent SDK, Discord
      scout/                # Prisma DB operations, Discord
    schedules/
      register-schedules.ts # Creates/updates all Temporal schedules on startup
```

## Worker Topology

**Phase 1: Single worker, single task queue (`default`)**. One K8s Deployment running all workflows and activities. Task queue names are constants in `shared/task-queues.ts` so per-domain queues can be split later without code changes.

**Exception: Scout for LoL** runs its own worker on a `scout` task queue inside the Scout backend, since its activities need direct Prisma client and Discord.js access. The central worker starts the schedules, Scout's worker processes the work.

## Namespace Strategy

Single `default` namespace (already created by namespace-init job). All workflows are same-owner; namespace isolation adds no value.

## What to Migrate

### Phase 0: Foundation

Create `packages/temporal/` with worker, client factory, task queue constants, Dockerfile. Add cdk8s resources:

- `packages/homelab/src/cdk8s/src/resources/temporal/worker.ts` -- K8s Deployment
- Update `temporal.ts` chart to include worker
- Update NetworkPolicy: worker needs egress to Temporal server (7233), HA, GitHub, Anthropic, Discord, SMTP
- Add worker image to `versions.ts`
- Add Docker build to CI pipeline

**Verify**: Worker starts, connects to Temporal server, visible in Temporal UI.

### Phase 1: Simple Batch Pipelines

**1a. Better Skill Capped Fetcher** (`packages/better-skill-capped/fetcher/`)

Current: K8s CronJob every 15 min. Firebase Firestore -> fetch JSON -> save to disk -> upload to S3.

- Workflow: `fetchSkillCappedManifest` -- sequential activity calls
- Activities: `getFirestoreManifestUrl()`, `fetchManifestJson(url)`, `uploadToS3(config, body)`
- Schedule: `*/15 * * * *`
- Remove: K8s CronJob from `packages/homelab/src/cdk8s/src/resources/better-skill-capped-fetcher.ts`

**1b. Dependency Summary Email** (`packages/homelab/src/deps-email/`)

Current: K8s CronJob Monday 9 AM. Clone repo -> parse diffs -> fetch release notes -> LLM summarize -> format HTML -> send email.

- Workflow: `generateDependencySummary` -- sequential pipeline
- Activities: `cloneAndGetVersionChanges(daysBack)`, `fetchReleaseNotes(changes)`, `summarizeWithLLM(changes, notes)`, `formatAndSendEmail(changes, summary, failures)`
- Schedule: `0 9 * * MON`
- Remove: K8s CronJob manifest

**Verify**: Workflows execute on schedule, produce identical outputs to current CronJobs.

### Phase 2: Home Assistant Automations

**2a. Event Bridge**

Slim `packages/homelab/src/ha/` to an event listener + Temporal client. Keep `@digital-alchemy/hass` for WebSocket event subscription only. On events (person state change, time triggers): call `temporalClient.workflow.start()`.

**2b. Activities (HA REST API)**

Replace `@digital-alchemy/hass` service calls with direct HA REST API:

- `callHassService(domain, service, serviceData)` -- POST `/api/services/{domain}/{service}`
- `getEntityState(entityId)` -- GET `/api/states/{entityId}`
- `sendNotification(title, message)` -- calls `notify.notify` service

**2c. Workflow translations**

| Current Pattern                                      | Temporal Equivalent                                      |
| ---------------------------------------------------- | -------------------------------------------------------- |
| `runParallel([...])`                                 | `Promise.all([activity1(), activity2()])` in workflow    |
| `runSequential([...])`                               | Sequential `await activity()` calls                      |
| `runSequentialWithDelay([...], delay)`               | `await activity(); await sleep(delay); await activity()` |
| `withTimeout(promise, duration)`                     | Activity-level `scheduleToCloseTimeout`                  |
| `verifyAfterDelay(entity, expected, delay, retries)` | `await sleep(delay); for (retries) { check + sleep }`    |
| `wait(time)`                                         | `await sleep(duration)` -- durable timer                 |
| `runIf(condition, fn)`                               | Normal `if` in workflow code                             |

**2d. Schedules and triggers**

- good-morning: 3 schedules (early/wake-up/get-up) for weekday/weekend
- good-night, climate-control, vacuum: schedules
- welcome-home, leaving-home: event bridge triggers on person entity state change

**Verify**: Trigger each workflow from Temporal UI, confirm devices respond. Then switch to schedules/events.

### Phase 3: Scout for LoL (Partial)

Migrate 6 infrequent cron jobs. Keep 30s pre-match and 1min post-match as in-process cron (Temporal overhead disproportionate at that frequency).

**Migrate:**

- Competition lifecycle (15min)
- Data validation (hourly)
- Daily leaderboard update (midnight UTC)
- Player pruning (3 AM UTC)
- Abandoned guild cleanup (4 AM UTC)
- Weekly pairing update (Sunday 6 PM UTC)

**Approach**: Scout backend runs its own Temporal worker on `scout` task queue. Activities import existing task functions. Remove migrated entries from `packages/scout-for-lol/packages/backend/src/league/cron.ts`.

### Phase 4: Sentinel

Sentinel's architecture maps 1:1 to Temporal:

| Sentinel                  | Temporal                            |
| ------------------------- | ----------------------------------- |
| SQLite job queue (Prisma) | Task queue                          |
| Worker loop               | Temporal worker                     |
| Cron adapter              | Temporal schedules                  |
| Webhook adapter           | Workflow start from webhook handler |
| Job timeout               | Workflow execution timeout          |
| Retry/recovery            | Retry policies                      |

**Workflow**: `agentJob(agent, prompt, triggerType, triggerSource)`

- Activities: `buildMemoryContext`, `runAgentQuery`, `logConversation`, `sendDiscordNotification`
- `runAgentQuery` must heartbeat (use Agent SDK streaming events)

**Discord approval**: Temporal signals. Workflow sends Discord message (activity), waits on `approvalReceived` signal. Discord bot handler calls `workflowHandle.signal()`.

**Remove**: `poc/sentinel/src/queue/`, cron adapter, Prisma Job model. Keep Hono for webhooks (triggers workflow starts). Keep Discord client (sends signals).

### Phase 5: Cleanup

- Remove custom `instrumentWorkflow` from HA (Temporal provides metrics)
- Configure Temporal SDK Prometheus metrics
- Grafana dashboards for workflow execution
- Alert on workflow failures
- Remove replaced K8s CronJob manifests
- Update ArgoCD applications

## What NOT to Migrate

| Candidate                                 | Reason                                                                |
| ----------------------------------------- | --------------------------------------------------------------------- |
| Bugsink Housekeeping                      | Requires bugsink Python environment; K8s CronJob is correct           |
| Golink Sync                               | Requires kubectl + Tailscale sidecar; ArgoCD PostSync hook is correct |
| Toolkit Daemon                            | Local filesystem watcher; reactive, not workflow-shaped               |
| Scout pre-match (30s) / post-match (1min) | Frequency too high for Temporal workflow overhead                     |

## Key Files to Modify

- `packages/homelab/src/cdk8s/src/resources/temporal/` -- add `worker.ts`
- `packages/homelab/src/cdk8s/src/cdk8s-charts/temporal.ts` -- add worker to chart
- `packages/homelab/src/cdk8s/src/versions.ts` -- add worker image
- `packages/homelab/src/ha/src/main.ts` -- slim to event bridge
- `packages/homelab/src/ha/src/util.ts` -- orchestration primitives being replaced
- `poc/sentinel/src/index.ts` -- remove queue/cron, add Temporal client
- `poc/sentinel/src/queue/worker.ts` -- replaced by Temporal
- `packages/scout-for-lol/packages/backend/src/league/cron.ts` -- remove 6 jobs
- `packages/better-skill-capped/fetcher/src/index.ts` -- logic moves to activities
- `packages/homelab/src/deps-email/src/main.ts` -- logic moves to activities

## Risks

1. **Bun incompatibility**: Worker must use Node.js. Activities calling Bun-specific APIs need adaptation.
2. **HA REST API typing**: Losing `@digital-alchemy/hass` type-safe entity IDs. Mitigate with Zod schemas.
3. **Long-running agent activities**: Sentinel's Claude SDK queries can run minutes. Must heartbeat.
4. **Single point of failure**: Temporal server down = all workflows stop. PostgreSQL-backed Temporal is reliable; accept this dependency.
5. **Migration rollback**: Each phase is independent. Run old and new in parallel during validation.

## Verification

After each phase:

1. Workflows visible in Temporal UI with correct schedules
2. Manual workflow execution produces expected results
3. Metrics flowing to Prometheus
4. No regressions in existing functionality
5. Removed CronJobs no longer appear in K8s
