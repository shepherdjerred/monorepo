# Messaging and Schedules

## Choose the message contract

| Type | Contract |
|---|---|
| Signal | Asynchronous, durable, no result. Service can accept it without a Worker response. |
| Query | Synchronous and read-only, not written to history. Requires a compatible Worker. |
| Update | Trackable mutation that can return a result. Requires a Worker through acceptance. |

TypeScript Query handlers cannot be async and must not mutate Workflow state.
Signal and Update handlers may be async, so each `await` is an interleaving
point. Protect invariants with Workflow-safe synchronization or enqueue commands
for the main Workflow loop.

Register handlers after required state initialization and before messages can
arrive. Signal-With-Start can deliver early. Before completion or
Continue-As-New, wait for `allHandlersFinished` unless abandoning unfinished
handlers is a deliberate protocol decision.

Update validators are synchronous and side-effect free. Rejection before
acceptance can avoid an accepted-Update history entry, but validation does not
replace authorization or handler state checks because state can change after
validation.

Update ID deduplication is scoped to a Workflow Run. Give Signals an application
idempotency key when duplicate business delivery matters. Carry cross-run
deduplication state through Continue-As-New.

## Start-with-message behavior

Signal-With-Start couples start and Signal delivery. Update-With-Start has a
weaker boundary: a new Workflow may start even if the Update is not delivered.
The Workflow's initialization must therefore be valid without the Update.

Treat Signal and Update calls as live mutations. Preserve a stable request ID,
handle terminal client-call failure, and reconcile delivery rather than assuming
SDK retries prove success.

## Child Workflows

Use a Child Workflow for a separate execution identity/lifecycle, service or
Task Queue ownership, independent retry/cancellation boundary, or history
partition. Use ordinary Workflow functions or Activities for code reuse.

- Await `startChild` until `ChildWorkflowExecutionStarted` is recorded before a
  parent can close. Use `executeChild` when the parent needs the result.
- Parent Close Policy defaults to terminate. Request-cancel cooperates; abandon
  transfers ownership and observability elsewhere.
- A child's Continue-As-New chain remains one child execution from the parent
  perspective. A parent's new Run does not automatically re-parent existing
  children.
- Child lifecycle Events still consume parent history. Bound fan-out and use a
  hierarchy or Continue-As-New for very large workloads.

## Continue-As-New

Continue-As-New keeps Workflow ID and starts a new Run with fresh Event History.
Pass current durable state as ordinary input. Prefer `continueAsNewSuggested`
over a fixed threshold and do not approach hard limits as a normal target.

Call Continue-As-New from the main Workflow after async handlers finish. Design
message draining and deduplication across the Run boundary. Do not use it as an
after-the-fact rescue for a knowingly unbounded coordinator.

## Schedule semantics

A Schedule is an independent named Service resource for recurring calendars,
intervals, pause/resume, backfill, overlap, and catchup. Use a Workflow start
delay for one future start.

Overlap policies express business concurrency:

- **Skip**: default; omit a new action while one is open.
- **BufferOne / BufferAll**: retain one or every missed action.
- **CancelOther**: request cancellation and wait for closure before starting.
- **TerminateOther**: terminate the open execution, then start.
- **AllowAll**: permit overlap.

Pausing affects future scheduled actions, not executions already started. A
paused Schedule may still be manually triggered. Deleting a Schedule does not
terminate its existing Workflows. List/count use Visibility and are eventually
consistent.

Catchup Window covers actions missed while the Temporal Service was down. It
does not discard work merely because Workers were unavailable: the Service may
have created the Workflow and queued its task. Expiring work needs a Workflow
staleness/deadline check. Backfill is a separate explicit mutation.

## Live Schedule boundary

Describe and list are read-only. Create, update, pause, unpause, trigger,
backfill, and delete are live mutations. Require the exact Namespace and
Schedule ID, describe current state first, obtain authorization for the precise
change, then verify the Schedule and any started Workflows.

In this repository, schedule definitions are declarative and reconciliation
preserves operator-owned live pause state. Follow package code and tests rather
than overwriting pause state from desired configuration.
