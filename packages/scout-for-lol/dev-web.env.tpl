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
GIT_SHA=local-dev
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
# backend. scripts/dev-web.ts overrides this for --web-port; it MUST match the
# redirect URI registered on the BETA Discord app when testing OAuth.
WEB_APP_ORIGIN=http://localhost:5180

# ── AI (report editor + explore) ──────────────────────────────────────
# Every model call now goes through OpenRouter, so without this the backend
# still starts (unresolvedSecrets() does not validate the AI key) but every
# report-editor and Explore turn fails at the model call. Same BETA item as the
# secrets above, and the same field the deployed beta backend reads.
OPENROUTER_API_KEY=op://v64ocnykdqju4ui6j6pua56xw4/rtu44pohnp5ixdp2njuv5f6t2e/OPENROUTER_API_KEY
BETTING_PARLAY_AI_MODEL=gpt-5.6-sol

# Explore is gated on membership of an allowlisted Discord server, and an empty
# list denies everyone. Left unset here because the right value is whichever
# server you test in — export it for the session instead. A dev-login session
# has no Discord OAuth token, so pair it with DEV_USER_GUILDS (dev-only, see
# AGENTS.md) or the membership lookup fails and Explore refuses to load:
#   DEV_USER_GUILDS=<id> EXPLORE_GUILD_ALLOWLIST=<id> bun run dev:web

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
