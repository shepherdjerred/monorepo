---
id: birmel-3-single-explicit-agent-runtime
type: plan
status: in-progress
board: true
verification: operator
disposition: blocked
---

# Birmel 3.0: Single Explicit Agent Runtime

## Objective

Replace VoltAgent with AI SDK 6 while preserving Birmel's tool domains,
elected persona, conversational triggers, and trusted-user authority model. The
runtime has one visible lifecycle:

`Discord event -> admission and deduplication -> context assembly -> typed routing -> one specialist or direct agent -> one reply -> typed memory extraction`

Each concern has one implementation: context assembly, durable memory,
thread-bound sessions, scheduled jobs, and agent orchestration.

## Runtime design

- Route each admitted turn to exactly one of `direct`, `messaging`, `server`,
  `moderation`, `music`, `automation`, or `editor` using validated structured
  output.
- Use one AI SDK `ToolLoopAgent` specialist for a routed tool turn, capped at
  eight model/tool steps and the existing response timeout. Ordinary
  conversation uses a tool-free direct agent.
- Give the selected agent a bounded task packet containing only the current
  request, Discord identifiers, relevant context, and compact elected persona.
  Do not pass manager history, an assembled manager prompt, or another agent's
  tool trace.
- Adapt the existing stable tools to AI SDK while retaining tool IDs and Zod
  inputs. Validate tool outputs and attach specialist ownership, risk,
  timeout, and required-context metadata. Guild and actor IDs come from trusted
  runtime context, never model arguments.
- Centralize and validate the trusted-user allowlist. Re-check the originating
  actor when stored jobs execute.
- Keep one explicit channel or session queue for ordered concurrent Discord
  turns without sharing model state.
- Persist an `AgentRun` keyed uniquely by Discord message ID for restart-safe
  deduplication, route and status tracking, response-message linkage, and
  failure correlation. Never persist assembled prompts.
- Produce exactly one Discord response per turn. User-facing failures contain
  only a short incident ID; raw exceptions stay in structured logs and Sentry.
- Remove VoltAgent, libSQL runtime memory, replay sanitization, hidden memory
  tools, framework conversation IDs, and the empty-stream retry agent.

## Context, persona, and lore

Build one immutable `ContextBundle` from explicit source records:

| Source                        |           Maximum |
| ----------------------------- | ----------------: |
| Core instructions             | 12,000 characters |
| Compact elected persona       |  8,000 characters |
| Retrieved lore and memory     |  8,000 characters |
| Recent raw Discord transcript | 20,000 characters |
| Total assembled context       | 48,000 characters |

Transcript retrieval examines at most 50 messages in the existing one-hour
window. The current message and system policy are mandatory. Trimming removes
oldest transcript messages first and then lowest-ranked lore or memory. Every
Discord message ID may occur at most once.

The compact elected persona affects admission, routing, direct conversation,
specialists, and memory extraction. Typed contracts, safety policy, authority,
and tool limits remain higher priority.

Add just-in-time friend context to the shared Glitter context package. Resolve
aliases and mentioned people deterministically, include matching relationships
and only relevant lore sections, and stop injecting the full lore and style
corpora into every call.

## Durable memory

Replace working-memory Markdown and `AgentMemory` with:

- `MemoryClaim`: scope, subject, predicate, current value, confidence,
  salience, explicit or inferred origin, temporal validity, status, and
  embedding.
- `MemoryRevision`: append-only create, confirm, supersede, forget, and
  correction events with source Discord message IDs, author/channel
  provenance, and extractor model.

A deterministic identity key prevents duplicate active claims. Claims may be
guild-, channel-, persona-, user-, or relationship-scoped. Broad social graph
extraction may infer facts and relationships, but inferred claims retain
confidence and provenance.

After a successful response, typed extraction runs over raw recent Discord
messages only. Validated candidates apply transactionally: duplicates confirm,
new contradictions supersede while preserving revisions, explicit statements
outrank inferred claims, and unresolved conflicts remain visible as uncertain.

Retrieval always includes applicable active rules and explicit preferences,
then ranks facts and relationships by scope, lexical match, semantic
similarity, confidence, salience, and recency. It returns at most twelve claims
inside the shared context budget.

Retain explicit remember, inspect, correction, history, forget, and privacy
erase operations. Forget tombstones normal claims; privacy erase physically
removes claims, revisions, and embeddings. The runtime must never open
`mastra-memory.db`; that PVC file remains an untouched forensic archive and
`MEMORY_DB_PATH` leaves runtime configuration.

## Sessions and jobs

- One active `AgentSession` may bind to each Discord thread. Allowed users in
  an active session thread bypass mention and classifier gating.
- Store append-only user, assistant, and summarized tool events with Discord
  provenance and monotonic sequence numbers. Never store reasoning.
- Resume from a versioned summary plus recent events under the same context
  budget. Archive, cancel, and resume affect actual routing.
- Remove inert follow-up, steer, and spawn behavior. Users steer by writing in
  the thread; background execution uses jobs.
- Consolidate timers and `AgentJob` behind `manage-job`, supporting message,
  deterministic tool, and isolated agent payloads. Agent payloads may target
  an active session and deliver into its thread.
