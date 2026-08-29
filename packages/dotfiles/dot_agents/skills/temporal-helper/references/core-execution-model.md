# Core execution model

## History and replay

Temporal persists orchestration facts as an append-only Event History. A
Workflow object's in-memory state and sticky cache are performance optimizations;
after restart, eviction, reassignment, or sticky fallback, the SDK reruns the
Workflow from its beginning and regenerates Commands.

Replay must produce a command sequence compatible with the recorded Events. It
does not restore a heap snapshot and it does not re-execute an Activity whose
completion is already recorded.

Distinguish these layers precisely:

- **Workflow function:** may execute many times during replay.
- **Workflow progress:** durable through recorded Events and Commands.
- **Activity function/effect:** can execute more than once before one completion
  is recorded.
- **Recorded Activity result:** supplied from history during replay.
- **External system:** owns its own state and idempotency guarantees.

Never summarize this as “Temporal runs everything exactly once.”

## Determinism

Determinism means that the same Event History leads to a compatible command
sequence. Internal computations can change when they do not alter future
Commands. Changes that can require compatibility handling include adding,
removing, reordering, or changing the conditions around:

- Activities and Local Activities;
- Timers and timeout-producing waits;
- Child Workflows and external Workflow handles;
- Signals, cancellation, completion, failure, and Continue-As-New;
- Search Attribute, Memo, and version/patch marker Commands.

TypeScript Workflows run in a separate bundled sandbox. The SDK supplies
replay-aware time, random, UUID, timer, and logging behavior. Node/DOM APIs and
external I/O do not belong there. `workflowInfo().unsafe.isReplaying` may gate
duplicate diagnostics; it must not change business decisions.

## Durable time and waiting

Temporal Timers are persisted and do not retain a process thread while waiting.
Worker or Service downtime may delay when work resumes, but the wait remains
part of durable execution. Use Workflow Timers/conditions, not host timers or an
Activity sleeping for the duration of a long business wait.

## Workflow Task failure versus Workflow failure

In TypeScript, an ordinary Workflow exception normally fails the Workflow Task.
The Service retries that Task so a corrected Worker can recover the same
execution. A deterministic bug can therefore loop on replay, consume capacity,
and leave the execution status `Running` while progress is stopped.

An explicit Temporal failure can close the Workflow Run. A configured Workflow
Retry Policy may then create another Run, but Workflows do not retry by default.
Do not confuse Workflow Task retry, Activity retry, and Workflow Execution retry.

## History growth

History size affects persistence, transfer, replay latency, and Worker memory.
Use `continueAsNewSuggested` before hard limits, carry only required state into
the next Run, and store large domain payloads externally. Hard event/size limits
are safety ceilings, not design targets; confirm current Namespace limits when a
number matters.

## Review questions

1. Which operations emit Commands or durable Events?
2. Which values come from history and which come from process/external state?
3. Can this branch produce a different command sequence for an old history?
4. Is a cached/sticky execution hiding a replay-only failure?
5. Does the validation replay representative open and closed histories with the
   actual production bundle, converters, and interceptors?
