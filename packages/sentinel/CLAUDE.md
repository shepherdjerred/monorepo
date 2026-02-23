# CLAUDE.md - Sentinel

Autonomous agent system that automates operational tasks (CI fixing, health checks, alert triage). Agents investigate and propose; humans approve before write actions execute.

## Commands

```bash
bun run dev        # Development with watch
bun run start      # Production
bun run typecheck  # Prisma generate + type check
bun run lint       # ESLint
bun test           # Run tests
```

## Architecture

- **Queue**: SQLite (Prisma) job queue with priority ordering
- **Worker**: Long-lived loop that polls queue, spawns agent sessions
- **Agents**: Defined in `src/agents/` with triggers, tools, permissions
- **Permissions**: 3-tier system (auto-allow reads, bash allowlist, approval queue)
- **History**: JSONL conversation logs in `data/conversations/`

## Environment

Requires `.env` with `DATABASE_URL`, `ANTHROPIC_API_KEY`, `DISCORD_TOKEN`, etc.
