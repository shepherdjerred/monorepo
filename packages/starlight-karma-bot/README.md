# Starlight Karma Bot

A Discord bot for tracking karma points, built with Bun.

## Requirements

- [Bun](https://bun.sh/) v1.0 or higher
- [mise](https://mise.jdx.dev/) (recommended for tool version management)
- Discord Bot Token
- Discord Application ID

## Setup

1. Install dependencies:

```bash
bun install
```

1. Create a `.env` file with the following variables:

```env
VERSION=1.0.0
ENVIRONMENT=dev
GIT_SHA=local
SENTRY_DSN=https://fb2f07bfb3544bd2bd279a1ce5f1e247@bugsink.sjer.red/5
PORT=8000
DISCORD_TOKEN=your_discord_token_here
APPLICATION_ID=your_application_id_here
DATABASE_PATH=./data/karma.db
```

1. Create the data directory:

```bash
mkdir -p ./data
```

## Development

```bash
# Type check
bun run typecheck

# Lint
bun run lint

# Format check
bun run format

# Auto-format
bun run prettier
```

## Running

Start the bot:

```bash
bun start
```

Run health check:

```bash
bun run health
```

## Docker

Build the Docker image with version information:

```bash
docker build \
  --build-arg VERSION=1.0.0 \
  --build-arg GIT_SHA=$(git rev-parse HEAD) \
  -t starlight-karma-bot .
```

Run the container:

```bash
docker run -d \
  --name karma-bot \
  -e DISCORD_TOKEN=your_token_here \
  -e APPLICATION_ID=your_app_id_here \
  -e DATABASE_PATH=/app/data/karma.db \
  -e ENVIRONMENT=prod \
  -v $(pwd)/data:/app/data \
  -p 8000:8000 \
  starlight-karma-bot
```

Required runtime environment variables:

- `DISCORD_TOKEN`: Your Discord bot token
- `APPLICATION_ID`: Your Discord application ID
- `DATABASE_PATH`: SQLite database file. **Must point inside the mounted
  volume** (e.g. `/app/data/karma.db`), otherwise karma is written to the
  container filesystem and lost when the container is replaced.
- `ENVIRONMENT`: Environment name (`dev`, `beta`, or `prod`)

Optional environment variables:

- `SENTRY_DSN`: Sentry DSN for error tracking
- `PORT`: Server port (default: 8000)
- `LEGACY_DATABASE_PATH`: **upgrades only** — see below. Leave it unset on a
  fresh install.
- `KARMA_EMOJI`: emoji that awards karma when reacted with (default `⭐`). A
  unicode character matches by name; a custom guild emoji matches by its id.

## Features

- Give karma by reacting with the karma emoji, via **Apps → Give Karma** on any
  message, or with `/karma give @user [reason] [amount]` (1-3)
- View karma leaderboard with `/karma leaderboard`
- Check karma history with `/karma history @user`
- **Multi-server support** - karma is tracked separately for each Discord server
- Persistent SQLite database
- Automatic one-shot import from the legacy TypeORM database on first boot
- Health endpoints at `/live` and `/ready` (used by the Kubernetes probes)

## Tech Stack

- **Runtime:** Bun
- **Discord:** discord.js v14
- **Database:** Prisma with SQLite (libSQL adapter)
- **Monitoring:** Sentry
- **Linting:** ESLint with strict TypeScript rules
- **Formatting:** Prettier
- **CI/CD:** Buildkite with Docker builds
- **Container Registry:** GitHub Container Registry (GHCR)

## Migrating from the legacy TypeORM database

Only relevant when upgrading an existing deployment that still has a
`glitter.sqlite` on its volume. **Leave `LEGACY_DATABASE_PATH` unset on a fresh
install** — a set-but-missing path deliberately fails startup, because silently
starting on an empty database is indistinguishable from total karma loss.

Point it at the legacy file and the bot imports it once, before logging in:

```env
LEGACY_DATABASE_PATH=/app/data/glitter.sqlite
```

The import verifies per-person totals inside the write transaction, so a
mismatch rolls back rather than committing unverified data. It is idempotent —
once the target has rows it is skipped — so the variable can stay set. The
legacy file is only ever read and remains the rollback artifact.

To rehearse against a copy first:

```bash
DATABASE_PATH=./data/karma.db bun scripts/import-legacy.ts ./data/glitter.sqlite
```
