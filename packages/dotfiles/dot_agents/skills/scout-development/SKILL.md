---
name: scout-development
description: >-
  Scout for League of Legends development workflow for LLM agents, including
  local marketing/docs/webapp surfaces, BETA credentials, dev session bootstrap,
  report-lake data, beta Postgres snapshots, Kubernetes inspection, and PinchTab
  real-Chrome automation. Use when developing, testing, or investigating Scout.
---

# Scout Development

Use this skill for Scout work under `packages/scout-for-lol`. Read the package
`AGENTS.md` before changing code; it contains the deeper architecture and
quality rules. Keep all secrets in 1Password and all copied databases/lake
data outside Git.

## Choose the local surface

Scout has three independent browser surfaces:

```text
marketing site   @scout-for-lol/frontend   Astro, usually :4321
Scout docs/wiki  @scout-for-lol/docs-site  Starlight, choose another port
webapp           @scout-for-lol/app        Vite :5180 + backend :3000
```

Run from the repository root:

```bash
PUBLIC_APP_ORIGIN=http://localhost:5180 \
PUBLIC_DOCS_ORIGIN=http://localhost:4322 \
bun run --filter=@scout-for-lol/frontend dev -- --host 127.0.0.1 --port 4321
PUBLIC_MARKETING_ORIGIN=http://localhost:4321 \
PUBLIC_APP_ORIGIN=http://localhost:5180 \
bun run --filter=@scout-for-lol/docs-site dev -- --host 127.0.0.1 --port 4322
bun run --filter='./packages/scout-for-lol' dev:web -- \
  --marketing-origin http://localhost:4321 \
  --docs-origin http://localhost:4322
```

`dev:web` is the complete webapp workflow. It applies local Prisma migrations,
starts the backend with the BETA Discord bot token, starts the Vite SPA, and
proxies `/api` and `/trpc` from `:5180` to `:3000`.

Each copy can use isolated ports and an isolated Postgres database on the
shared local dev server (port 5471, `SCOUT_PG_PORT` overrides):

```bash
# Gateway owner (the normal/default copy)
bun run --filter='./packages/scout-for-lol' dev:web

# Secondary copy: backend :3001, SPA :5181, database auto-derived as
# scout_dev_3001 on the shared server; do not claim the BETA gateway twice.
bun run --filter='./packages/scout-for-lol' dev:web -- \
  --backend-port 3001 \
  --web-port 5181 \
  --no-discord-gateway
```

The marketing site and wiki are independent Astro servers. A complete second
Scout surface set can therefore use `4323` and `4324` for those sites:

```bash
PUBLIC_APP_ORIGIN=http://localhost:5181 \
PUBLIC_DOCS_ORIGIN=http://localhost:4324 \
bun run --filter=@scout-for-lol/frontend dev -- --host 127.0.0.1 --port 4323
PUBLIC_MARKETING_ORIGIN=http://localhost:4323 \
PUBLIC_APP_ORIGIN=http://localhost:5181 \
bun run --filter=@scout-for-lol/docs-site dev -- --host 127.0.0.1 --port 4324
bun run --filter='./packages/scout-for-lol' dev:web -- \
  --backend-port 3001 --web-port 5181 --no-discord-gateway \
  --marketing-origin http://localhost:4323 \
  --docs-origin http://localhost:4324
```

Cross-surface navigation is origin-aware in local development. Keep these
origin variables/flags aligned when creating another stack; otherwise a
root-relative `/app/` or `/docs/` link stays on the wrong Astro server. In
production and beta, unset origins preserve the normal same-origin routes.

`--database-url postgres://...` (or `SCOUT_DEV_DATABASE_URL`) overrides the
derived database; only `postgres://`/`postgresql://` URLs are accepted. The web server
uses strict port binding, so a busy port fails clearly instead of silently
moving the SPA to a URL that `dev:login` does not know about. For a secondary
copy, point the login wrapper at its origins:

```bash
SCOUT_DEV_BACKEND_URL=http://127.0.0.1:3001 \
SCOUT_DEV_WEB_ORIGIN=http://localhost:5181 \
bun run --filter='./packages/scout-for-lol' dev:login -- --return-to /app/
```

## BETA credentials

Use the checked-in `packages/scout-for-lol/dev-web.env.tpl` through 1Password:

```bash
bun run --filter='./packages/scout-for-lol' dev:web
```

Do not copy values into `.env` files, shell history, chat, or logs. The local
flow uses the BETA `DISCORD_TOKEN`, Discord client secret, Riot key, and AI key
only through `op run`. A real `op vault list` or the exact required read is the
readiness check on macOS; `op whoami` is not authoritative.

