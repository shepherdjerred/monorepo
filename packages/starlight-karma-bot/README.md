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
LEGACY_DATABASE_PATH=./data/glitter.sqlite
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
- `LEGACY_DATABASE_PATH`: legacy TypeORM database to import on first boot. The
  import is idempotent (skipped once the target has karma), but startup fails
  if this is set and the file is missing — silently starting empty is
  indistinguishable from total karma loss.

## Features

- Give karma to users with `/karma give @user [reason]`
- View karma leaderboard with `/karma leaderboard`
- Check karma history with `/karma history @user`
- **Multi-server support** - karma is tracked separately for each Discord server
- **Automatic migration** - legacy karma is automatically migrated on startup
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
