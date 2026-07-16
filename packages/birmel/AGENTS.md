# AGENTS.md - Birmel

Discord bot using **VoltAgent** for AI agent orchestration. (Migrated from Mastra; some
file paths and on-disk SQLite filenames still carry the historical name —
notably `mastra-memory.db` is the real production memory store.)

## Architecture

- **Supervisor + sub-agent pattern.** The `birmel-router` Agent in
  `src/voltagent/agents/routing-agent.ts` decides which specialist handles
  each user message and delegates via VoltAgent's `delegate_task`. Sub-agents
  in `src/voltagent/agents/specialized/` own all Discord operations.
- **Persona is injected into every sub-agent**, not just the supervisor —
  `onHandoffComplete: bail()` returns the sub-agent's text directly to the
  user, so each sub-agent needs the persona to keep voice consistent.
- **Memory** uses VoltAgent's libSQL adapter (`src/voltagent/memory/`).
  `createMemory()` is a memoized singleton shared across all agents.
- **Discord tools** live under `src/agent-tools/tools/`. Channel handles
  go through `resolveSendableChannel` /`resolveTextBasedChannel` so threads,
  announcement channels, and DMs work.

## Responding: triggers + conversational follow-up

Whether the bot replies is decided in `shouldRespond`
(`src/discord/events/message-create.ts`). Direct triggers — an @mention or the
dynamic wake word — always reply and mark the channel "engaged"
(`src/discord/engagement-tracker.ts`, in-memory, `responder.engagementWindowMs`,
default 3 min). While a channel stays engaged, non-direct messages from
allowed users are passed to a cheap **persona-aware** classifier
(`src/voltagent/should-respond-classifier.ts`, `openai.classifierModel` via the
AI SDK's `generateObject`) that returns true/false — enabling natural follow-up
without re-pinging. The classifier **fails closed** (errors → no reply). A
successful reply re-marks the channel engaged so the window slides with the
conversation. Persona is fed into the classifier so the should-respond decision
itself reflects the active persona — persona is pervasive across every decision
point (routing, tools, sending, _and_ whether to respond), not just final text.

## Memory: three explicit scopes + transcript

`manage-memory` (`src/agent-tools/tools/memory/`) writes saved working memory at
three scopes: **server** (permanent, shared), **channel** (per-channel, shared —
targets the request's channel automatically), and **persona** (per persona;
legacy `owner` is an accepted alias). Server and channel memory are NOT
persona-keyed; only persona memory is. Channel saved-memory uses conversationId
`channel:<id>:memory`, kept deliberately distinct from VoltAgent's auto-history
id `channel:<id>` to avoid collision (`src/voltagent/memory/index.ts`).

The message handler (`src/voltagent/message-handler.ts`) injects all three
memory sections plus a `## Recent Channel Transcript` of recent raw messages —
`MAX(transcriptMinMessages, messages within transcriptWindowMs)` capped at
`transcriptMaxMessages` (`src/discord/utils/channel-history.ts`). The transcript
supplies messages the bot never answered; VoltAgent's `conversationId`
auto-history is still kept for the bot's own turn/tool continuity.

## OpenAI provider options

Every agent and the top-level `streamText` call receive shared Responses API
provider options from `getOpenAIResponsesProviderOptions()`
(`src/voltagent/openai-provider-options.ts`): `store: false`,
`include: ["reasoning.encrypted_content"]`, and the configured
`OPENAI_REASONING_EFFORT` / `OPENAI_TEXT_VERBOSITY`. Without the store/include
pair, GPT-5 reasoning replay fails with `AI_APICallError: required 'reasoning'
item` because the AI SDK references OpenAI-side stored items by id, and those
items expire. With them, reasoning content is round-tripped inline through
libSQL.

## Commands

```bash
bun run dev    # Development with watch
bun run start  # Production
```

## Testing

Requires Prisma setup before tests:

```bash
bunx --env-file=.env.test prisma generate
bun --env-file=.env.test test
```

Disconnect Prisma client in test teardown.

## Environment

Requires `.env` with Discord and AI API keys. Key variables:

- `MEMORY_DB_PATH` — libSQL URL for the agent memory store. Defaults to
  `file:/app/data/birmel-memory.db`. The legacy `MASTRA_MEMORY_DB_PATH` is
  also accepted as a fallback for in-flight rollouts.
- `OTLP_ENDPOINT` — OpenTelemetry trace endpoint
  (`http://tempo.tempo.svc.cluster.local:4318` in production).
- `EDITOR_ENABLED` / `EDITOR_GITHUB_*` — see `src/editor/`.
- `OPENAI_MODEL` defaults to `gpt-5.5`; classifier/style models stay on
  nano-class defaults unless explicitly configured.
- `BROWSER_PROVIDER` defaults to `pinchtab`; set `PINCHTAB_BASE_URL`,
  `PINCHTAB_TOKEN`, and `PINCHTAB_PROFILE` for real browser automation.
- `WEB_SEARCH_PROVIDER` defaults to `openai`; direct search/fetch fallbacks
  stay available through the `web-research` tool.

## Image build

Production image builds are manual (the Dagger `buildImageHelper` build was removed 2026-07
with the CI pipeline). The image must include `gh` and the
Anthropic Claude Code CLI so the `editor-agent` sub-agent's tools work at
runtime — verify both binaries are on `$PATH` before deploying.
