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

- [ ] Add deterministic integration coverage for routing-agent delegation,
      specialist persona injection, and tool execution with model and Discord
      boundaries faked explicitly.
- [ ] Add a repeatable happy-path harness for user message → routing agent →
      specialist → tool → response, including failure assertions at each handoff.
- [ ] Run the package test suite and exercise the same happy path through the
      deployed bot on the agent-accessible Discord test server; record the
      command/message and observed response here.

## References

- `packages/birmel/AGENTS.md` (architecture)
- Supervisor: `packages/birmel/src/voltagent/agents/routing-agent.ts`

## Comment Log

### 2026-07-27 — in-progress board audit

- Retained as active. The repository still has broad unit coverage and several
  component e2e scripts, but no committed deterministic message-to-tool
  delegation test or recorded full Discord happy-path proof.