- Persist and validate the original actor request context, prevent overlapping
  scheduler ticks, claim jobs atomically, recover retries after restart, and
  wait for active jobs during graceful shutdown.
- Migrate legacy `ScheduledTask` rows before removing its model and tool
  surface.

## Configuration, migration, and deployment

- Parse configuration strictly. Documented defaults are allowed only for
  missing values; malformed numbers, JSON, Discord IDs, model settings, or
  timeouts fail startup.
- Replace startup `prisma db push` with migrations. Squash the historical
  migrations into a full baseline, fingerprint an existing database without
  `_prisma_migrations` before resolving that baseline, and deploy the additive
  runtime/memory/session migration with `prisma migrate deploy`.
- Preserve all product data and jobs. Archive unexpected legacy memory or
  session rows rather than importing them. Recheck production counts
  immediately before deployment.
- Expose liveness and readiness for process health, completed migrations,
  Prisma connectivity, Discord readiness, and scheduler startup.
- Deploy through the existing image and GitOps flow after local and CI
  verification. Create a fresh PVC snapshot first. Rollback restores the prior
  pinned image and environment while retaining the old memory database.

## Verification contract

Add Zod-backed `TurnInput`, `ContextSource`, `ContextBundle`, `RouteDecision`,
`SpecialistId`, `BirmelToolMetadata`, `MemoryCandidate`, and `MemoryClaim`
types. Model and tool boundaries accept `unknown` and parse it. Do not add type
assertions or loose `any` values.

Automated coverage must include:

- Context ordering, budgets, duplicate prevention, scope isolation, transcript
  failures, and proof assembled prompts never reach SQLite.
- Direct routing and all six specialists, exactly one route, persona
  projection, timeouts, malformed model output, and tool output validation.
- Deterministic fake Discord event through one edited response, with each
  boundary failure represented.
- Memory extraction, confirmation, supersession, temporal conflict,
  relationships, lexical and semantic retrieval, correction, forget, privacy
  erase, provenance, and extractor failure.
- Session creation, thread admission, ordered append, summary, resume/archive,
  concurrency, and job delivery.
- Job actor propagation, atomic claims, retries, timeout, restart recovery,
  recurrence, isolated agent payloads, and non-overlapping ticks.
- Fresh and production-shaped migration fixtures.
- Every registered tool and specialist assignment.
- Fake PinchTab HTTP coverage replacing all five skipped browser tests.

Add content-free spans and structured logs for admission, context construction,
routing, specialist execution, tools, memory, sessions, jobs, and Discord
delivery. Attributes may include route, trigger, persona, source sizes,
selected-memory count, model usage, duration, finish reason, and error class,
but never message or memory contents.

## Delivered

- Mirrored the approved contracts in code and added the baseline and additive
  schema migrations.
- Replaced VoltAgent orchestration, memory, and tool adaptation with the
  explicit AI SDK runtime.
- Implemented bounded context, compact persona, and just-in-time Glitter friend
  context.
- Implemented claim memory, real thread sessions, and consolidated jobs.
- Added strict configuration, health endpoints, shutdown behavior, and
  deployment changes.
- Added deterministic, migration, browser, contract, and failure-path coverage
  with zero skipped tests.
- Updated package guidance, environment examples, the active testing TODO, and
  the human Birmel architecture page.

## Remaining

- [ ] Pass focused Birmel build, typecheck, test, lint, Docker smoke, staged
      hooks, and Buildkite's exhaustive gate.
- [ ] Recheck production row counts, snapshot the PVC, deploy, and run the live
      reversible acceptance scenarios.

## Production acceptance

Immediately after the direct deployment, verify mention/chat, engaged
follow-up, one read tool, one verified write, a memory
create/query/correct/forget cycle, a two-turn thread session, a one-shot job,
and browser/editor health. Confirm one response per input, clean pod logs, new
traces, no writes to `mastra-memory.db`, and no context growth across repeated
turns.

Archive this plan and the Birmel testing TODO only after production acceptance
succeeds.

## Comment Log

- 2026-08-08: Approved implementation plan mirrored before code changes. The
  production database facts from 2026-08-07 remain deployment preconditions,
  not assumptions to skip revalidation.
- 2026-08-08: The focused Turbo graph passed all seven Birmel tasks with 252
  tests, zero failures, and zero skips. The rebuilt runtime image also passed
  the in-container startup and dependency smoke test.
- 2026-08-08: Review remediation added legacy reminder compatibility, removed
  the final legacy scheduling tool surface, made tool timeouts cooperative at
  Discord, shell, browser, and file-write boundaries, and fenced timed-out jobs.
  The exact CI test command now passes 260 tests with zero failures or skips.
- 2026-08-08: The final audit closed job-limit bypasses in edit and run-now,
  retained timed-out jobs inside the scheduler concurrency and shutdown fence,
  and made Playwright cancellation cooperative. The exact CI suite now passes
  265 tests with zero failures or skips; the six-task build, typecheck, and lint
  graph also passes.
- 2026-08-08: Current-head review added deterministic migration of removed
  scheduling-wrapper tool IDs and cancellation finalization for actively claimed
  jobs. The exact CI suite now passes 267 tests with zero failures or skips; the
  six-task build, typecheck, and lint graph remains green.
