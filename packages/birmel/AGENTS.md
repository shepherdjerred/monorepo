# AGENTS.md - Birmel

Birmel is a Discord bot with one explicit AI SDK 7 runtime. Do not introduce
framework-owned conversation memory, nested supervisor handoffs, or a second
implementation of context, memory, sessions, jobs, or orchestration.

## Turn lifecycle

Every turn follows one pipeline:

`Discord event -> admission/AgentRun dedup -> ContextBundle -> capability-grounded route -> direct or one specialist -> one edited Discord reply -> human claims plus curated self-memory`

- Admission lives in `src/discord/events/message-create.ts`. Only configured
  trusted users may trigger the bot or invoke any capability. Active session
  threads, replies to Birmel, and active persona aliases bypass classifier
  gating for those users only. Learned aliases are guild-scoped wake names.
  Admission is serialized per channel so an alias trigger is visible to its
  immediate follow-up; only the bounded admission phase is queued, never the
  agent turn, and bot/untrusted messages are rejected before enqueueing. Wake
  boundaries are Unicode-aware.
- `src/context/turn-context.ts` creates the only `ContextBundle`. Its budgets
  are defined in `src/agent-runtime/contracts.ts`; do not persist assembled
  context or model reasoning.
- `src/agent-runtime/router.ts` returns exactly one route and one disposition:
  `conversation`, `supported`, or `unsupported`. A supported route must name a
  registered primary tool owned by the selected specialist, and that tool must
  succeed before the runtime accepts the result. Direct conversation and
  unsupported work are tool-free. A supported tool route runs exactly one AI
  SDK `ToolLoopAgent` specialist for at most eight steps.
- `src/agent-runtime/message-handler.ts` owns Discord delivery. A source turn
  gets one placeholder reply and one final edit. Source-channel messaging tools
  must not send an additional final response.
- Per-channel/session queues preserve turn ordering without sharing model
  state. `AgentRun.discordMessageId` is the restart-safe deduplication key.

## Tools and authority

Tools live under `src/agent-tools/tools/` and are adapted by
`src/agent-runtime/tools/create-tool.ts`.

- Keep stable tool IDs and Zod input schemas.
- Add every tool to exactly one specialist set and to the metadata registry.
- Validate tool outputs before returning them to a model.
- Accept unknown boundary data and parse it; do not use type assertions or
  loose `any`.
- Guild and actor identity come from `RequestContext`, never model input.
- The validated `TRUSTED_USER_IDS` allowlist governs all tools, editor/shell
  access, jobs, and stored-job execution.
- The router capability catalog is generated from the executable specialist
  sets. There is no generic SQL or database-inspection tool. Use the scoped
  activity tool for activity questions.
- Missing capability is an honest product limitation, not a safety refusal.
  Trusted users may perform ordinary supported writes. Only bulk destructive
  and bulk-creation effects are prohibited by the core policy.

## Context, persona, and memory

The elected persona is compacted and influences admission, routing, direct
conversation, specialists, and memory extraction. Typed contracts, safety,
authority, and tool limits outrank persona style.

Recent Discord context is at most 50 messages from the preceding hour. Glitter
friend context is resolved just in time from mentioned names/aliases and
relevant lore; never inject the complete lore/style corpus.

Durable memory consists only of `MemoryClaim` plus append-only
`MemoryRevision` provenance. Human-claim extraction reads raw Discord messages,
not retrieved memories or assembled prompts, and rejects bot-authored evidence.
Curated self-memory may retain only an accepted alias, a durable commitment, or
an experience backed by an exact successful tool invocation and its bounded,
redacted result summary from the current turn. It is
grounded in the current user message plus the delivered Birmel reply; prior bot
messages are never self-memory evidence. Accepted aliases use the canonical
`identity.alias` predicate at persona scope and become wake names throughout
that guild; the human-claim path must reject that predicate. Alias persistence
requires a bounded wake-name shape plus explicit
affirmative proposal and acceptance language; negations and rejection wording
must fail closed. An invalid self-memory candidate is observed
and rejected without discarding valid claims. Commitments copy explicit
commitment language from the delivered reply, use canonical claim fields, and
use a grounded topic as their stable family identity so unrelated promises can
coexist. Non-alias memory may never use the reserved alias predicate, and alias
whitespace is canonicalized before persistence. Commitments may target only a
grounded user. Explicit statements outrank inferred claims; unresolved
contradictions remain uncertain. `forget` tombstones a claim, while privacy
erase physically deletes the claim and its revisions. The historical
`/app/data/mastra-memory.db` is a forensic PVC artifact and must never be opened
by runtime code.

## Sessions and jobs

- One active `AgentSession` binds to each Discord thread. Store only user,
  assistant, and summarized tool events with monotonic sequence numbers and
  Discord provenance—never reasoning.
- Users steer a session by writing in its thread. Archive, cancel, and resume
  must affect admission.
- `manage-job` is the only jobs surface. Jobs support message, deterministic
  tool, and isolated-agent payloads; preserve the original request context,
  re-check the actor allowlist at execution, claim atomically, recover after
  restart, and drain on shutdown. External writes and Discord deliveries need
  a durable effect checkpoint. An ambiguous effect stays paused until
  `resolve-effect` records that it was applied. An ambiguous occurrence is
  never replayed in place because the prior executor may still settle.

## Persistence, startup, and health

`scripts/start.ts` fingerprints an existing unmigrated production SQLite
database, resolves the verified baseline when appropriate, runs
`prisma migrate deploy`, then starts the bot. Never restore startup `db push`.

- `/live` indicates process health.
- `/ready` requires applied migrations, Prisma connectivity, Discord
  readiness, and scheduler startup.
- Configuration is strict: malformed numbers, JSON, IDs, enums, URLs, or
  timeouts fail startup. Missing values may use schema-documented defaults.

## Commands

Run from `packages/birmel`:

```bash
bun run build
bun run typecheck
bun run test
bun run lint
bun run docker:build
bun run smoke
```

The package test command builds Glitter context, generates Prisma, applies
versioned migrations to its test database, and runs with zero skipped tests.
Disconnect Prisma clients in test teardown. Use fake Discord/model/PinchTab
boundaries in the normal suite; live production acceptance is a separate
operator step.

The image must include `gh`, Claude Code, Node, Python, yt-dlp, and ffmpeg for
the editor and music specialists. Production deploys only through the existing
Buildkite image and ArgoCD GitOps flow.
