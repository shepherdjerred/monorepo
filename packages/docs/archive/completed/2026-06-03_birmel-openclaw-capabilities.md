# Birmel OpenClaw-Like Capability Upgrade

## Status

**Complete** — all plan-scoped work verified shipped to `main` during the 2026-06-06 docs groom; archived to `archive/completed/`. Original tracking status preserved below.

Partially Complete

## Summary

Implement a Birmel-native expansion of durable automation, web/browser tools,
agent sessions, richer memory, and GPT-5.5 configuration while keeping
VoltAgent, Discord.js, Prisma, and the existing specialist-agent routing model.

## Implementation Notes

- Add persistent `AgentJob`/`AgentJobRun` scheduling with run history and keep
  legacy `ScheduledTask` rows readable during migration.
- Add `AgentSession`/`AgentSessionEvent` for Discord-thread-aware agent session
  state and steering.
- Add `AgentMemory` for scoped durable memory records in addition to VoltAgent
  working/conversation memory.
- Make PinchTab the primary browser backend, with Playwright retained as a
  fallback provider.
- Upgrade Birmel's default primary model to `gpt-5.5` and add reasoning effort
  plus verbosity config.

## Session Log — 2026-06-03

### Done

- Added Prisma schema and SQL migration for `AgentJob`, `AgentJobRun`,
  `AgentSession`, `AgentSessionEvent`, and `AgentMemory`.
- Added durable agent-job scheduling with migration from readable legacy
  `ScheduledTask` rows, run history, retries/backoff, timeout, skipped state,
  stale running-job recovery, mocked Discord delivery for Docker E2E, and
  in-place recurring next-run updates.
- Added `manage-agent-job`, `manage-agent-session`, enriched `manage-memory`,
  `web-research`, and PinchTab-primary `browser-automation` tooling while
  keeping Playwright fallback.
- Updated Discord thread tooling with thread summarization and thread-first
  routing language.
- Updated GPT-5.5 defaults, Responses reasoning/verbosity config, Birmel env
  docs, prompt guidance, tool descriptions, and homelab Birmel deployment env.
- Added unit coverage for schedule parsing/default config/prompt guidance and
  added a Docker E2E harness for persistent jobs, memory, sessions, web fetch,
  PinchTab calls, restart persistence, and mocked Discord delivery.

### Remaining

- Run `bun run --filter='./packages/birmel' generate`,
  `bun run --filter='./packages/birmel' typecheck`,
  `bun --env-file=.env.test test` in `packages/birmel`, relevant homelab tests,
  and `bun run --filter='./packages/birmel' test:e2e:openclaw-docker` once
  network/Docker escalation is available.
- Remove the generated `.tmp/` cache directory after approval or when the
  sandbox allows cleanup.

### Caveats

- Verification is blocked by the approval system's usage-limit rejection:
  Prisma generation/test setup cannot resolve the `prisma` package through
  `bunx`, dependency install for homelab tests is unavailable, and Dagger
  Docker E2E cannot access the OrbStack Docker socket without escalation.
- The OpenAI hosted-search path is represented as the configured provider, but
  the current implementation uses direct DuckDuckGo/static-fetch fallback when
  hosted search is unavailable in-process.

## Session Log — 2026-06-05

### Done

- Addressed PR review findings for durable automation:
  `cancelAgentJob` now requires the requesting user to own the job, reminders
  enforce the per-guild active-job limit, `run-now` queues only the selected
  job instead of running every due job inline, and agent-job timeout timers are
  cleared after completion.
- Updated browser screenshot path defaults to avoid `process.cwd()` in the
  runtime browser tool.
- Split the PinchTab browser provider into its own module so the browser tool
  stays lintable while keeping PinchTab as the primary backend.
- Fixed strict TypeScript issues in the newly added memory/session/thread/web
  research/scheduler code paths.
- Fixed the Docker E2E harness to generate Prisma Client inside the container
  before `db push`.
- Verified `bun run --filter='./packages/birmel' typecheck`,
  `bun run --filter='./packages/birmel' lint`,
  `bun --env-file=.env.test test` in `packages/birmel`, and
  `bun run --filter='./packages/birmel' test:e2e:openclaw-docker`.

### Remaining

- Continue PR readiness monitoring until CI is green, mergeability is clean,
  and all P3-or-higher comments are resolved or outdated.

### Caveats

- The full Birmel test suite still reports 5 existing skipped browser tests.
