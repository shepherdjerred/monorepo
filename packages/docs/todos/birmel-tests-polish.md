---
id: birmel-tests-polish
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/logs/2026-06-13_new-todos-batch.md
source_marker: false
---

# Birmel: more tests, more functionality, polish, confirm e2e

## What

Expand Birmel's test coverage and functionality, polish the bot, and confirm it
works end-to-end on a real server.

Current state (`packages/birmel`, VoltAgent + Claude AI):

- **~25 test files** — cover music tools, DB repositories, config schemas,
  scheduler, utils, engagement classifier, persona transform, observability.
- **Untested / sparse**: Discord message/command routing, tool-execution
  integration, agent delegation flow (routing-agent → 6 specialists in
  `src/voltagent/agents/specialized/`), memory persistence, persona injection
  across agents.
- **Functionality**: 66 tools in `src/agent-tools/tools/` (music, Discord,
  automation, DB, memory, sessions), 6 specialized agents, libSQL memory.
- **E2e**: 3 scripts in `packages/birmel/e2e/` (music-playback,
  youtube-stream-resource, openclaw-capabilities-docker) — **no full happy-path
  (message → routing → tool → response) and no Dagger e2e**.

## Remaining

- [ ] Integration tests cover agent delegation + tool execution and persona
      injection.
- [ ] An e2e test exercises the happy path: user message → routing-agent → specialist
      → tool → response.
- [ ] New functionality added per the roadmap, with the bot verified working on a
      real Discord server.

## References

- `packages/birmel/AGENTS.md` (architecture)
- Supervisor: `packages/birmel/src/voltagent/agents/routing-agent.ts`
