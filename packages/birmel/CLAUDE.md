# CLAUDE.md - Birmel

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

## OpenAI provider options

Every agent and the top-level `streamText` call receive the shared
`OPENAI_RESPONSES_PROVIDER_OPTIONS` (`src/voltagent/openai-provider-options.ts`):
`store: false` plus `include: ["reasoning.encrypted_content"]`. Without these,
GPT-5 reasoning replay fails with `AI_APICallError: required 'reasoning' item`
because the AI SDK references OpenAI-side stored items by id, and those items
expire. With them, reasoning content is round-tripped inline through libSQL.

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

## Image build

The production image is built by `buildImageHelper` in `.dagger/src/image.ts`
with `installEditorClis: true`. That installs `gh` and the Anthropic Claude
Code CLI into the image so the `editor-agent` sub-agent's tools work at
runtime. The smoke test asserts both binaries are on `$PATH`.
