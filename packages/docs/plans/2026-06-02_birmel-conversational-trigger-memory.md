# Birmel: conversational triggering, persona-scoped memory, transcript context

## Status

Complete

## Context

Birmel only responded to a direct @mention or wake word, making natural
back-and-forth impossible. Its memory had server + per-persona ("owner") scopes
but no per-channel saved memory, and it never injected raw channel transcript,
so it had no context for messages it didn't itself answer. This change adds:

1. **Conversational triggering** — after the bot is engaged in a channel
   (@mention/wake word, within 3 min), a cheap GPT-nano classifier decides
   whether to respond to subsequent non-mention messages.
2. **Three explicit memory scopes** — `server` and `channel` (shared) and
   `persona` (per persona), plus recent channel transcript in context.
3. **Pervasive persona** — persona influences every decision point including the
   new should-respond classifier.

### User-confirmed decisions

- Persona pervasive via system-prompt injection (already true for agents) **and**
  fed into the should-respond classifier. No separate output-rewrite pass.
- `server`/`channel` memory shared (not persona-keyed); only `persona` is keyed.
- Transcript = `MAX(25 messages, messages in last hour)`, capped at 100.

## Implementation

### Feature 1 — conversational trigger

- `src/discord/engagement-tracker.ts` — in-memory per-channel last-engagement
  map (`markEngaged` / `isRecentlyEngaged`, lazy-evicting).
- `src/voltagent/should-respond-classifier.ts` — `classifyShouldRespond` using
  the AI SDK `generateObject` + `openai.classifierModel`, persona-aware,
  fail-closed, traced via `withSpan`.
- `src/discord/events/message-create.ts` — `shouldRespond` marks engagement on
  direct triggers; while engaged, runs the classifier on non-direct messages.
- `src/voltagent/message-handler.ts` — re-marks engagement after a successful
  reply so the window slides with the conversation.
- Config: `ResponderConfigSchema` in `src/config/schema.ts` + loader in
  `src/config/index.ts` (`RESPONDER_*` env vars).

### Feature 2 — three memory scopes

- `src/voltagent/memory/index.ts` — renamed owner→persona (functions +
  `PERSONA_MEMORY_TEMPLATE`, keeping the legacy `:owner:` conversationId and
  deprecated aliases); added channel saved-memory
  (`getChannelMemoryConversationId` = `channel:<id>:memory`, **distinct** from
  the auto-history `channel:<id>`), `get/updateChannelWorkingMemory`,
  `CHANNEL_MEMORY_TEMPLATE`.
- `src/agent-tools/tools/memory/memory-actions.ts` — rewritten around a
  `resolveScopeTarget` helper for `server | channel | persona`.
- `src/agent-tools/tools/memory/index.ts` — scope enum gains `channel`/`persona`
  (legacy `owner` aliased); channel scope reads channelId from request context.

### Feature 3 — transcript

- `src/discord/utils/channel-history.ts` — `getConversationTranscript`
  (`MAX(min, window)` capped) + `formatTranscript`.
- `src/voltagent/message-handler.ts` — injects `## Server/Channel/Persona Memory`
  and `## Recent Channel Transcript` sections.

### Feature 4 — pervasive persona

- Persona fed into `classifyShouldRespond`; agents already inject persona via
  `system-prompt.ts`. Documented in `packages/birmel/AGENTS.md`.

## Verification

- `bun run typecheck` — clean (0 errors in birmel src).
- New unit tests pass: engagement-tracker, channel-history transcript sizing,
  should-respond classifier (mocked `ai`), memory conversationId invariants.
- Manual E2E (see below) not yet run by maintainer.

## Session Log — 2026-06-02

### Done

- Implemented all three features + tests across the files listed above.
- `packages/birmel/AGENTS.md`, `.env.example` updated.
- `bun run typecheck` clean; new tests green (16 pass).

### Remaining

- Maintainer manual E2E in a live guild: engage bot, confirm nano follow-up
  fires + decisions, confirm transcript + three memory sections in context,
  exercise `manage-memory scope:"channel"`.
- Run full `bun test` + `bunx eslint .` in CI (Buildkite).

### Caveats

- Worktree needed manual `bun install --ignore-scripts` in `packages/birmel`,
  `eslint-config`, and `llm-observability` (root `bun run scripts/setup.ts`
  failed on a Windows `prepare` hook: `git rev-parse ... > /dev/null` parsed
  under a non-bash shell).
- Channel saved-memory id (`channel:<id>:memory`) must stay distinct from the
  auto-history id (`channel:<id>`) — covered by `memory-ids.test.ts`.
- Classifier adds a per-message nano call while a channel is engaged (allowed
  users only) — small latency/cost; disable via `RESPONDER_ENABLED=false`.
