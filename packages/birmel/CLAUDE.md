# CLAUDE.md - Birmel

Discord bot using Mastra for AI agent orchestration.

## Commands

```bash
bun run dev        # Development with watch
bun run start      # Production
bun run studio:dev # Mastra studio
```

## Testing

Requires Prisma setup before tests:

```bash
bunx --env-file=.env.test prisma generate
bun --env-file=.env.test test
```

Disconnect Prisma client in test teardown.

## Environment

Requires `.env` with Discord and AI API keys.
