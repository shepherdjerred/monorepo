# Scout for LoL - LLM Project Guide

`AGENTS.md` is the authoritative Scout engineering guide. Load it before
changing code, and load the reusable `$scout-development` skill from
`packages/dotfiles/dot_agents/skills/scout-development/SKILL.md` for local
development, BETA data, dev auth, Kubernetes, and PinchTab workflows.

## Fast local workflow

Scout is a Bun workspace. Run commands from the repository root:

```bash
bun install

# Marketing site
PUBLIC_APP_ORIGIN=http://localhost:5180 PUBLIC_DOCS_ORIGIN=http://localhost:4322 \
bun run --filter=@scout-for-lol/frontend dev -- --host 127.0.0.1 --port 4321

# Scout documentation/wiki
PUBLIC_MARKETING_ORIGIN=http://localhost:4321 PUBLIC_APP_ORIGIN=http://localhost:5180 \
bun run --filter=@scout-for-lol/docs-site dev -- --host 127.0.0.1 --port 4322

# Management webapp and backend
bun run --filter='./packages/scout-for-lol' dev:web -- \
  --marketing-origin http://localhost:4321 --docs-origin http://localhost:4322
bun run --filter='./packages/scout-for-lol' dev:login -- --return-to /app/

# A second UI/API copy, without claiming the BETA gateway:
PUBLIC_APP_ORIGIN=http://localhost:5181 PUBLIC_DOCS_ORIGIN=http://localhost:4324 \
bun run --filter=@scout-for-lol/frontend dev -- --host 127.0.0.1 --port 4323
PUBLIC_MARKETING_ORIGIN=http://localhost:4323 PUBLIC_APP_ORIGIN=http://localhost:5181 \
bun run --filter=@scout-for-lol/docs-site dev -- --host 127.0.0.1 --port 4324
bun run --filter='./packages/scout-for-lol' dev:web -- \
  --backend-port 3001 --web-port 5181 --no-discord-gateway \
  --marketing-origin http://localhost:4323 --docs-origin http://localhost:4324
```

The webapp backend uses the BETA Discord bot token from
`dev-web.env.tpl` through `op run`, listens on `:3000`, and the Vite SPA listens
on `:5180`. One Discord gateway connection exists per token, so local `dev:web`
intentionally disconnects the deployed BETA bot until stopped. This is an
authorized and expected part of local development/testing; stop the process
when finished so BETA can reconnect. Only one copy may own that gateway;
secondary copies use `--no-discord-gateway`, separate ports, and an automatically
isolated SQLite file. Secondary copies do not have the live bot guild/channel
cache. Never write credentials to files, chat, or logs, and never use production
credentials locally.

## Local data and auth

Use the shared derived report lake explicitly:

```bash
export REPORT_LAKE_DIR="$HOME/.local/share/scout-for-lol/dev-seed/report-lake"
```

ScoutQL reads this Parquet lake through DuckDB; it is separate from the SQLite
application database. Do not compact it concurrently from multiple workspaces.

`dev:login` prints a URL for the loopback-only `/api/dev/login` route. It is a
session bootstrap, not a global auth bypass: `ENVIRONMENT=dev`, explicit
`ENABLE_DEV_LOGIN=true`, signed cookies, CSRF, and Discord-backed guild checks
remain required. Do not add `SKIP_AUTH` or `DEV_AUTH`.

For a secondary copy, set `SCOUT_DEV_BACKEND_URL` and `SCOUT_DEV_WEB_ORIGIN` to
its ports before running `dev:login`.

BETA SQLite lives at `/data/db.sqlite` in the
`scout-beta-scout-backend-*` pod in namespace `scout-beta`. Create a consistent
temporary copy with SQLite `VACUUM INTO` before using `kubectl cp`; never copy a
live database file directly or copy production data.

## PinchTab browser automation

Use PinchTab when the task needs real Chrome state, cookies, screenshots, or
interactive page behavior:

```bash
pinchtab health
pinchtab config
pinchtab profiles
```

The CLI and daemon must share `PINCHTAB_CONFIG`, normally
`$HOME/Library/Application Support/pinchtab/config.json`. Start a persistent
profile headed, navigate to the printed `dev:login` URL, then reuse the same
profile headlessly. Use accessibility snapshots and returned tab/instance IDs;
do not set HttpOnly cookies with `eval`, guess IDs, or persist tokens/profiles in
the repository. If a CAPTCHA appears, switch to headed mode and ask the
operator to solve it.

## Quality rules

- Use Bun commands, not npm/yarn/pnpm.
- Follow the no-type-assertions, fail-fast, and no-silent-fallback rules in
  `AGENTS.md`.
- Run focused Scout tests/typechecks before claiming a change works.
- Distinguish source, CI/image, deployment, reachability, and runtime proof.
