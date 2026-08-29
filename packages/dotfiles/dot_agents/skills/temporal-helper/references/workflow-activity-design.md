# Workflow and Activity design

## Choose the boundary

Workflows own durable decisions, state derived from recorded values, Timers,
message coordination, and recovery policy. Activities own network, database,
filesystem, subprocess, secret, LLM, and other nondeterministic side effects.

In TypeScript, a Workflow imports Activity types and calls `proxyActivities`;
the Worker registers implementations. Never import an Activity implementation
into the Workflow bundle or call it as an ordinary function.

Keep deterministic business logic in the Workflow when it benefits durable
state and replay. “Workflow code only orchestrates” does not require every pure
calculation to become an Activity.

## Idempotency and ambiguous completion

An Activity is retriable by default. If its external effect succeeds and the
Worker dies before Temporal records completion, another attempt may run.
Temporal cannot prove whether the external side committed.

Make idempotency atomic at the effect boundary:

- pass a stable business operation/request ID to a downstream idempotency API;
- use an atomic unique constraint or conditional write;
- keep a durable operation ledger with a stable result;
- when appropriate, use Workflow Run ID plus Activity ID, which stays stable
  across attempts and is unique to that Activity Execution.

Do not use attempt number in an idempotency key. A check-then-create sequence
without a lock/constraint is racy. A maximum of one attempt reduces duplicate
execution but permits zero recorded completion after an ambiguous success.

## Granularity

Choose one cohesive idempotent recovery boundary per Activity. Split work when
an earlier successful/expensive effect should not repeat with a later failure,
or when effects need different timeouts, retry classifications, queues, or
ownership. Keep small cohesive operations together when splitting would only
inflate history.

Avoid one Activity that fetches, transforms, writes, charges, and notifies under
one generic retry policy. Avoid the opposite extreme of an Activity for trivial
pure computation.

## Regular and Local Activities

Use regular Activities by default. They provide durable scheduling, Task Queue
routing, rate limits, heartbeats, and independent retry visibility.

Use a Local Activity only for short, in-process, idempotent work when avoiding a
Service round trip is worth the tradeoff. Its completion becomes durable when
the enclosing Workflow Task records the marker; Worker failure before then can
run it again. Local Activities do not provide normal Activity heartbeats,
routing, or global rate limiting.

## Long external jobs and callbacks

Prefer a short request Activity followed by a durable Workflow wait for a
Signal/Update when an external system completes asynchronously. This avoids
holding an Activity open for hours and makes correlation, timeout, cancellation,
and human intervention explicit. Register handlers before the callback can
arrive and deduplicate the message at the business layer.

For genuinely long Worker-owned computation, use a normal Activity with a
Start-To-Close budget, Heartbeat Timeout, meaningful checkpoint details, and
cancellation-aware APIs.

## Payloads and dependencies

Activity arguments and results enter history. Pass small serializable values
and stable references/checksums; keep large objects in durable external storage.
Inject reusable clients/connections into Activity implementations, but do not
rely on process memory as durable business state.

Validate external input, heartbeat details, and deserialized data at runtime.
Type annotations and type assertions do not validate persisted or remote values.

## Review questions

1. What is the external side effect and can ambiguous completion repeat it?
2. Where is idempotency enforced atomically?
3. Does each Activity have one coherent retry/recovery boundary?
4. Are payload size and sensitive-data exposure acceptable in history?
5. Would a durable callback message be safer than a long-held Activity?
