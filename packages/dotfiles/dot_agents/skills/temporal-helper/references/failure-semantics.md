# Failure semantics

## Retry and timeout model

Activities retry by default with exponential backoff; Workflows do not retry by
default. Prefer a Schedule-To-Close elapsed-time budget over a folklore attempt
count, then tune backoff and maximum interval to downstream behavior.

| Control | Meaning |
|---|---|
| Start-To-Close | Maximum duration of one Activity attempt; principal lost/hung attempt detector. |
| Schedule-To-Close | Total logical Activity duration across attempts and backoff. |
| Schedule-To-Start | Queue-wait diagnostic bound; non-retryable because returning to the same queue does not fix starvation. |
| Heartbeat Timeout | Maximum silence for a progressing long attempt; enables fast liveness detection and checkpoints. |

Set Start-To-Close or Schedule-To-Close as required by the SDK. Do not “fix” an
incident by increasing a timeout before identifying which scope is failing.

Keep library-internal retries narrow and intentional. They hide attempt/failure
visibility from Temporal and extend the required Start-To-Close budget. Use an
error-provided next retry delay only when the Activity has authoritative timing
such as a downstream `Retry-After`.

## Heartbeats

Heartbeat long work at meaningful progress points and set a Heartbeat Timeout.
Heartbeat details can seed the next attempt; parse them as untrusted persisted
data. In TypeScript, observe cancellation through Activity Context,
cancellation-aware sleep, or an `AbortSignal`.

The SDK may throttle heartbeat delivery. Cancellation is not instantaneous. A
detached auto-heartbeat can hide deadlocked work; if a background heartbeat is
unavoidable, own its lifecycle and surface failures instead of using an empty
catch.

## Failure types and wrapping

Workflow code awaiting an Activity receives `ActivityFailure`. Its `cause` can
be `ApplicationFailure`, `TimeoutFailure`, cancellation, or another Temporal
failure. Do not catch `ApplicationFailure` directly around the Activity call and
assume it is the outer error.

Ordinary Activity exceptions become retryable Application Failures. For a
permanent business failure, use a stable Application Failure type marked
non-retryable or listed in Retry Policy. Match stable types, not messages.
Classification is domain-specific: authentication, not-found, and validation
errors are not universally permanent when refresh or eventual consistency is
possible.

Retryability follows the outermost failure information. Wrapping a
non-retryable Temporal failure in a generic `Error` can make it retryable again.

## Cancellation

Cancellation is cooperative and structured. Workflow Cancellation Scopes form
a tree; cancelable Timers, Activities, children, and child scopes observe the
request according to their cancellation options.

- Timers/Triggers generally throw `CancelledFailure` directly.
- Activity and Child Workflow calls generally throw a wrapper whose cause is
  cancellation.
- Cleanup that must run after root cancellation belongs in a non-cancellable
  scope.
- Rethrow cancellation when the intended terminal state is canceled; swallowing
  it can record a misleading completion or failure.

Activity cancellation reaches a normal Activity through heartbeats. Local
Activity cancellation is in-process. Confirm the installed SDK's cancellation
type (`TRY_CANCEL`, wait requested/completed, abandon) before choosing behavior.

## Reset, termination, and failure privacy

Reset creates a new Run from a history point and discards later progress; it can
re-execute external effects. Fix the cause before reset. Termination closes
immediately and skips cooperative cleanup. Cancellation requests cooperative
handling. All three are live mutations requiring exact targets and authorization.

Failure messages and stacks are durable and may be visible in history, UI, and
CLI. Avoid secrets. A normal Payload Codec does not automatically protect common
failure fields; use a compatible Failure Converter plus codec when encryption
is required.

## Review questions

1. Is this a Workflow Task, Activity attempt, Activity Execution, or Workflow
   Execution failure?
2. Which timeout fired, and what does that scope actually diagnose?
3. Is the outer failure type preserving retryability and the real cause?
4. Can cancellation reach the work, and is cleanup non-cancellable where needed?
5. Do retry and timeout settings bound duplicate effects, cost, and elapsed time?
