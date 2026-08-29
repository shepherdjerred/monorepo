# Workers and Task Queues

## Task Queue model

Task Queues are dynamic pull-based dispatch contracts. Workers register the
Workflow Types or Activities they can run and poll named queues. Workflow and
Activity Tasks are persisted when no compatible poller is available; Query and
some other task kinds require a live responder.

An execution's queue is recorded in history. Deploying Workers on a new queue
does not migrate existing executions. Keep old pollers until the old queue
drains, or use a deliberate supported migration/versioning mechanism.

Choose queue boundaries for service ownership, incompatible dependencies,
resource isolation, routing, or rate limits. Uncontrolled queue proliferation
fragments capacity and operations. A shared string name does not make every
internal task kind interchangeable.

## Ordering, priority, and fairness

Temporal does not guarantee global FIFO across queue partitions. Current
Priority and Fairness behavior is partition-scoped; Fairness is dispatch
fairness, not a cost or in-flight resource guarantee. Cloud enablement and
entitlement can differ from self-hosted feature availability.

Treat priority and fairness as overload policy. Preserve capacity for critical
work, but do not use priority as a correctness dependency or assume higher
priority can preempt already running Activities.

## Sticky execution and cache

Sticky execution routes follow-up Workflow Tasks toward a Worker with cached
state to avoid full replay. It applies to Workflow Tasks only and is an
optimization:

- cache eviction or Worker loss must remain correct;
- sticky fallback can force cold replay;
- high replay cost can cause Workflow Task timeouts and a feedback loop;
- process-local state and host affinity must never be correctness requirements.

Replay-only bugs may stay hidden while a Workflow remains cached. Include replay
tests and monitor Workflow Task failures, not only execution status.

## Capacity diagnosis

Correlate signals before tuning:

| Signal | Likely layer to investigate |
|---|---|
| Rising Schedule-To-Start/backlog | Poller/slot capacity, crashes, resource limits, queue routing. |
| High task execution latency | Workflow/Activity code, replay, CPU/memory, downstream dependency. |
| Low poll success with low latency and idle hosts | Over-polling, not necessarily insufficient Workers. |
| Frequent sticky misses/cold replay | Cache sizing, churn, histories, deployment behavior. |
| OOM/restarts | Cache/slot concurrency, payload/history size, process topology. |

Slots, pollers, cache, CPU, memory, and downstream concurrency interact. Tune
from metrics and bounded load tests. Defaults and example percentages are
starting points, not universal recommendations. Do not combine resource tuners
with mutually exclusive legacy max-concurrency options.

Rate limits can exist per Worker, Task Queue, Namespace, account, or downstream
dependency. Confirm the scope before changing a number.

## Worker topology

Separate Worker deployments/queues when workloads need different runtime
dependencies, resources, ownership, availability, or rate limits. Multiple
processes/replicas provide resilience. One process running many independent
resource tuners can create contention; confirm pinned SDK behavior rather than
generalizing a historical issue.

Prebuild the Workflow bundle for predictable production startup when practical.
Worker creation by `workflowsPath` is supported; ahead-of-time bundling is a
startup/deployment practice, not a claim that `workflowsPath` is incorrect.

## Graceful shutdown

On shutdown, stop polling new work and give in-flight tasks the configured grace
period. Activities should cooperate with cancellation and heartbeat so the
Service can detect/retry lost attempts. Do not add arbitrary sleeps copied from
historical SDK issues.

Verify:

1. pollers for the intended version and queue are present;
2. backlog and Schedule-To-Start drain after rollout;
3. Workflow Task failures and replay latency remain healthy;
4. Activities finish, checkpoint, cancel, or retry as intended;
5. old versions/queues are retained until no execution needs them.
