# Testing, versioning, and deployment

## Layer tests by the contract they prove

1. **Pure tests:** deterministic helpers and context-free Activity logic.
2. **Activity context tests:** `MockActivityEnvironment` for Activity info,
   heartbeat content, and cancellation behavior. Mock heartbeats are not
   production-throttled.
3. **Workflow integration:** a real Worker with mocked Activities for sandbox,
   Commands, handlers, and Worker lifecycle. `Worker.runUntil()` should surface
   Worker and Workflow promise failures; always tear down the environment.
4. **Time-skipping:** timer-heavy paths, retry backoff, long sleeps, and
   intermediate state. One environment has one global clock; do not use it
   concurrently.
5. **Local/existing Service:** features and failure behavior requiring closer
   server fidelity. The time-skipping Java test server has incomplete parity.
6. **Bundle smoke:** build the exact production Workflow entry graph and catch
   prohibited/transitive Node imports.
7. **History replay:** representative retained histories for every changed
   Workflow Type and relevant Task Queue.
8. **Failure/deployment exercises:** Worker loss/restart, graceful shutdown,
   downstream outage, rate limit, duplicate effects, backlog growth/drain, and
   version rollout.

A direct Workflow function call does not test Temporal sandbox, Commands,
history, replay, or Worker lifecycle. A test starting only new histories cannot
prove backward compatibility.

## Replay acceptance

Use the same Workflow bundle, Payload/Failure Converters, codecs, interceptors,
and Workflow ID-dependent configuration as production. In TypeScript,
`Worker.runReplayHistory()` distinguishes a determinism violation from other
replay errors. Supply the real Workflow ID when logic depends on it because
history alone does not contain that value.

Sample recent open and closed executions for each changed type/queue. Generated
fixtures provide quick feedback; retained production histories provide realism.
Do not commit histories containing private or encrypted payloads without the
appropriate data/security approval and key-access design.

## Decide whether a change is compatible

Pure computation and refactoring are compatible only when they preserve future
Commands for every retained/open history. A command-producing change needs one
of:

- a TypeScript patch marker lifecycle;
- current Worker Deployment Versioning with an appropriate per-Workflow behavior;
- a new Workflow Type/identity boundary.

Patching lifecycle:

1. Introduce `patched(id)` with old and new branches.
2. After no execution needs the old branch, remove it but retain
   `deprecatePatch(id)`.
3. Remove the deprecated marker only after retained/replayed histories cannot
   require it.

Patch IDs and call ordering are part of compatibility.

## Current Worker Deployments

Use the current Worker Deployment model, not V1 compatibility sets or V2
assignment rules. Those legacy APIs are deprecated/sunset in Server 1.31 and
scheduled for removal in 1.32.

A Deployment Version combines deployment name and Build ID. Each execution of a
Pinned Workflow Type stays on the version where it started; new executions can
start on Current or Ramping. Auto-Upgrade can route to Current/Ramping but still
requires replay-safe code and patching when needed.

Confirm current Server/Cloud/SDK minimums and TypeScript options, including
`defaultVersioningBehavior` when Worker-wide versioning is enabled. Feature
stages and commands are drift-prone; use current docs and installed CLI help.

Rollouts must account for Current, Ramping, draining versions, closed-execution
Queries, sleeping/idle Workflows, Continue-As-New policy, and retained old
capacity. Moving/pinning/resetting executions is a live mutation requiring exact
targets and authorization.

## Repository acceptance matrix

| Layer | Runtime | Proves |
|---|---|---|
| Unit/Activity/Schedule/shared tests | Bun 1.4.0 | Repository logic and non-Worker Bun behavior. |
| Real Workflow/time-skipping tests | Authentic Node 24 | Supported native Worker, sandbox, commands, handlers. |
| Bundle smoke and retained-history replay | Authentic Node 24 | Entry graph and replay compatibility against the supported oracle. |
| Production Worker | Bun 1.4.0 | Repository-specific deployed exception only. |

On an SDK/Bun upgrade, keep exact package alignment and run all four layers.
Inspect Core, Webpack/bundler, converter, protobuf, test-server, and runtime
release notes. SDK 1.23.0 also includes a protobufjs v8 breaking surface, so it
is not a Bun-only version bump.

## Deployment proof

Distinguish:

- source/tests pass;
- the production bundle builds;
- representative histories replay;
- the intended version is polling the intended queue;
- backlog and failures remain healthy through rollout;
- live Workflows progress;
- downstream effects and user-visible outcomes are correct.

Do not report these as one undifferentiated “deployed successfully” claim.
