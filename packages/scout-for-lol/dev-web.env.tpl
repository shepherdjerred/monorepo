# Template for local web-UI development. Resolves at runtime via:
#   op run --env-file=dev-web.env.tpl -- ./scripts/dev-web.sh
#
# Secrets come from the BETA 1Password item (vault v64ocnykdqju4ui6j6pua56xw4,
# item rtu44pohnp5ixdp2njuv5f6t2e). Non-secret config is inline.
#
# ⚠️  Running this disconnects the deployed beta bot from Discord for the
# duration — only one gateway connection per token. Stop the local backend
# (Ctrl+C) and beta reconnects within seconds.

# ── Build / process identity ──────────────────────────────────────────
VERSION=local-dev
GIT_SHA=local-dev
ENVIRONMENT=dev
PORT=3000

# ── Discord BETA app (public IDs hard-coded in CDK8s; mirrored here) ──
APPLICATION_ID=1311755320745394317
DISCORD_TOKEN=op://v64ocnykdqju4ui6j6pua56xw4/rtu44pohnp5ixdp2njuv5f6t2e/DISCORD_TOKEN
DISCORD_CLIENT_SECRET=op://v64ocnykdqju4ui6j6pua56xw4/rtu44pohnp5ixdp2njuv5f6t2e/DISCORD_CLIENT_SECRET

# ── Web session signing ───────────────────────────────────────────────
JWT_SIGNING_SECRET=op://v64ocnykdqju4ui6j6pua56xw4/rtu44pohnp5ixdp2njuv5f6t2e/JWT_SIGNING_SECRET

# ── Where the SPA lives (browser-visible origin) ──────────────────────
# Vite dev server runs at :5180 and proxies /trpc + /api to the backend.
# This MUST match the redirect URI registered on the BETA Discord app.
WEB_APP_ORIGIN=http://localhost:5180

# ── Riot / DB / storage ───────────────────────────────────────────────
RIOT_API_KEY=op://v64ocnykdqju4ui6j6pua56xw4/rtu44pohnp5ixdp2njuv5f6t2e/RIOT_API_KEY
DATABASE_URL=file:./local-web-dev.db

# ── Optional: silence Sentry locally ──────────────────────────────────
SENTRY_DSN=
TELEMETRY_ENABLED=false
