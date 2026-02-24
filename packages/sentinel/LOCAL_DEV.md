# Sentinel - Local Development Guide

## Prerequisites

- [Bun](https://bun.sh/) installed (via `mise`)
- 1Password CLI (`op`) for secrets (optional, can use env vars instead)
- SQLite (bundled with Bun)

## Quick Start (Minimal)

Run Sentinel without webhooks or Discord (useful for testing the queue/worker):

```bash
# Install dependencies
bun install

# Generate Prisma client
bunx prisma generate

# Create the database
bunx prisma db push

# Start with minimal config
DATABASE_URL=file:./data/sentinel.db \
ANTHROPIC_API_KEY=your-key-here \
bun run dev
```

## Quick Start (Full, with 1Password)

```bash
# Copy the env template
cp .env.example .env

# Run with 1Password secret injection
op run --env-file=.env -- bun run dev
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | SQLite database path (e.g., `file:./data/sentinel.db`) |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude agent sessions |
| `DISCORD_TOKEN` | No | Discord bot token for notifications and approvals |
| `DISCORD_CHANNEL_ID` | No | Discord channel for Sentinel messages |
| `DISCORD_GUILD_ID` | No | Discord server ID |
| `GITHUB_WEBHOOK_SECRET` | No | HMAC secret for GitHub webhook verification |
| `PAGERDUTY_WEBHOOK_SECRET` | No | HMAC secret for PagerDuty webhook verification |
| `BUGSINK_WEBHOOK_SECRET` | No | Token for Bugsink webhook URL path verification |
| `BUILDKITE_WEBHOOK_TOKEN` | No | Token for Buildkite webhook header verification |
| `SENTRY_ENABLED` | No | Enable Sentry error tracking (default: `false`) |
| `TELEMETRY_ENABLED` | No | Enable telemetry (default: `true`) |
| `LOG_LEVEL` | No | Pino log level (default: `info`) |

## Running Tests

```bash
bun test
```

## Sending Test Webhooks

Use the test webhook script to send realistic failure payloads to a running Sentinel instance:

```bash
# Start Sentinel in one terminal
bun run dev

# In another terminal, send a test webhook
bun run test:webhook github
bun run test:webhook pagerduty
bun run test:webhook buildkite
bun run test:webhook bugsink

# Send to a custom URL
bun run test:webhook github http://localhost:8080
```

The script fetches secrets from 1Password first, falling back to environment variables.

## Inspecting the Queue

View job queue status and recent jobs:

```bash
bun run test:queue

# Use a custom database path
bun run test:queue -- --db=file:./data/other.db
```

## Architecture Overview

```
Webhooks (GitHub, PagerDuty, Buildkite, Bugsink)
  |
  v
Queue (SQLite via Prisma)
  |
  v
Worker (polls queue, spawns agent sessions)
  |
  v
Agent Sessions (Claude API conversations with tool use)
  |
  v
Discord (notifications, approval requests)
```

1. **Webhooks** receive events from external services, verify signatures/tokens, and enqueue jobs
2. **Queue** stores jobs in SQLite with priority ordering and deduplication
3. **Worker** polls the queue and spawns agent sessions for pending jobs
4. **Agents** are defined in `src/agents/` with specific triggers, tools, and permissions
5. **Discord** is used for notifications and human-in-the-loop approval of write actions

## Troubleshooting

**"Cannot find module '@prisma/client'"**
Run `bunx prisma generate` to generate the Prisma client.

**"database does not exist"**
Run `bunx prisma db push` to create the SQLite database and tables.

**Webhook returns 401**
Check that your webhook secrets match. Use `bun run test:webhook <provider>` to send a properly signed test payload.

**Webhook returns 500 "webhook not configured"**
The corresponding secret environment variable is not set. Check your `.env` file.

**No jobs being processed**
Check that the worker is running and the queue has pending jobs: `bun run test:queue`.
