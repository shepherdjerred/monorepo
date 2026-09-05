# Monorepo Temporal constraints

This package owns central durable workflows, activities, workers, schedules,
and event ingress for the monorepo. `README.md` owns role/queue and operator
reference; the Temporal wiki explains workflow families and boundaries. Load
`temporal-development` for the working procedure.

## Runtime boundaries

- Workflow code is deterministic and credentialless. I/O, time, filesystem,
  subprocesses, network, and secrets belong in Activities.
- Production uses explicit role-separated workers. `all` is local development
  only and must never become a production fallback.
- Namespaces are explicit: local `dev`, Scout beta `beta`, and shared production
  `prod`. Do not export a production address globally.
- Central Workflow tasks use `monorepo-workflows`; domain Activity queues keep
  separate credentials, service accounts, concurrency, and health.
- Existing executions stay on their recorded task queue and Workflow history.
  Use compatible pollers, replay, and Worker Versioning for changes.

## Schedules and effects

- All recurring jobs are declared in `src/schedules/schedule-definitions.ts`.
  Preserve stable schedule and workflow IDs, overlap policy, catchup intent,
  and orphan detection.
- Activities declare semantic retry/timeout/heartbeat/cancellation behavior.
  External writes and delivery use idempotency or durable effect checkpoints.
- A quota-terminal or ambiguous external result is not a generic retry. Do not
  replay an occurrence when a prior executor may still settle it.
- Report delivery is exclusive and auditable. A generated report, durable send
  record, downstream receipt, and user-visible message are separate evidence.
- Generic agent tasks follow the shared typed schema, bounded tools, redacted
  environment, and OpenRouter/Codex SDK policy. Never pass inference credentials
  to tool subprocesses.
- PR-creating workflows use the bot-clone helper and repository PR contract;
  do not hand-roll installs or stack state in ephemeral clones.

## Verification and operations

```bash
TEMPORAL_NAMESPACE=dev TEMPORAL_WORKER_ROLE=all bun run start
bun run typecheck
bun run test
bun run lint
```

Workflow changes require bundle and retained-history replay appropriate to the
change. Rollouts use the package's Worker Deployment command and move through
stable, candidate canary, ramp, clean alert windows, and promotion. Inspect a
stale lease before removal.

For live work, identify namespace, workflow ID, run ID, task queue, worker
build, and schedule. A quiet durable timer is healthy; do not cancel it merely
for inactivity. Verify downstream effects separately from Workflow completion.
