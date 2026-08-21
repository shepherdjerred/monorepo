# Scout Backend

The Scout for LoL backend service. A single Bun process that runs:

- The Discord bot (Discord.js): slash commands, match notifications, report delivery
- Match polling cron jobs through Scout's native Riot API client, with raw match JSON archived to S3
- The tRPC/HTTP server that the web app SPA (`@scout-for-lol/app`) and desktop client call
- The DuckDB "report lake" (Parquet, derived from S3) that executes ScoutQL report queries
- Server-side product analytics (PostHog) and metrics (Prometheus) / error tracking (Sentry)

Application state (subscriptions, competitions, guilds) is PostgreSQL 16
managed by Prisma (`@prisma/adapter-pg`). Report images are rendered by
`@scout-for-lol/report`.

## Commands

```bash
bun run dev              # Start with hot reload
bun run start            # Start once
bun run build            # Bundle to dist/

bun run test             # bun test; each test clones a hash-scoped template database
bun run typecheck        # tsc --noEmit
bun run lint             # ESLint
bun run format           # Prettier check

bun run db:generate      # Generate the Prisma client (+ branded types)
bun run db:push          # Push schema to the shared local dev Postgres (development)
bun run db:migrate       # Create/apply migrations (prisma migrate dev)
bun run db:studio        # Open Prisma Studio

bun run docker:build     # Build the backend Docker image (repo-root context)
bun run smoke            # Smoke-test the built image
bun run compact:report-lake  # Manually fold/rebuild the DuckDB report lake
```

`db:generate` must run after schema changes and before typecheck/test; from the
Scout root, `mise run generate` does the same thing.

## Configuration

Environment variables are validated with `env-var`/Zod at startup. Discord and
Riot API tokens are required; in test mode (`NODE_ENV=test`) placeholder values
are used automatically. For a full local backend + web app, use
`bun run dev:web` from the Scout package root (secrets via 1Password).

See the parent [AGENTS.md](../../AGENTS.md) for architecture depth: the report
lake layout, ScoutQL metric registry, deploy pipeline (beta continuous, prod
promoted), DM budget invariants, and analytics rules.
