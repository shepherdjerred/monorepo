# Starlight Karma Bot

A Discord bot for tracking karma points, built with Bun, discord.js v14, and Prisma (SQLite via the libSQL adapter).

## Requirements

- [Bun](https://bun.sh/)
- Discord Bot Token
- Discord Application ID

## Setup

1. Install dependencies (from the monorepo root):

   ```bash
   bun install
   ```

2. Create a `.env` file with the following variables:

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

3. Create the data directory:

   ```bash
   mkdir -p ./data
   ```

## Development

```bash
bun run generate   # generate the Prisma client (scripts/generate-prisma.ts)
bun run migrate    # deploy database migrations (scripts/migrate.ts)
bun run typecheck  # generates first, then tsc
bun run lint
bun test
bun run format     # prettier --check
bun run prettier   # prettier --write
```

## Running

```bash
bun start          # generates the Prisma client, then starts the bot
bun run health     # health check against a running instance
```

## Commands

Everything lives under one `/karma` slash command (defined in `src/karma/command-definitions.ts`):

| Subcommand    | Description                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `give`        | Give karma to someone, with an optional reason (max 200 chars) and amount (1, 2, or 3; default 1)                |
| `leaderboard` | Server rankings, with `type` (received / most generous) and `period` (all time, this year, this month)           |
| `check`       | See how much karma someone has (defaults to you)                                                                 |
| `stats`       | A karma profile: totals, rank, and who gives you most                                                            |
| `why`         | See what someone earned their karma for                                                                          |
| `search`      | Search karma reasons for a word or phrase                                                                        |
| `undo`        | Take back the karma you just gave                                                                                |
| `config`      | Configure the scheduled recap: channel, enabled, and a UTC cron expression (requires Manage Server or bot admin) |
| `history`     | View recent changes to a person's karma                                                                          |

Karma can also be given by reacting with the karma emoji (`KARMA_EMOJI`, default a star) or via **Apps → Give Karma** on any message.

## Scheduled recap

The bot posts a periodic recap (leaderboard top 5, most generous, and up to
three historical entries from the same Monday-Sunday calendar week in an older year)
without anyone typing a command. `src/karma/recap.ts` polls for due guilds once
a minute and advances the next-fire timestamp even when posting fails, so a
deleted channel is not retried forever. The schedule is a per-guild cron
expression evaluated in UTC (`src/karma/recap-schedule.ts`, default `0 17 * * 5`
— Fridays 17:00 UTC), configured with `/karma config`.

## Milestones and reason filters

- **Milestones** (`src/karma/milestones.ts`) — crossing 10, 25, 50, 100, 250, or 500 total karma triggers a one-time announcement; a single give that vaults past two thresholds announces the higher one.
- **Reason filters** (`src/karma/reason-filters.ts`) — reason-oriented surfaces (`why`, `search`, recaps) only show positive, human-authored reasons; reaction awards and synthetic legacy-import rows are excluded.

## Docker

Build the image (the build context is the monorepo root — the Dockerfile needs the workspace lockfile):

```bash
bun run docker:build
# equivalent to: docker buildx build ... --load -t starlight-karma-bot:dev -f Dockerfile ../..
```

Smoke-test the built image (boots with dummy creds and asserts the bot reaches Discord login):

```bash
bun run smoke
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
  starlight-karma-bot:dev
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
- `KARMA_ADMIN_USER_ID`: Discord user ID allowed to configure recaps without
  the Manage Server permission
- `LEGACY_DATABASE_PATH`: **upgrades only** — see below. Leave it unset on a
  fresh install.
- `KARMA_EMOJI`: emoji that awards karma when reacted with (default `⭐`). A
  unicode character matches by name; a custom guild emoji matches by its id.

## Health endpoints

`/live` and `/ready` are served on `PORT` and used by the Kubernetes probes.

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
