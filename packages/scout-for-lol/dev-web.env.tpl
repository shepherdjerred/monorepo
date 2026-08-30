# Template for local web-UI development. Resolves at runtime via:
#   op run --env-file=dev-web.env.tpl -- ./scripts/dev-web.ts
#
# Secrets come from the BETA 1Password item (vault v64ocnykdqju4ui6j6pua56xw4,
# item rtu44pohnp5ixdp2njuv5f6t2e). Non-secret config is inline.
#
# ⚠️  The default gateway-owner copy intentionally disconnects the deployed beta
# bot from Discord for the duration — only one gateway owner per token. This is
# authorized for local development/testing. Stop the local backend (Ctrl+C) and
# beta reconnects within seconds. Secondary copies should pass
# --no-discord-gateway and use different ports.

# ── Build / process identity ──────────────────────────────────────────
VERSION=local-dev
# Temporal's ReleaseCommit search attribute (execution-metadata.ts) requires
# an exact 40-character lowercase hex Git SHA, so a non-hex placeholder like
# "local-dev" makes every Scout Temporal workflow start throw before any
# report-editor, weekly-parlay, or schedule flow can run locally.
GIT_SHA=0000000000000000000000000000000000000000
CONTRACT_HASH=local-dev
ENVIRONMENT=dev
PORT=3000

# ── Discord BETA app (public IDs hard-coded in CDK8s; mirrored here) ──
APPLICATION_ID=1311755320745394317
DISCORD_TOKEN=op://v64ocnykdqju4ui6j6pua56xw4/rtu44pohnp5ixdp2njuv5f6t2e/DISCORD_TOKEN
DISCORD_CLIENT_SECRET=op://v64ocnykdqju4ui6j6pua56xw4/rtu44pohnp5ixdp2njuv5f6t2e/DISCORD_CLIENT_SECRET

# ── Web session signing ───────────────────────────────────────────────
# Local-only signing secret — deliberately NOT the beta 1Password secret.
# The dev-login route (ENABLE_DEV_LOGIN, below) mints a session for any
# caller-chosen Discord ID; if it signed with the beta JWT_SIGNING_SECRET, that
# cookie would verify against the deployed beta backend (same iss/aud), letting
# anyone who can reach this machine's :3000 replay it as any beta user. A
# distinct local secret means dev-minted cookies are worthless off this machine.
# Any ≥32-char value works; this one is intentionally low-entropy and public.
JWT_SIGNING_SECRET=local-dev-only-jwt-signing-secret-not-for-any-deployed-env

# ── Where the SPA lives (browser-visible origin) ──────────────────────
# The default Vite dev server runs at :5180 and proxies /trpc + /api to the
# backend. scripts/dev-web.ts overrides this for --web-port.
WEB_APP_ORIGIN=http://localhost:5180

# Local web boots use a signed dev session and a representative consumer
# preview by default. Set SCOUT_DEV_AUTH_MODE=oauth when testing the real
# Discord round-trip; every selected local port must then be registered as an
# exact callback URI on the BETA Discord app.
SCOUT_DEV_AUTH_MODE=dev-login
SCOUT_DEV_CONSUMER_PREVIEW=true
SCOUT_DEV_CONSUMER_GUILD_ID=1337623164146155593

# ── AI (report editor + explore) ──────────────────────────────────────
# Every model call now goes through OpenRouter, so without this the backend
# still starts (unresolvedSecrets() does not validate the AI key) but every
# report-editor and Explore turn fails at the model call. Same BETA item as the
# secrets above, and the same field the deployed beta backend reads.
OPENROUTER_API_KEY=op://v64ocnykdqju4ui6j6pua56xw4/rtu44pohnp5ixdp2njuv5f6t2e/OPENROUTER_API_KEY
BETTING_PARLAY_AI_MODEL=gpt-5.6-sol

# dev:web derives DEV_USER_GUILDS and EXPLORE_GUILD_ALLOWLIST from the local
# consumer guild above. Set SCOUT_DEV_CONSUMER_PREVIEW=false and provide those
# variables explicitly when testing denied/unavailable states.

# ── Riot / DB / storage ───────────────────────────────────────────────
RIOT_API_KEY=op://v64ocnykdqju4ui6j6pua56xw4/rtu44pohnp5ixdp2njuv5f6t2e/RIOT_API_KEY
# Shared local dev Postgres (postgres-server.ts): dev-web derives
# scout_dev_<backend-port> when this matches the default; --database-url or
# SCOUT_DEV_DATABASE_URL override it (e.g. a restored beta snapshot database).
DATABASE_URL=postgres://scout@127.0.0.1:5471/scout_dev_3000

# Raw match JSON for a local report-lake rebuild (explore reads the lake, not
# the database). `dev:web` copies the machine-wide seed into this checkout
# automatically; build or refresh that seed once with:
#   bun run --filter='./packages/scout-for-lol' dev:seed
S3_BUCKET_NAME=scout-beta

# ── Optional: silence Sentry locally ──────────────────────────────────
SENTRY_DSN=
TELEMETRY_ENABLED=false