Running the gateway-owner copy intentionally takes the one Discord gateway
connection for that token. This disconnects the deployed BETA bot while local
development is running, and that interruption is authorized and expected during
Scout development and testing. Stop it with Ctrl-C when finished; BETA
reconnects shortly afterward. Do not start a second gateway owner with the same
token: use `--no-discord-gateway` for secondary copies, or a separate test bot
token. Secondary copies do not have the live bot guild/channel cache, so
guild-picker and channel-picker flows require the gateway owner. Never use
production credentials for local development. The BETA Discord application must
register:

```text
http://localhost:<each-web-port>/api/auth/discord/callback
```

The test guild must contain the BETA bot for guild discovery and Discord-backed
authorization to work. The local `dev:login` flow avoids OAuth and is preferred
for secondary copies; register every OAuth callback port only when testing OAuth
itself.

## Local session bootstrap

This is a session bootstrap, not a global authorization bypass. The backend
still uses signed cookies, CSRF, and Discord-backed guild authorization.

With `dev:web` running:

```bash
bun run --filter='./packages/scout-for-lol' dev:login
bun run --filter='./packages/scout-for-lol' dev:login -- \
  --discord-id <discord-id> \
  --username 'Test User' \
  --return-to /app/g/<guild-id>/reports
```

The command checks `http://127.0.0.1:3000/ping` and prints a URL. Open that URL
in a browser or navigate to it with PinchTab. The route is registered only when
`ENVIRONMENT=dev` and `ENABLE_DEV_LOGIN=true`; the local backend binds to
loopback when it is enabled. Do not add `SKIP_AUTH`, `DEV_AUTH`, or a deployed
auth bypass.

## Shared report lake

ScoutQL reads Parquet through DuckDB, not Postgres fact tables. The shared local
lake is:

```bash
export REPORT_LAKE_DIR="$HOME/.local/share/scout-for-lol/dev-seed/report-lake"
```

Pass that variable when starting a local backend or `dev:web`. Treat it as
shared derived data: concurrent reads are fine, but do not run compaction from
multiple workspaces at once. Rebuilds read raw match JSON from the BETA S3
bucket and write the lake, so compaction is an explicit operator action rather
than part of ordinary UI development.

## Snapshot BETA state safely

BETA application state is the `scout` database in the `scout-beta-postgresql`
cluster (Zalando postgres-operator) in namespace `scout-beta`; the report lake
is `/data/report-lake` in the backend pod. Run `pg_dump` through the postgres
pod's local trust socket into an ignored local path, then restore into the
shared local dev server:

```bash
kubectl exec -n scout-beta scout-beta-postgresql-0 -- pg_dump -U postgres -Fc scout > "$HOME/.local/share/scout-for-lol/scout-beta.dump"
mise exec -- createdb -h 127.0.0.1 -p 5471 -U scout scout_beta_snapshot
mise exec -- pg_restore -h 127.0.0.1 -p 5471 -U scout -d scout_beta_snapshot --no-owner "$HOME/.local/share/scout-for-lol/scout-beta.dump"
SCOUT_DEV_DATABASE_URL=postgres://scout@127.0.0.1:5471/scout_beta_snapshot \
  bun run --filter='./packages/scout-for-lol' dev:web -- \
  --backend-port 3001 --web-port 5181 --no-discord-gateway
```

Use the same restored `scout_beta_snapshot` for the outreach pre-send review:

```bash
DATABASE_URL=postgres://scout@127.0.0.1:5471/scout_beta_snapshot \
  bun run --cwd packages/scout-for-lol/packages/backend scripts/outreach-dry-run.ts
```

Never copy production data — snapshots are beta-only. Do not expose the
database or credentials in logs. The exact database name and local destination
must be explicit in every command; never use a broad recursive copy.

## PinchTab and real Chrome

PinchTab is the preferred interactive browser path when existing Chrome state,
cookies, or screenshots matter. First verify the local daemon and shared config:

```bash
pinchtab health
pinchtab config
pinchtab profiles
```

The CLI and launchd daemon must use the same `PINCHTAB_CONFIG`, normally:
`$HOME/Library/Application Support/pinchtab/config.json`. Do not print the
bearer token. Use `pinchtab instances` and instance-scoped commands when using a
non-default profile; shorthand commands target the default instance.

For a new authenticated profile, start headed Chrome, navigate to the local
`dev:login` URL, and let the actual browser establish cookies. Do not set
HttpOnly cookies with `eval`. Keep the headed instance alive after login, then
reuse that profile in headless mode for automation:

```bash
pinchtab snap --interactive
pinchtab click <ref>
pinchtab fill <ref> '<value>'
pinchtab screenshot
pinchtab eval '<javascript>'
```

Use accessibility snapshots and returned tab/instance IDs rather than guessing
IDs. If a CAPTCHA appears, switch to headed mode and ask the operator to solve
it. Rate repeated external requests and never persist profiles, cookies, or
tokens in the repository.

## Verification

After workflow or auth changes, run the focused Scout script tests and backend
dev-login tests, then the Scout script typecheck/lint. Validate this skill with
the skill creator validator. For live checks, distinguish local source/test
success from BETA deployment and runtime acceptance.
