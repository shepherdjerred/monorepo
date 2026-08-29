# Troubleshooting

## Start with the layer that stopped progressing

1. Identify Namespace, Workflow ID, Run ID, Workflow Type, Task Queue, Worker
   Deployment Version, and relevant Activity ID/attempt.
2. Read describe/history and Worker logs without mutating state or printing
   sensitive payloads.
3. Classify the failure: client request, Workflow Task/replay, Activity attempt,
   queue capacity, Worker lifecycle, Service/persistence, Visibility, or
   downstream effect.
4. Reproduce with the smallest independent oracle: bundle, replay, real Worker,
   local Service, or downstream idempotency check.
5. Fix the cause before considering cancel, reset, terminate, version move, or
   Schedule changes.

## Nondeterminism or repeated Workflow Task failure

Symptoms include `Running` executions without progress, repeated Workflow Task
failures, cache-eviction-only incidents, or “no command scheduled” mismatches.

- Replay the exact history against the exact production bundle and converters.
- Compare command-producing code paths and patch/version markers.
- Check Query handlers for state mutation and code for unrecorded external/time
  values.
- Restore replay-compatible code or route through current Worker Versioning.
- Do not automatically restart/reset every affected Workflow. Reset can replay
  side effects and requires exact targeting after the code is fixed.

Sticky cache can mask a replay-only bug for hours. Treat replay tests and
Workflow Task failure metrics as independent evidence.

## Activity retry storm or duplicate effect

- Inspect the outer `ActivityFailure` and its cause; verify the failure type did
  not lose non-retryable classification through wrapping.
- Check Start-To-Close, Schedule-To-Close, backoff, maximum attempts, and any
  hidden library retry loop.
- Verify downstream idempotency with the stable operation key and durable result.
- Check whether success was ambiguous before the Worker failed.
- Heartbeat/checkpoint long work and parse details safely.

Do not mark a transient dependency error permanent merely to stop the storm.
Bound elapsed time/cost and fix classification or the dependency.

## Cancellation appears stuck

Normal Activity cancellation is delivered through heartbeats. Check that the
Activity heartbeats or waits on cancellation-aware APIs and that the Worker is
still connected. Heartbeat throttling means delivery is not instantaneous.

Confirm the configured Activity cancellation type and wrapper/cause. Verify
cleanup runs in a non-cancellable scope and cancellation is rethrown. Do not
replace cooperative cancellation with termination without explaining the lost
cleanup and obtaining authorization.

## Worker backlog or latency

High Schedule-To-Start/backlog points toward poller/slot/routing/crash capacity.
High execution latency points toward code, replay, resource, or dependency cost.
Low poll success with low latency and idle resources can mean over-polling.

Correlate slots, pollers, cache, CPU, memory, OOM/restarts, task completion,
sticky misses, and downstream limits. Scale or tune the measured bottleneck; do
not raise every concurrency setting.

Existing executions do not follow a renamed/new Task Queue. If new Workers look
healthy while old executions stall, verify old queue pollers before changing
history or terminating runs.

## Schedule surprise

- Pause/delete does not stop Workflows already started.
- A paused Schedule may still be manually triggered.
- Catchup covers Service downtime, not Worker unavailability.
- Overlap is evaluated against open executions; choose the business policy.
- List/count are eventually consistent; describe the exact Schedule.

Trigger, backfill, pause/unpause, update, and delete are live mutations. Require
the exact Namespace/Schedule ID and authorization.

## Bundle/runtime failure

For Workflow bundle errors, trace transitive imports of Node built-ins, Activity
implementations, Client/Worker packages, and runtime-only libraries. Do not use
`ignoreModules` until runtime unreachability is proved.

For Bun-only Worker failures, remember the repository is on SDK 1.22.0 and Bun
1.4.0, before upstream's experimental 1.23 fixes. Reproduce Bun startup,
registration, Workflow execution, shutdown, and bundle behavior, then run the
authentic-Node Worker/replay oracle. Do not describe a Bun workaround as general
Temporal support.

## Operational anti-patterns

- “Temporal guarantees exactly-once Activities.”
- Idempotency keys containing attempt number.
- External I/O or mutable Query handlers in Workflow code.
- A background heartbeat whose failure is swallowed.
- One timeout or retry policy for every error/domain.
- Using history as bulk object storage or the application database.
- Treating `Running` as proof of progress.
- Teaching legacy Build-ID assignment rules as current Worker Versioning.
- Assuming a new Task Queue migrates existing executions.
- Increasing capacity from one metric without identifying the queueing stage.
- Using reset/terminate/Schedule mutations as action-ready diagnostics.
- Logging or exporting payloads, failure stacks, or credentials during triage.
