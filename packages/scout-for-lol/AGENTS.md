# Scout for LoL - Project Guide

## Environment Notes

**Remote environments**: When `CLAUDE_CODE_REMOTE=true`, use `bun run` commands for local development tasks.

## Project Structure

Monorepo using **Bun workspaces**:

```text
packages/
├── backend/   # Discord bot backend service (Discord.js, Prisma, native Riot client)
├── data/      # Shared data models, schemas, and utilities
├── design-system/ # Shared themes, components, browser assets, and Satori foundations
├── report/    # Report generation components (React + satori)
├── frontend/  # Web frontend (Astro + React + Tailwind)
├── docs-site/ # User documentation (Astro + Starlight)
├── app/       # Management web app (React + Vite)
├── desktop/   # Desktop app (Tauri + React + Vite)
└── ui/        # Desktop sound-editor UI (separate and out of web scope)
```

## Workspace Dependencies

Scout's sub-packages are part of the root Bun workspace and use `workspace:*`
for internal dependencies (for example `@scout-for-lol/data` and
`@scout-for-lol/backend`). Run `bun install` once at the repository root after
dependency changes.

- The isolated linker is configured at the repository root. Do not add package
  local `bunfig.toml` linker overrides.
- Internal Scout package edits are visible through workspace symlinks; no
  package-local reinstall is needed to refresh copied `file:` dependencies.
- The app imports the backend `AppRouter` as `import type` only, so tRPC
  input/output changes still need dependent typechecks before the app sees the
  new procedure shape.

---

## Core Technologies

| Category      | Technology                       |
| ------------- | -------------------------------- |
| Runtime       | Bun                              |
| Language      | TypeScript (strict mode)         |
| Linting       | ESLint + Prettier                |
| Database      | PostgreSQL 16 + Prisma ORM       |
| Validation    | Zod                              |
| Task Runner   | mise                             |
| Bot Framework | Discord.js                       |
| Frontend      | Astro                            |
| Desktop       | Tauri + Vite                     |
| Reports       | React + satori + @resvg/resvg-js |

## Development Commands

### Root Level

```bash
bun install              # Install all dependencies
bun run typecheck        # Type checking across all packages
bun run lint             # Linting across all packages
bun run format           # Formatting check across all packages
bun run test             # Testing across all packages
bun run generate         # Generate Prisma client and other generated code
bun run clean            # Clean all node_modules
bun run knip             # Find unused code/dependencies
bun run duplication-check # Check for code duplication
```

### Using mise (Task Runner)

```bash
mise run dev             # Setup development environment
mise run check           # Run all checks (typecheck, lint, format, test, knip, duplication-check)
mise run generate        # Generate Prisma client
```

### Backend Package

```bash
cd packages/backend
bun run dev              # Start with hot reload
bun run build            # Build for production
bun run db:generate      # Generate Prisma client
bun run db:push          # Push schema to the shared local dev Postgres
bun run db:migrate       # Run migrations (prisma migrate dev) against it
bun run db:studio        # Open Prisma Studio
```

### Web UI (Local end-to-end)

```bash
bun run --filter='./packages/scout-for-lol' dev:web
```

This boots the backend on `:3000` (logging in as the BETA Discord bot) and the
Vite dev server on `:5180` (proxying `/trpc` + `/api` to the backend). It
first ensures the shared machine-wide Postgres server is running (mise-pinned
PostgreSQL 16 binaries from the root `.mise.toml`,
`ubi:theseus-rs/postgresql-binaries`; data dir
`~/.local/share/scout-for-lol/postgres/16`, honours `XDG_DATA_HOME`; port
`5471`, `SCOUT_PG_PORT` overrides — managed by
`packages/backend/src/testing/postgres-server.ts`'s `ensureDevPostgres`), then
applies Prisma migrations against a per-copy `scout_dev_<backend-port>`
database on it. To run a second copy, use different ports and
`--no-discord-gateway`; the database name follows the backend port
(`scout_dev_3001`):

```bash
bun run --filter='./packages/scout-for-lol' dev:web -- \
  --backend-port 3001 \
  --web-port 5181 \
  --no-discord-gateway \
  --no-backend-watch
```

Use `--database-url postgres://...` (or `SCOUT_DEV_DATABASE_URL`) for an
explicit local database; only `postgres://`/`postgresql://` URLs are accepted.
Ports are strict: a busy port fails instead of silently changing the URL.
`--no-backend-watch` keeps a browser-testing backend stable while tests and
code generation rewrite imported artifacts; restart `dev:web` deliberately
after backend edits. Vite still hot-reloads app changes.

Secrets are pulled at runtime via `op run --env-file=dev-web.env.tpl` — no
plaintext credentials are written to disk. On macOS, test the exact `op`
operation you need; Desktop integration may authenticate per command even when
`op whoami` reports no shell session.

**Caveats:**

- While running, the deployed beta bot is disconnected from Discord (one
  gateway connection per token). This is an intentional and authorized part of
  local Scout development/testing, not a reason to avoid starting `dev:web`.
  Stop with Ctrl+C when finished and beta reconnects within seconds.
- Only one local copy may own the BETA gateway. Secondary copies must pass
  `--no-discord-gateway` (or use a separate test bot token); they do not have
  the live bot guild/channel cache, so guild and channel picker flows use the
  gateway-owner copy.
- Explore and every ScoutQL report read the **report lake**, not the database.
  A checkout with no lake answers every question with zero rows and looks
  broken rather than empty — see the shared seed below.
- The BETA Discord app (`1311755320745394317`) must list
  `http://localhost:<each-web-port>/api/auth/discord/callback` in its OAuth
  redirect URIs, otherwise the token exchange returns 400. `dev:login` avoids
  OAuth and is preferred for secondary copies.
- The bot only sees guilds it has been invited to. To populate the guild
  picker, make sure your test guild has the BETA bot in it.

### Shared report-lake seed (multiple checkouts / parallel agents)

`REPORT_LAKE_DIR` defaults to `./report-lake` **relative to the backend's
cwd**, so every worktree and every Conductor workspace gets its own empty lake
and would otherwise pay a full S3 walk each. A machine-wide seed at
`~/.local/share/scout-for-lol/dev-seed/report-lake` (honours `XDG_DATA_HOME`)
is built once and copied into each checkout.

```bash
bun run --filter='./packages/scout-for-lol' dev:seed                    # rebuild the seed from S3
bun run --filter='./packages/scout-for-lol' dev:seed -- --from-checkout # publish this checkout's lake as the seed
bun run --filter='./packages/scout-for-lol' dev:seed -- --status        # what the seed and this checkout hold
```

`dev:web` calls `adoptSeedIfUnseeded` before starting the backend: a checkout
with no published build gets the seed copied in, one that already has a build
is left alone, and a missing seed prints how to build one and boots anyway.

- **`dev:web` resolves `REPORT_LAKE_DIR` against the backend's cwd, then passes
  the absolute result to the backend.** `dev:web` itself runs from the Scout
  package root, so a relative value would otherwise name one directory to the
  seeding copy and a different one to the backend that reads it — a lake that
  reports as seeded and still answers with no rows. It matters more than a
  wasted copy: the copy removes its destination before renaming the staged tree
  in, so a caller-relative path deletes a directory nobody chose.
- **The seed is a copy source, not a shared working directory.** A running
  backend folds staged rows into a new build every 15 minutes and GCs old
  builds, so several backends pointed at one directory would publish and
  collect over each other. Do not "save space" by pointing `REPORT_LAKE_DIR`
  at the seed.
- **`CURRENT` naming an existing build directory is the seeded test**, not the
  directory existing. Backend startup creates the four staging subdirectories,
  so an unbuilt lake is indistinguishable from a built one by `ls` alone —
  which is exactly how an empty lake gets mistaken for a broken query engine.
- Copies land in `<lake>.seeding` and are renamed into place, so an interrupted
  copy never leaves a partial tree behind a `CURRENT` that claims completeness.
- `--from-checkout` exists because the rebuild is the expensive part: if any
  checkout already has a good lake, publish that rather than re-walking S3.

### Local UI screenshots (no manual OAuth click-through)

`GET /api/dev/login[?discordId=...&username=...&returnTo=/app/...]`
(`packages/backend/src/trpc/dev-login.ts`) mints a real signed session for a
chosen — or fake default — Discord user without the OAuth round-trip.
**Registered only when `configuration.environment === "dev"` AND the explicit
`ENABLE_DEV_LOGIN` flag is set** (both checked inline in `http-server.ts`'s
route dispatch) — genuinely absent from beta/prod, not just gated behind a
runtime `if` inside an always-present handler. The extra flag matters because
`ENVIRONMENT` defaults to `"dev"` when unset, so gating on environment alone
would fail _open_ (expose an unauthenticated session-minting route) on any
deploy that forgot to set it; `ENABLE_DEV_LOGIN` defaults off, so an omitted
config fails closed. `scripts/dev-web.ts` sets it for local runs. When
`ENABLE_DEV_LOGIN` is set, the backend also binds `127.0.0.1` (loopback) instead
of `0.0.0.0`, so the unauthenticated dev-login route can't be reached from
another host on the network.

Driving this by hand: with `dev:web` running, visiting
`http://localhost:5180/api/dev/login?discordId=<id>&returnTo=/app/g/123` in
a browser signs you in as that user and lands on the given route. Omit
`discordId` for a stable fake test user; pass a real Discord ID (e.g. the
owner's) to see UI gated to a specific account (PR #1676 adds one such
example, a version-mismatch banner in
`packages/app/src/components/version-info.tsx`).

The `toolkit screenshot` command (`packages/toolkit`, `screenshot` skill)
wraps this into one call:

```bash
toolkit screenshot scout-app /app/ --discord-id 160509172704739328
```

#### `DEV_USER_GUILDS` — dev-only Discord membership (needed for `/app/explore`)

A dev-login session carries **no Discord OAuth token**, so anything that
resolves the caller's servers cannot answer for it: `fetchUserGuilds` calls
`getFreshUserAccessToken(user)` and fails as `token_refresh_failed` →
`UNAUTHORIZED`. That is why dev-login alone gets you the guild picker's empty
state and, on `/app/explore`, the "Explore couldn't load" panel rather than the
page — `explore.status` converts only `FORBIDDEN` into `enabled: false`, so an
auth failure rethrows.

`DEV_USER_GUILDS` is a comma-separated list of Discord server ids that stands in
for Discord's answer, as owner + `ADMINISTRATOR` (a member-only stand-in would
block every management screen it exists to reach):

```bash
DEV_USER_GUILDS=1337623164146155593 \
EXPLORE_GUILD_ALLOWLIST=1337623164146155593 \
  bun run --filter='./packages/scout-for-lol' dev:web
```

The two are separate on purpose and both are needed: `EXPLORE_GUILD_ALLOWLIST`
is the real product gate (which servers may use Explore), `DEV_USER_GUILDS` is
the fake answer to "which servers is this user in". Setting only the allowlist
denies you; setting only the membership leaves the allowlist empty, which
denies everyone.

- **Honoured only when `environment === "dev"` AND `enableDevLogin`**
  (`devGuildOverride` in `src/lib/discord-rest.ts`), the same pair that binds
  the server to loopback. All three conditions are required and each fails
  closed on its own: `ENVIRONMENT` defaults to `"dev"` when unset, so gating on
  environment alone would fail _open_ on a deploy that forgot to set it;
  `ENABLE_DEV_LOGIN` defaults off; and an empty list means "no override" rather
  than "no guilds", so an omitted config changes nothing.
- **It replaces the membership lookup, not the gate.** The session cookie, CSRF,
  and `EXPLORE_GUILD_ALLOWLIST` all still apply — this only answers the question
  a tokenless dev session cannot ask Discord.
- The backend logs a one-time warning when it takes effect, so a faked
  membership is never silent in the logs.
- The gate conditions are unit-tested in `src/lib/discord-rest.test.ts`,
  including each refusal — an accept-only test would not catch the fail-open.

This does not, by itself, reproduce every possible backend-driven state —
see the `screenshot` skill's Limitations section (no network-response
mocking in v1).

The Scout-specific CLI wrapper performs the backend readiness check and prints
the same browser/PinchTab-ready URL without requiring an agent to hand-build
query strings:

```bash
bun run --filter='./packages/scout-for-lol' dev:login
bun run --filter='./packages/scout-for-lol' dev:login -- \
  --discord-id <discord-id> \
  --username 'Test User' \
  --return-to /app/g/<guild-id>/reports
```

For a non-default copy, set its origins explicitly:

```bash
SCOUT_DEV_BACKEND_URL=http://127.0.0.1:3001 \
SCOUT_DEV_WEB_ORIGIN=http://localhost:5181 \
bun run --filter='./packages/scout-for-lol' dev:login -- --return-to /app/
```

This is a local session bootstrap, not an authorization bypass. The route still
requires `ENVIRONMENT=dev` plus explicit `ENABLE_DEV_LOGIN=true`, binds the
backend to loopback, and leaves signed-session, CSRF, and Discord-backed guild
authorization checks intact. Never add `SKIP_AUTH` or `DEV_AUTH`.

### LLM development workflow

Load the reusable `$scout-development` skill from
`packages/dotfiles/dot_agents/skills/scout-development/SKILL.md` for the full
workflow. The three browser surfaces are independent:

```bash
# Marketing site
PUBLIC_APP_ORIGIN=http://localhost:5180 \
PUBLIC_DOCS_ORIGIN=http://localhost:4322 \
bun run --filter=@scout-for-lol/frontend dev -- --host 127.0.0.1 --port 4321

# Scout user documentation/wiki
PUBLIC_MARKETING_ORIGIN=http://localhost:4321 \
PUBLIC_APP_ORIGIN=http://localhost:5180 \
bun run --filter=@scout-for-lol/docs-site dev -- --host 127.0.0.1 --port 4322

# Management webapp + backend
bun run --filter='./packages/scout-for-lol' dev:web -- \
  --marketing-origin http://localhost:4321 \
  --docs-origin http://localhost:4322
```

Marketing and docs are independent Astro processes. For a complete second
surface set, use different Astro ports alongside the isolated app/backend:

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

The `PUBLIC_*_ORIGIN` variables configure Astro's cross-surface links, and the
`dev:web` origin flags configure the Vite app's links. Keep all three origin
sets aligned: navigation from docs to app, app to marketing, and marketing to
docs must cross the ports explicitly. With no origin variables in a production
or beta build, links remain same-origin (`/app/` and `/docs/`) as expected.

The shared local report lake is
`$HOME/.local/share/scout-for-lol/dev-seed/report-lake`; set
`REPORT_LAKE_DIR` explicitly when using it. It is derived Parquet data queried
by DuckDB, not the Postgres application database, and compaction is an explicit
single-operator action. Multiple copies may read it concurrently.

BETA application state is the `scout` database in the `scout-beta-postgresql`
cluster (Zalando postgres-operator) in namespace `scout-beta`; the lake is
`/data/report-lake` in the backend pod. To copy BETA state, run `pg_dump`
through the postgres pod's local trust socket into an ignored local path, then
restore into the shared local dev server. For example:

```bash
kubectl exec -n scout-beta scout-beta-postgresql-0 -- pg_dump -U postgres -Fc scout > "$HOME/.local/share/scout-for-lol/scout-beta.dump"
mise exec -- createdb -h 127.0.0.1 -p 5471 -U scout scout_beta_snapshot
mise exec -- pg_restore -h 127.0.0.1 -p 5471 -U scout -d scout_beta_snapshot --no-owner "$HOME/.local/share/scout-for-lol/scout-beta.dump"
SCOUT_DEV_DATABASE_URL=postgres://scout@127.0.0.1:5471/scout_beta_snapshot \
  bun run --filter='./packages/scout-for-lol' dev:web -- \
  --backend-port 3001 --web-port 5181 --no-discord-gateway
```

Never copy production data (snapshots are beta-only) or print credentials.
The BETA pod uses the real BETA Discord token and one gateway connection, so the
gateway-owner `dev:web` intentionally disconnects the deployed BETA bot until
stopped. That disconnect is authorized and expected for local
development/testing; stop the process when finished so BETA can reconnect. Run
secondary copies with `--no-discord-gateway` and isolated ports/databases.

For browser automation, use PinchTab's real Chrome profile. Verify
`pinchtab health`, `pinchtab config`, and `pinchtab profiles`; keep the CLI and
daemon on the same `PINCHTAB_CONFIG` (normally
`$HOME/Library/Application Support/pinchtab/config.json`). Start a persistent
profile headed, navigate to the printed `dev:login` URL, then reuse that
profile headlessly with accessibility snapshots, actions, screenshots, and
evaluation. Do not set HttpOnly cookies through `eval`, guess tab IDs, or put
tokens/profiles/cookies in Git.

### Post-match review evals

`packages/evals` is the loopback-only app for immutable review datasets, human
1-3 ratings, and style-batch freshness checks. Run it with
`bun run --filter=@scout-for-lol/evals dev`. Candidate discovery and explicit
S3/model-backed draft materialization are documented in `packages/evals/README.md`.
The corpus is Beta-only. `sync-beta` creates a sanitized local profile snapshot
by kubectl-execing one `psql` `json_agg` query against `scout-beta-postgresql-0`
(database `scout`), and discovery/materialization use that snapshot with the
`scout-beta` S3 bucket. Raw S3 match objects do not preserve Scout aliases or
tracked membership; never infer those identities from arbitrary Riot
participants or substitute the production bucket.

The full operator workflow (flags and examples in `packages/evals/README.md`):

| Command                                                                                  | Purpose                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run --filter=@scout-for-lol/evals dev`                                              | Launch the loopback web app to rate cases and run style-batch freshness checks.                                                                 |
| `bun run --filter=@scout-for-lol/evals sync-beta`                                        | Snapshot a sanitized Beta profile corpus (read from Beta Postgres via `psql`) into the local SQLite snapshot used by discovery/materialization. |
| `AWS_PROFILE=seaweedfs bun run --filter=@scout-for-lol/evals discover -- …`              | Discover candidate matches from the `scout-beta` bucket against the snapshot.                                                                   |
| `bun run --filter=@scout-for-lol/evals materialize -- --spec <file>`                     | Materialize a new draft — or extend an existing draft via the spec's `datasetId` — with S3/model cases.                                         |
| `bun run --filter=@scout-for-lol/evals dataset:push -- --dataset <id> --server <url>`    | Push a locally-materialized draft to the hosted instance over the tailnet (additive, never overwrites).                                         |
| `bun run --filter=@scout-for-lol/evals dataset:export -- --dataset <id> --output <file>` | Export a finalized dataset to a checksummed, generation-set-bound transfer file.                                                                |
| `bun run --filter=@scout-for-lol/evals dataset:import -- --input <file>`                 | Import a transfer file into another eval database (rejects tampered checksums or freshness bindings).                                           |

Run the deterministic browser suite with
`bunx turbo run test:e2e --filter=@scout-for-lol/evals`. It uses a test-only
in-memory store and the production-built Hono/tRPC/React path; it never reads the
operator's eval database or calls Beta, S3, or OpenRouter. Keep the suite
single-worker unless each mutating scenario is moved to an isolated store.

### Desktop Package

```bash
cd packages/desktop
bun run dev              # Start Tauri dev mode
bun run build            # Build desktop app
bun run build:macos      # Build for macOS (universal)
bun run build:linux      # Build for Linux
bun run build:windows    # Build for Windows
```

Each package supports: `dev`, `build`, `test`, `lint`, `format`, `typecheck`

## CI/CD

CI runs on the static Buildkite pipeline (`.buildkite/pipeline.yml`): every PR runs `bun run verify` (affected-scoped, includes scout's checks), Playwright e2e, a dry-run image build + smoke, and dry-runs of the scout site-release subcommands; on merge to main the backend image is built, smoked, and pushed. Locally, `bun run verify` (or `mise run check`) mirrors CI; build the backend image with `bun run --filter=@scout-for-lol/backend docker:build` (`bunx turbo run smoke --filter=@scout-for-lol/backend` builds + smoke-tests it).

### Stage deploys are lockstep (beta continuous, prod promoted)

Each stage serves backend + marketing site + SPA from the same monorepo build; the SPA compiles against the backend tRPC router types, so mixed versions are a real contract hazard.

- **Beta (continuous):** every main build auto-bumps the `shepherdjerred/scout-for-lol/beta` image pin (version commit-back) and runs `bun scripts/scout-site-release.ts deploy-beta` (beta-flavored site → `scout-frontend-beta` bucket + a `.release-version` marker). The same build archives a prod-flavored site artifact to `s3://scout-site-releases/2.0.0-<n>/` for later promotion.
- **Prod (promotion = merging the Renovate PR):** the `scout-tag-release` CI step mints `ghcr.io/shepherdjerred/scout-for-lol:2.0.0-<n>` after site version `<n>` is archived, pointing at the backend digest beta serves it against — every minted tag is a complete backend+site release pair. Renovate (docker datasource on the `shepherdjerred/scout-for-lol/prod` pin, `automerge: false`) offers those tags as a standing PR. **Merging that PR is the promotion**: ArgoCD deploys the backend and the `scout-prod-reconcile` CI step syncs the prod bucket from the archived artifact for the version in the pin's tag portion (there is no separate site pin). Don't enable auto-merge unless you want prod to track beta continuously. Rollback = revert the promotion commit, or hand-edit the pin to any older **minted** tag@digest.
- **Never** deploy the scout buckets with `scripts/deploy-site.ts` (they're intentionally not in its catalog) and never pin a tag that was not minted by `scout-tag-release` (e.g. hand-pairing a tag with a different digest) — that reintroduces the unversioned frontend↔backend skew.
- Verify what a stage serves: `curl https://scout-for-lol.com/.release-version` / `curl https://beta.scout-for-lol.com/.release-version`.

---

## TypeScript Standards

### Strict Type Safety Rules

- **NEVER use `any`** - Always define proper types
- **Avoid type assertions (`as`)** - Enforced by `custom-rules/no-type-assertions`
- **Use `unknown` for uncertain types** - Validate with Zod before processing
- **Prefer advanced types** - Mapped types, conditional types, template literals
- **Exhaustive pattern matching** - Use `ts-pattern` for complex branching
- **Strict null checks** - Handle undefined/null explicitly
- **No type guards** - Enforced by `custom-rules/no-type-guards`, use Zod validation instead

### Validation Patterns

```typescript
// Always validate unknown input with Zod
const result = SomeSchema.safeParse(unknownData);
if (!result.success) {
  throw new Error(fromZodError(result.error).toString());
}

// Advanced types for complex scenarios
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};
```

### Error Handling

- Handle errors at appropriate levels
- Use Result patterns where appropriate
- Proper async/await error handling (enforced by `custom-rules/prefer-async-await`)

---

## Custom ESLint Rules

The project uses custom ESLint rules in `eslint-rules/`:

| Rule                        | Purpose                                         |
| --------------------------- | ----------------------------------------------- |
| `no-type-assertions`        | Disallow `as` type assertions                   |
| `no-type-guards`            | Disallow custom type guard functions            |
| `prefer-zod-validation`     | Enforce Zod for runtime validation              |
| `prefer-bun-apis`           | Prefer Bun APIs over Node.js equivalents        |
| `prefer-async-await`        | Disallow .then()/.catch() promise chains        |
| `prefer-structured-logging` | Require tslog instead of console.log (backend)  |
| `zod-schema-naming`         | Enforce \*Schema suffix for Zod schemas         |
| `no-dto-naming`             | Disallow _Dto suffix (use Raw_ prefix)          |
| `require-ts-extensions`     | Require .ts extensions in imports               |
| `satori-best-practices`     | Enforce satori rendering requirements (report)  |
| `prisma-client-disconnect`  | Ensure Prisma clients are disconnected in tests |
| `no-re-exports`             | Disallow barrel file re-exports                 |
| `no-function-overloads`     | Disallow TypeScript function overloads          |
| `no-parent-imports`         | Disallow `../` imports                          |
| `no-shadcn-theme-tokens`    | Prevent shadcn tokens in marketing components   |

---

## Unified Web Design System

`@scout-for-lol/design-system` is the only visual source of truth for the
marketing site, Starlight documentation, management app, and shared report
foundations.

- Consume standalone `@scout-for-lol/design-system/styles.css`; do not create a
  surface-local color or theme system, and do not rely on Tailwind scanning the
  design-system package.
- Site-local Tailwind composition uses the exported `--scout-*` CSS variables.
  Reusable primitives, chrome, layouts, marketing compositions, and
  value/callback-only Scout widgets belong in the design system.
- Framework adapters, routing, SEO, analytics, authentication, tRPC workflows,
  and permission-aware business composition stay in their surface package.
- Theme state is canonical under `scout-theme-v1`. Only the shared runtime may
  write `data-scout-skin`, `data-scout-mode`, Starlight's `data-theme`, or the
  compatibility `.dark` class.
- Reports import only Satori-safe resolved values, fonts, and assets from the
  design system. Report markup, layout, transformations, exports, and feature
  routing remain in `@scout-for-lol/report`, and the committed visual contract
  must remain byte-for-byte unchanged.
- `@scout-for-lol/ui` remains the desktop sound-editor package. Do not migrate
  or import it into the web design system.

---

## Code Quality Limits

Enforced by ESLint:

- **max-lines**: 500 lines per file (1500 for tests)
- **max-lines-per-function**: 400 lines (200 for tests)
- **complexity**: 20 max cyclomatic complexity
- **max-depth**: 4 levels of nesting
- **max-params**: 4 parameters per function
- **File naming**: kebab-case enforced by `unicorn/filename-case`

---

## Key Libraries

| Library           | Purpose                                 |
| ----------------- | --------------------------------------- |
| `remeda`          | Functional data transformations         |
| `ts-pattern`      | Complex control flow / pattern matching |
| `env-var`         | Type-safe environment configuration     |
| `date-fns`        | Date operations                         |
| `zod`             | Runtime validation and schemas          |
| `satori`          | JSX to SVG rendering                    |
| `@resvg/resvg-js` | SVG to PNG conversion                   |
| `tslog`           | Structured logging (backend)            |

---

## Discord Bot Patterns

### Command Structure

Production exposes eight global Discord commands: `/help`, `/setup`, `/status`,
`/invite`, `/docs`, `/track`, `/list`, and `/scout`. Beta exposes the first
seven globally and registers `/scout` only in `EXPLORE_GUILD_ALLOWLIST` guilds.
The web dashboard is the canonical surface for filters, queues, channels,
competitions, saved report configuration, roles, audit history, and Explore
follow-ups. Do not recreate the removed management command trees.

`/bb` (Bryan Bucks) and `/lobby` are beta-only guild-scoped exceptions, pinned
by `definitions.test.ts`; production's hard-disable policy keeps them out of
both global and guild payloads regardless of local or Flipt overrides.
`/scout ask` starts one fresh, private, saved Explore conversation and may post
its frozen result publicly; Discord never continues the conversation. Adding
another command still needs the same explicit product decision.

**Interactions are routed in `discord/interactions.ts`**, not in
`discord/commands/index.ts`. That module is the single `interactionCreate`
registration and dispatches buttons alongside chat-input commands; the commands
module owns command dispatch only. It previously owned the event too and
early-returned on anything that was not a chat-input command, which silently
dropped every message component.

Definitions are collected in `packages/backend/src/discord/commands/definitions.ts`
and registered with a full global `applicationCommands` replacement in
`discord/rest.ts`. After the gateway connects, every guild in the client's
cache receives its complete merged guild-command payload — including an empty
payload when neither feature is enabled, which removes stale commands. A
`guildCreate` event reconciles that guild immediately. Handlers are dispatched
by name in `discord/commands/index.ts`.

The retained `/track` and `/list` handlers validate boundary input with Zod,
delegate to the existing subscription domain services, and use `replyError` for
deferred error replies. They must not introduce a Discord-specific persistence
model or new management commands.

### Discord Error Handling

```typescript
// Always handle Discord API errors gracefully
try {
  await interaction.reply({ content: "Success!" });
} catch (error) {
  logger.error("Discord API error", { error });
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      content: "An error occurred",
      ephemeral: true,
    });
  } else {
    await interaction.reply({ content: "An error occurred", ephemeral: true });
  }
}
```

### Best Practices

- Validate all user input with Zod schemas
- Use ephemeral responses for error messages
- Use embeds for rich content presentation
- Handle message length limits appropriately
- Provide clear, user-friendly error messages
- Use structured logging with tslog (not console.log)

---

## League of Legends API Integration

- Use the native `RiotClient` in `#src/league/api/client/riot-client.ts` for Riot API calls
- Keep 429 handling process-wide: establish the shared `Retry-After` cooldown before releasing a request slot
- Cache API responses appropriately
- Handle API errors and rate limits gracefully

### External Data Type Naming Convention

Types representing external/unvalidated data (from Riot API, user input, etc.) must use the **`Raw*` prefix**:

```typescript
// Correct: Raw* prefix for external data types
type RawMatch = z.infer<typeof RawMatchSchema>;
type RawParticipant = z.infer<typeof RawParticipantSchema>;
type RawTimeline = z.infer<typeof RawTimelineSchema>;
type RawSummonerLeague = z.infer<typeof RawSummonerLeagueSchema>;

// Incorrect: *Dto suffix (legacy pattern - do not use)
type MatchDto = ...;        // Use RawMatch instead
type ParticipantDto = ...;  // Use RawParticipant instead
```

**File naming**: Schema files should use `raw-*.schema.ts` pattern:

- `raw-match.schema.ts`
- `raw-participant.schema.ts`
- `raw-timeline.schema.ts`

**Why this convention?**

- Clearly distinguishes between unvalidated external data (`Raw*`) and validated internal types
- Enforced by ESLint rule `custom-rules/no-dto-naming`
- Never import DTO types from external libraries - use `@scout-for-lol/data` schemas instead

---

## Report Generation

- Use the `@scout-for-lol/report` package for match reports
- Generate reports as images using `satori` (JSX to SVG) and `@resvg/resvg-js` (SVG to PNG)
- Optimize image generation performance
- Handle report generation errors gracefully
- Lazy load heavy dependencies
- Follow satori best practices (enforced by `custom-rules/satori-best-practices`)

### Ranked match renderer

`report/src/html/index.tsx` routes ranked solo/duo and ranked flex matches with
at least one tracked player through one of two deterministic designs:

- `ranked-banner`: 4760×1500
- `ranked-square`: 4760×4760

`pickRankedDesign` hashes stable match data so retries render the same design.
`MatchRenderOptions.designOverride` may force `banner` or `square` for integration
tests and manual debugging; it is ignored for non-ranked queues, which continue
to use the legacy 4760×3500 report.

`MatchRenderOptions.enableRankedDesigns` gates the two designs above and
defaults to `true`. The backend passes `false` outside local dev, so Beta and
production ranked matches render the legacy 4760×3500 report; only local dev
sees the new designs until the redesign is promoted.

Champion names stored on match data are Data Dragon asset keys. Keep those keys
for image lookup and pass every user-visible champion label through
`championNameToDisplayName`.

Before ranked rendering, `matchToSvg` preloads both teams' champion icons and
the selected hero's base splash art. Splash assets live under
`packages/data/src/data-dragon/assets/img/champion-splash/`; refresh them with
`bun run update-data-dragon` from `packages/data`. That command also reruns the
ranked banner and square snapshot suites, which rewrite their committed SVG/hash
artifacts. Backend startup validates splash art alongside champion portraits and
loading art, so a missing refresh fails deployment immediately.

## ScoutQL Report Queries — DuckDB Report Lake

Scheduled/user-authored ScoutQL reports execute as **compiled SQL on embedded
DuckDB** (`@duckdb/node-api`, lazy-loaded) over a local Parquet "report lake"
(`REPORT_LAKE_DIR`, prod `/data/report-lake`) — not over Postgres fact tables.

### Leaderboard mentions

`RENDER leaderboard` @mentions the first three player or player-group rows by
default. Set `WITH (mentions = <n>)` to choose a non-negative number of ranked
rows, `WITH (mentions = all)` to mention every eligible row, or
`WITH (mentions = 0)` to opt out. Rows grouped by non-player dimensions never
produce mentions, even when their labels match a player alias.

- Lake layout & compaction: `backend/src/report-lake/` (two-tier: 15-min
  staging fold + nightly full rebuild enumerating the canonical raw match,
  prematch, and prediction-observation JSON from **S3** (SeaweedFS); atomic
  `CURRENT`-pointer publish; the lake is disposable derived data). Manual run:
  `bun run compact:report-lake` (`--fold` for fold-only).
- Engine: `backend/src/reports/duckdb/` — the ScoutQL `ReportQueryPlan`
  compiles to parameterized SQL (never interpolate plan values); ordering,
  minGames, limits, and metric derivation stay in JS (`query-aggregates.ts`).
- **Adding a metric** = `ReportMetricSchema` enum + `REPORT_METRICS` registry
  entry (packages/data) + `METRIC_DISPLAY` (backend output.ts) + an aggregate
  column in `metrics-sql.ts`/`row-schema.ts`/`execute.ts` + `METRIC_VALUES`
  derivation. No Prisma migration, no backfill — the nightly rebuild picks up
  new lake columns from `report-lake/schema.ts`/`flatten.ts`.
- Ingest staging: `store.ts` appends flattened rows to
  `<lake>/matches-recent/` so games are queryable seconds after ingest.

### Query scope — guild vs global

Every lake query carries a `LakeQueryScope` (`reports/duckdb/scope.ts`), a
discriminated union of `{kind:"guild", serverId}` and `{kind:"global"}`. It is
deliberately not an optional `serverId`: a field that merely went missing would
let a scheduled report widen to the whole lake by accident, so global has to be
asked for at every call site.

**Global scope drops the accounts join entirely — that is a correctness
requirement, not a simplification.** Accounts rows are written per
`(server_id, account)`, so an accounts join with the `server_id` predicate
merely removed matches a PUUID once per server tracking it and silently doubles
every aggregate for exactly the players tracked in more than one server. With
no join there is nothing to fan out. This is pinned by
`reports/global-scope.integration.test.ts`; do not "optimize" it back into a
join.

Global scope is possible at all because match facts already hold every
participant: `flattenMatch` maps `info.participants` with no tracked-player
filter, and the rows carry `riot_id_game_name` / `riot_id_tagline`. So global
rows label themselves by Riot ID, group by `puuid`, and have no `player_id` or
`discord_id` — which is why `playerMentionIdentity` returns null for a row that
can address nobody.

Two sources **refuse** global scope rather than answering wrongly:

- `player_groups` / `player_pairs` — a teammate group means "these tracked
  accounts queued together", and global facts cannot distinguish a premade from
  random matchmaking, so every match would report a five-stack.
- the competition sources — they authorize against an owning server and have no
  meaning without one.

## Explore — conversational queries over the whole lake

`/app/explore` is a chat surface over global scope (`backend/src/explore/`,
`app/src/routes/explore.tsx`). Remaining product work is tracked in Linear as
SJ-147.

- **Access is stage-aware.** Beta uses `EXPLORE_GUILD_ALLOWLIST`: sign in and
  belong to one listed server; an empty list denies everyone. Production
  requires the signed-in user to share at least one guild with the production
  bot. The live bot guild cache is an authorization dependency, so an unready
  cache returns service unavailable rather than widening access. Every tRPC
  procedure re-checks access, and only eligible shared guild ids scope alias
  resolution.
- **Discord Explore is one-shot and uses the same persisted turn runner.**
  Production registers `/scout ask` globally for guild installs and guild
  contexts; beta registers it only in allowlisted guilds. Both re-check the
  invoking guild on command and publish-button execution, create a new
  user-owned conversation, and render the saved answer privately. Follow-ups
  happen only in `/app/explore`. The Discord user upsert may refresh
  username/avatar but must omit OAuth token fields. HTTP/SSE and Discord call
  `explore/run-turn.ts`, which owns quota charging, timeout, metrics, trace,
  partial salvage, agent execution, answer persistence, and generated titles.
- **Publishing is a frozen copy, not Explore sharing.** The versioned component
  id is `scout:1:publish:<conversationId>:<assistantMessageId>`. On click, reload
  the owner-scoped stored path and post only its question, answer, caveats, and
  existing visualization. Never rerun the agent or ScoutQL, mint a share token,
  expose the owner-only Explore URL, raw query, or trace, or allow generated
  mentions. A successful click disables the private button; a failed send
  leaves it retryable.
- **The agent must never state a statistic it did not read from a query result
  in that turn**, and must describe the corpus as the matches Scout ingested
  rather than the League ladder. Both live in `explore/prompt.ts`. A
  confidently wrong win rate is indistinguishable from a right one to a reader.
- **Shares are frozen against the lake, not against the owner.** An assistant
  turn stores its preview rows and visualization snapshot inline, so rendering
  a shared conversation needs no re-execution: an anonymous viewer costs no
  query and the link cannot change meaning as the lake grows. The owner can
  still move it, though — sharing again re-pins `sharedLeafId` to the branch
  they are reading now, under the same token, and revoking clears the token
  outright. So `GET /api/explore/shared/:token`, the one unauthenticated route,
  answers `Cache-Control: no-store`: a cached copy would keep serving a revoked
  conversation for the life of its TTL, and no delay is acceptable on
  withdrawing access.
- Scope-independent ScoutQL tools (read the language, validate, format) are
  shared with the report editor agent in `reports/ai/scoutql-tools.ts`.
  Executing a query is deliberately not shared — it is the one operation whose
  meaning depends on scope.
- **Prose streams from `object` chunks, never `text-delta`.** The agent runs
  with `structuredOutput`, so a text delta on `stream.stream` is a fragment of
  the raw JSON the model is emitting. The AI SDK's `partialOutputStream` is a
  separate stream that progressively parses that JSON and emits whole
  `Partial<OUTPUT>` snapshots; the prose the page renders comes from there.
  Both streams are views over one underlying run and must be drained
  concurrently to completion — abandoning either stalls the other once its
  buffer fills, and the turn hangs rather than fails; cancellation goes
  through the shared `AbortSignal`, not an early `break`. Two things this
  depends on break _silently_ — the page keeps working and simply stops
  streaming — so both are pinned by tests in `explore/stream.test.ts`:
  `answer` must stay the **first** field of `ExploreAnswerSchema` (a snapshot
  only carries keys the model has emitted so far), and the `partialOutputStream`
  loop must drain to completion. The agent also logs a warning if a turn
  finishes having streamed nothing while holding an answer.
- **Turns are a tree, not a list.** Editing a question or regenerating an
  answer appends a sibling under the same parent; nothing is ever deleted to
  make a version. `ExploreConversation.currentLeafId` says which path is on
  screen, and the pure walk/sibling logic lives in `explore/tree.ts`. A share
  captures `sharedLeafId`, so branching after sharing cannot change what a
  recipient sees.
- Regenerating forks the **answer** (a new assistant sibling under the same
  question), while editing forks the **question**. That is why the version
  arrows land where a reader expects them, and why messages carry `siblingIds`
  rather than only a count — a count cannot say which message "previous" is.
  Turn requests carry an `attach` point (`leaf`/`root`/`message`) rather than
  a nullable parent id: editing the _opening_ question forks a sibling
  **root**, and the root's parent is null, so a nullable field cannot say
  "fork at root" without colliding with "continue at the leaf".
- A stopped **or errored** turn keeps whatever prose it had already streamed
  as a caveated partial answer (`EXPLORE_STOPPED_CAVEAT` /
  `EXPLORE_INTERRUPTED_CAVEAT` in `@scout-for-lol/data`); only a turn that
  said nothing salvages nothing. The raw error behind an interrupted turn
  goes to logs and Sentry, not the transcript.
- The full ScoutQL registry is exposed as-is; there is no restricted dialect.
  Adding one properly needs a registry projection _plus_ a compile-time
  rejection path, because hiding an item from `get_report_language` alone would
  not stop the model emitting it.

---

## Bryan Bucks — friendly betting

A per-guild betting economy over the existing match lifecycle, in
`backend/src/betting/` (no barrel), gated by the `betting_enabled` flag. Design
notes: `packages/docs/archive/completed/2026-08-15_scout-bryan-bucks-betting.md`.

**Scope: one server, beta-only.** This is a private single-server
experiment, not a Scout-wide feature, and is not intended to become one.
`betting_enabled` is `false` by default and overridden `true` for exactly one
guild — the owner's — while the centralized production policy hard-disables
betting before the registry or Flipt is evaluated.

**`/bb` is registered per guild, not globally.** `baseCommandDefinitions` holds
the seven commands shared by both stages; production adds `/scout` globally,
while `guildScopedCommandGroups` supplies beta's `/bb`, `/scout`, and `/lobby`.
`discord/rest.ts` walks the connected client's complete guild cache and PUTs
each guild's merged payload to `applicationGuildCommands`. A globally
registered gated command would sit in every guild's picker and do nothing
there. A guild PUT **replaces** that guild's whole command list for the app, so
the groups must be merged before sending, and a guild where no group is enabled
must receive `[]` to clear stale commands. A newly joined guild is reconciled
from `guildCreate`; a guild the running bot cannot access is skipped only for
Discord's `MISSING_ACCESS`, while every other registration failure remains
fatal during startup.

The feature scope remains enforced by the flag and guild-scoped registration;
user-facing betting surfaces should not advertise the allowlist. `/bb prizes`
is the deliberate exception: it displays the existing 1:10 catalog and
in-person-with-Bryan footer as joke copy only. There is no command or accounting
path to redeem, donate, burn, or claim Bucks, and nothing transfers to real
goods. `/bb rules` says so explicitly, because for a while it claimed "no cash
value" while `/bb prizes` printed CAD figures to $1,000,000 with no
cross-reference.

**`/bb rules` is the only place a rule is stated.** Every other surface shows
numbers and points at it. Market messages, confirmations, `/bb balance`,
`/bb open`, and `/bb history` carry no fee, window, cap, or rounding
explanation. The one deliberate exception is the bet confirmation's "Only
matched BB are at risk", which changes what the number above it means.

Two things drove this. The old `HOUSE_CUT_TERMS` blurb was 344 characters
rendered on seven sites — 2,408 delivered characters, 17% of every character a
player could see, and four of those sites were not a betting decision. And
restating a rule means maintaining it twice: on 2026-08-19 the rules embed and
the market copy described the winner fee as two different amounts at the same
time. So every number in `/bb rules` is interpolated from the constant that
implements it, and `settlementHouseCut`/`cancellationHouseCut` derive from
`HOUSE_CUT_PERCENT` rather than open-coding it. Do not hand-type one.

`/bb balance`, `/bb history`, `/bb pass`, and `/bb peek` are private to the
caller. History uses caller-bound `bbnav:` component IDs and a frozen maximum
ledger ID so new entries cannot reshuffle pages. `/bb open` shows anonymous
side totals, never bettor identities or inferred odds. `/bb pass` quotes a
per-guild 24-hour entitlement and binds its confirmation to the caller and
guild with a ten-minute `bbpass:` component. `/bb peek game:<alias>` reveals
the frozen pregame estimate from that tracked player's team perspective,
starting exactly two minutes after game start and ending when the pool settles
or is voided. There is no on-demand leaderboard:
the complete non-house wallet list is posted Fridays at 5 PM
America/Los_Angeles in the shared Common Denominator channel. Both deployments
run the cron, but only the Discord application in the one enabled guild posts;
more than one enabled guild is a hard failure until an explicit channel mapping
exists.

Bucks exchange at 1:10 Bucks:CAD, in person only, from Bryan, who lives in rural
Canada. There is no monetary component and nothing transfers to real goods.

Each eligible Solo/Duo or Flex match may also publish one shared, fixed-odds
parlay after the normal prematch message. Its guild-local market closes five
minutes after publication, independently of the outcome market's ten-minute
window. Settlement is deterministic against the final `RawMatch`;
model-authored paths, code, SQL, expressions, and settlement prose are never
accepted. `bun run test:parlay:live` is the opt-in production-prompt check and
fails fast without `OPENROUTER_API_KEY`. Discord publication persists a
`publishing` market behind an inert preparation message; the prematch poll
retries activation after restarts, and the market becomes bettable only after
the guarded transition to `open`.

League Classic (`queueType: "classic"`, Riot queue 4310) is not a betting or
parlay queue because this integration has no supported post-game payload. A
tracked, linked player in a complete Classic 5v5 receives exactly one
`earn_game` participation point when the prematch spectator record is first
processed. The grant is idempotent per match and guild, and Classic ARAM
Mayhem (`"classic aram mayhem"`) receives neither the grant nor any market.

**Generation is two passes, and the model never sets the price.** GPT-5.6 Sol
first proposes 2–6 leg _shapes_ — subject, field, operator, no numbers. Only
then does the harness know which distributions to measure, so it fetches one
history snapshot and hands back, per leg, the player's own distribution plus the
lane and overall population, sliced by game duration and expressed as "the
threshold that lands N% of the time" already oriented to that leg's operator. A
second call fills in thresholds, targeting legs that land 40–70% individually.
Both calls share one 60-second deadline.

- **`thresholdsMatchProposal` is the load-bearing guard.** Pass two may change
  numbers and nothing else. A response that re-targets a field, flips an
  operator, or drops a leg is rejected, because it would be choosing a threshold
  against a distribution it was never shown — the exact failure the split
  removes.
- **The price is measured, not authored.** `parlay-pricing.ts` replays the
  finished leg set over the same snapshot. A parlay whose legs all name one
  subject is priced by direct replay, which carries the correlation between legs
  exactly; a multi-subject parlay is priced per subject and recombined over
  duration bucket and result, because the tracked five-stack has exactly one
  game together in the whole lake. `yesProbabilityBps` is absent from both model
  schemas.
- **No history, no parlay.** A leg the lake cannot answer returns undefined
  rather than a low number, and generation records `unpriceable` instead of
  publishing a guess. Which fields the lake can answer is
  `PARLAY_HISTORY_COLUMNS`, exhaustive over the catalog so adding a field is a
  compile error until someone decides whether it is groundable.
- **Pings are opponent-only.** Every ping type is excluded from subject
  conditions and available as an enemy-team total. Pings cost nothing to send,
  and subjects do bet on their own parlays mid-game, so a leg on a subject's own
  pings is settled by whoever holds the ticket. Nobody in the market can move
  the enemy team's count.
- **`PARLAY_EVALUATOR_VERSION` gates settlement.** `evaluateParlay` voids any
  stored definition whose recorded version differs, which refunds it. Bump it
  only when the meaning of an existing condition changes — never merely because
  a condition kind was added.
- **Adding a lake column requires the fingerprint guard.** Lake reads select an
  explicit column list across every parquet file, so a build whose files
  disagree fails to bind at all. `lakeSchemaFingerprint` is recorded in each
  build manifest and a mismatch makes the fold fall back to a full rebuild.

Outcome and parlay positions have no product stake maximum. A positive whole-BB
amount is limited only by the user's balance, parlay house liability, and the
existing Int32 persistence domain. Fixed-odds house liability is reserved at
placement and released or paid from the stored quote; every top-up reprices the
whole position with integer ceiling so button-sized increments cannot exploit
rounding. Every credit preserves enough Int32 headroom to return all pending
stakes and house reserves, including cancellation and void paths.

A new wallet's welcome grant is transferred from that house bankroll (paired
`seed` ledger rows), not minted. One-sided markets are matched by the same
synthetic per-guild house account with a bounded opening bankroll. The house is
a real `BucksAccount` and `BucksBet`, so its seed, stake, payout, and balance are
all ledger-audited; house accounts do not appear on the user leaderboard. At
outcome-market close, human offers match first; the house then fills up to 5 BB
total, capped by its available balance.
An underfunded house provides a smaller fill rather than voiding the market, and
every remaining unmatched human BB is refunded.

The house also receives two audited 20% cuts with distinct rounding rules: a
human winner pays 20% of matched profit rounded down, while a voluntarily
cancelled outcome offer pays 20% of submitted stake rounded to the nearest BB.
The house never charges itself. A fee-paying winner's payout is recorded as
principal and profit credits around the matching user debit and house credit;
the payout rows still sum to the stored gross payout in one transaction.
Remakes and expired or unsupported pools remain full refunds with no cut.

`/bb ask` is a one-shot analyst over the invoking guild's Bryan Bucks data. It
starts ephemeral and only the asker may copy the frozen bot-authored answer to
the channel; both bettor and asker mentions are rendered with mentions disabled.
The agent receives bounded, Zod-validated account, ledger, and betting
aggregation tools — never SQL or raw Prisma — and every statistic it states
must come from a tool result in that turn. The orchestrator rejects any answer
without at least one successful tool result, including a refusal, so prompt
instructions are not the provenance boundary. The account tool exposes only the
asker’s current balance; it must not recreate the on-demand leaderboard that
the fixed commands intentionally omit. Ledger queries require one or more
non-betting earning or adjustment kinds and cannot filter or group by bettor,
so their results cannot be combined with per-bettor betting P&L to reconstruct
private balances. Generic betting totals include both outcome and parlay
positions; player-subject attribution applies only to outcome positions. Keep
current balance, ledger delta, and settled-bet P&L distinct; refunds are
zero-net and excluded from win rate and ROI, pending positions have no P&L,
house rows are always excluded, and
"caused" is attribution to a player-framed position rather than literal
causation. Subject aggregation keys by the frozen PUUID while displaying its
newest recorded alias; historical aliases remain valid filters unless multiple
PUUIDs reused one, in which case the tool reports the ambiguity without
combining them. Counts and rows load from one database snapshot so settlement
cannot split the facts. The command is stateless, supplies the model an injected
current UTC timestamp for relative date filters, and uses `BB_ASK_MODEL`
(default `gpt-5.6-luna`) through the shared OpenRouter runtime and token budget.

- **The beta allowlist gates taking Bucks, never returning them.** Production
  hard-disables betting before local or Flipt evaluation. In beta,
  `betting_enabled` is checked in four places: command registration, pool
  creation, `placeBet`, and earning. Settlement and refund sweeps remain
  available for beta stakes already taken — a guild removed from the allowlist
  mid-match still has stakes that were
  already debited, and refusing to settle would strand real balances. So the
  flag stops new stake from being taken while in-flight pools still pay out or
  refund. `placeBet` carries the check rather than relying on the pool
  disappearing, because a revoked guild's pools outlive the revocation.
- **The first statement of every mutating transaction is a guarded conditional
  write.** Under PostgreSQL READ COMMITTED, a concurrent committed update
  forces the guard's WHERE to re-evaluate against the newest row version
  (EvalPlanQual), so the losing racer matches 0 rows; composite-PK/unique
  creates race-fail with P2002. This is the whole double-spend guard and the
  whole exactly-once story; a read-then-write would race.
- **`BucksAccount.balance` is stored, and `src/betting/ledger.ts` is the only
  module allowed to move it.** This departs from the `DmAuditLog` "derive,
  never store" rule deliberately: that rule guards a counter written after a
  _non-transactional_ side effect, whereas here the balance and its ledger row
  commit together. `reconcileBucksBalances` re-derives from the ledger and
  **reports** drift rather than correcting it — a mismatch is a bug in the
  chokepoint, and quietly patching it would hide that.
- **House-cut conservation includes both destinations.** Settlement asserts
  that net payouts plus house cuts equal all pool stakes. Cancellation asserts
  that the returned amount plus its house cut equals the cancelled position.
  The stored `BucksBet.payout` is net; settlement summaries retain gross
  payout, cut, net payout, and net winnings so Discord copy never has to
  reconstruct the arithmetic from ledger rows.
- **A peek pass spends aged balance, not pending stakes.** Remaining balance is
  reconstructed from the ledger as FIFO credit lots after every debit consumes
  the oldest lot. The price is
  `max(5, ceil(balance × min(25%, 10% + full weighted weeks)))`. Confirmation's
  first statement conditionally claims an inactive pass for 24 hours. Under
  that write lock it rebuilds the lots and price; an expired or changed quote
  rolls the claim back and returns a fresh quote. Matching `peek_pass` ledger
  rows debit the buyer and credit the guild house in the same transaction.
- **One pool per `(matchId, serverId)`; a bet stores a `predictedTeamId`.**
  Every 5v5 outcome is one binary event, so the prematch UI offers exactly two
  controls rather than repeating a pair for every tracked player. That
  not-per-tracked-player rule is the load-bearing half and must not be undone:
  it is why same-team teammates do not render as duplicate markets.
- **The UI names those two controls WIN and LOSE, relative to one anchor.**
  `bettingAnchor` picks the first tracked, non-scrubbed participant;
  `outcomeLabel` renders relative to it. Blue/Red returns only when
  `hasTrackedPlayersOnBothTeams` is true over the pool's frozen roster, which
  is the one case where WIN names no single outcome. Storage is untouched:
  `predictedTeamId` remains authoritative, `custom-id.ts` still encodes
  `"W"`/`"L"`, and `teamIdForSubjectOutcome`/`subjectWinsForTeam` are exact
  inverses, so the framing is lossless in both directions.
- **`/bb bet` takes four static choices — Win, Lose, Blue, Red.**
  Slash-command choices are frozen at registration and cannot vary per game, so
  Blue/Red are what make a per-game distinction expressible at all. `win`/`lose`
  on a mixed lobby resolves to `{ kind: "ambiguous" }` and is answered with an
  explanation, never guessed. Its tracked-player `game` option identifies the
  open pool and does not define the wagered outcome.
- **Settlement idempotency is the `poolState` column, not a marker table.**
  Unlike `MatchAiAttempt` — marked _before_ its call because OpenAI spend cannot
  join a transaction — every side effect here is local, so the transition
  commits with the payouts. `settleBettingForMatch` returns a summary only for
  pools _this_ call settled, which is what stops a duplicate announcement.
- **The settlement summary is one-shot, so its delivery gets its own error
  boundary.** Because a later pass returns nothing for an already-settled pool,
  anything that discards the summary discards it permanently. Two places this
  bites, both fixed and both easy to reintroduce: `announceSettlements` must not
  share a `try` with report generation in `processMatchAndUpdatePlayers`, and
  inside it each `messageRefs` entry is sent under its own `catch`, so one dead
  channel cannot swallow the healthy channels behind it. Post-match delivery
  returns the exact message ID per channel and now persists it on
  `ActiveGame.postmatchMessageIds`, so a restart between the report and the
  announcement no longer loses the reply target. The outcome is one bounded
  embed replying to that message; a missing report or unavailable reply falls
  back to the same one-message outcome standalone.
- **The outcome and the parlay result are ONE post-match embed.** Three
  details keep that safe, and each is a way to lose a settlement permanently:
  - The delivery nonce is keyed on `(matchId, channelId, kind)`. Without the
    `kind` discriminator a parlay-only carrier sent on a later tick collides
    with the outcome embed already delivered to that channel, and
    `enforceNonce` drops it silently.
  - `buildAnnouncements` makes a third pass for parlays no outcome
    announcement already covers. That is the "pool voided or settled on an
    earlier tick" case; `settleParlaysForMatch` returns nothing for it
    afterwards, so omitting the pass loses the result outright.
  - `fitSections` trims in priority order — earnings, then parlay legs, then
    parlay positions, then outcome rows — instead of throwing at Discord's
    6000-character ceiling, which merging made reachable. The description is
    never trimmed and an over-length description still throws.
    The cost, stated plainly: the parlay result now shares a channel's fate with
    the outcome, where they used to fail independently. That is the price of one
    extra post-match message, and it beats the old chunked send that could
    deliver chunk 1 and drop chunk 2.
- **Successful mutations refresh the prematch message instead of posting a
  receipt.** Button and `/bb` placement or cancellation confirmations remain
  ephemeral. After the ledger transaction commits, a queue serialized per market
  (`refresh-queue.ts`, keyed `pool:` or `parlay:`) re-reads current offers and
  best-effort edits every stored message. At close the same message becomes the
  receipt: it shows every human's offered, matched, and refunded BB, equal final
  matched totals, and any aggregate house fill without exposing the synthetic
  house account. Cancellations disappear from the public digest while remaining
  in the audit tables, and mention notifications are suppressed. `/bb history`
  remains the transaction-level audit trail, while public outcome copy retains
  the exact gross-cut-net arithmetic.
- **This applies to the parlay market too, and it is why there are no
  per-placement receipts.** The parlay market message is **recomputed from its
  stored definition** rather than snapshotted: legs, subjects, odds, and close
  time are all persisted, so unlike the outcome message there is no out-of-band
  content to preserve, no migration, and no legacy market that cannot be
  refreshed. The outcome message needs `prematchContentBase` precisely because
  its non-betting content lives nowhere in `BucksMatchPool`; legacy pools
  without that base remain settlement-safe and are not edited.
  A `publishing` market is never refreshed — the activation outbox owns that
  message and a refresh would race `activatePendingParlayMarkets` — and it
  provably holds no positions, since `placeParlayBet` and `cancelParlayBet`
  both require `marketState: "open"`. Parlay **cancellation** must refresh as
  well; the digest is live, so skipping it leaves a stale position on screen.
- **Settle and award outside the Discord path.** `settleAndAwardBucks` is called
  from `processMatchAndUpdatePlayers`, after the S3 ingest gate and outside
  `if (!silent)`. `processMatch` returns early with no subscribed channel and
  past `MAX_DISCORD_ALERT_AGE_MS`, and is skipped for silent backfill — but
  Bucks are owed regardless of whether a message is worth sending.
- **`voidStaleBettingPools` is not optional.** Without it, a match that never
  produces a post-match result silently destroys every stake in its pool. Six
  hours is chosen against the `ActiveGame` TTL and `MAX_DISCORD_ALERT_AGE_MS`,
  both three.
- **V2 is one frozen, symmetric Blue-team estimate per match.**
  Prematch fetches one point-in-time rank snapshot for all ten players and
  shares it with prediction and loading-screen presentation; prediction never
  calls Riot again and presentation failures cannot remove an eligible
  observation. An ineligible game with no delivery destination exits before
  rank acquisition. One DuckDB query reads each
  identifiable player's last 30 strictly earlier same-queue matches. The
  estimator compares team rank, Beta-shrunk season record, recent form, lane
  form, and champion form with no intercept; missing history is neutral 50%,
  and swapping the teams produces the complementary probability. The canonical
  v2 JSON stores Blue probability, coverage, data quality, and at most two
  drivers. Legacy unversioned pool predictions remain parseable for old
  settlement rows.
- **Prediction capture is match-scoped, not guild-scoped.** Every detected
  Bryan-Bucks-eligible standard game writes one versioned feature/output
  observation to S3 and the report lake, even when presentation construction
  fails or no destination guild has betting enabled. The best-effort write is
  started after the estimate freezes but is not awaited by pool creation or
  Discord delivery: losing an evaluation observation cannot suppress the
  notification or the pool's in-memory estimate. Outcomes join later by
  `match_id`; run
  `bun run evaluate-predictions` in the backend to report Brier score, log loss,
  ten-bin calibration error, and directional accuracy overall and by queue and
  quality, with a computed 50/50 reference.
- **MVP is role-aware and lives in the backend**, because `toMatch()` drops
  objective damage, heals/shields on teammates, CC, self-mitigated damage, and
  `teamPosition`. Scores normalize as per-team share, so they need no
  recalibration across game length or patch. `findMvpIndex` in the report
  package answers a different question (splash-art hero, tracked players only)
  and is left alone.
- **A custom ID carries a key, never state.** Buttons encode a roster _index_
  into the pool's frozen snapshot, so they survive a restart and stay inside
  Discord's 100-character cap. That participant is a display-only game anchor:
  the visible Blue/Red choice is translated into the existing WIN/LOSE bit
  relative to the anchor, while `predictedTeamId` remains the authoritative
  wager. Parsing never throws — it is an unauthenticated surface, and every
  field is re-validated against server state before a Buck moves. But **not
  throwing is not the same as not answering**: `isBucksCustomId` is only a
  prefix check, so once `routeButton` claims a `bb:` interaction it owes Discord
  an acknowledgement within seconds or the clicker is shown "This interaction
  failed". An ID that is claimed by namespace and then fails to parse is closed
  out with a silent `deferUpdate()` and counted as `bb/malformed`, never as
  `bb/success`.
- **Pregame estimates are never public.** Prematch messages contain only market
  controls. A pass holder sees the estimate ephemerally after the two-minute
  delay. Settlement may reveal it after the result, except that
  calls displaying as 45–55% remain suppressed. `predictionVerdict` also
  returns nothing for those near-even rows because scoring them would claim a
  direction the stored estimate did not take.
- **Every state transition is counted and logged, post-commit only.**
  `src/metrics/betting.ts` holds the counters and gauges;
  `src/betting/transition-log.ts` holds `logBucksTransition`. Both fire
  **after** the owning `$transaction` resolves — `settleOnePool`,
  `matchPoolAtClose`, `cancelBet`, `placeBet`, and `purchasePeekPass` all
  return from inside their transaction, so their observations live at the
  call site or in a thin wrapper. A metric emitted inside a transaction that
  then rolls back is a lie that survives forever. `logBucksTransition` never
  throws; observability must not fail a money movement.
  Metric labels are closed unions and carry **no IDs** — Bryan Bucks runs in
  one guild, so a `server_id` label costs a dimension and says nothing.
- **Retention: logs are 90 days, counters are not history.** Promtail ships
  stdout to Loki with a 90-day retention, and Prometheus counters reset on
  restart. The permanent record is SQLite — `BucksLedgerEntry` plus the pool
  and bet timestamp columns (`createdAt`, `matchedAt`, `settledAt`,
  `cancelledAt`, `matchingJson`). Do not treat logs or counters as the audit
  trail.
- **All Bucks sends and edits go through `observeBucksDelivery`**, which
  classifies the failure, counts it, and **rethrows unchanged** — every caller
  owns its own catch, and `announce.ts`'s per-channel isolation depends on
  seeing the error. The three refresh paths that used to return silently
  (`pool === null`, `prematchContentBase === null`, `refs.length === 0`) now
  call `recordBucksDeliverySkip`. They are not equally alarming:
  `skipped_no_base` is expected forever for pre-column pools and must never be
  alerted on, while `skipped_no_refs` is the leading indicator of "settlement
  had nowhere to announce".

## Tournament-code custom games — `/lobby`

Riot removed custom games from the public API for privacy reasons: Spectator
sees them only unreliably, and Match-V5 does not carry them at all. The one
sanctioned exception is the **Tournament API** — a game created from a
_tournament code_ IS recorded in Match-V5 with `info.tournamentCode`
populated. `/lobby` mints such a code so a custom game gets the whole Scout
feature set. It is beta-only via `tournament_lobbies_enabled`, with the
centralized production policy winning before local or Flipt overrides.

Code lives in `backend/src/league/tournament/` and
`backend/src/league/api/tournament/`.

- **`twisted` does not implement the tournament API**, so the client is
  hand-rolled — but every call still routes through `riot-call.ts`, which is
  what buys it the same metrics, health, timeout, drift-tolerant parsing, and
  outage policy as every twisted-backed call. `TournamentHttpError` carries a
  numeric `status` specifically so `extractHttpStatus` reads it unchanged.
- **The host is fixed.** Every tournament endpoint is `x-route-enum: regional`
  with `x-platforms-available: ["americas"]`, so calls always go to
  `americas.api.riotgames.com` regardless of shard; the tournament region
  (NA/EUW) travels in the body. `TournamentRegistration.tournamentRegion` is
  named that way, not `region`, because `brand-prisma-types` maps any field
  called `region` to Scout's own `Region` enum.
- **`tournamentApiMode` selects stub or live.** Stub codes create no real
  lobby, its events are canned, and `games/by-code` does not exist there —
  `supportsGamesByCode(mode)` branches on config rather than catching a 404,
  because a 404 is also how Riot reports a code it never saw. Flipping the mode
  back to `"stub"` is the kill switch; it needs no deploy.
- **The no-duplicate-notification guarantee is `lifecycle.ts`.**
  `lobby-events/by-code` replays its entire event list every call, so the dedup
  mechanism is a monotonic state recompute, not event bookkeeping: a state is
  only ever _entered_ once, and entering `champ_select` is what sends the card.
  `processedEventCount` and `lastEventTimestamp` are observability only —
  correctness must never depend on them, because multiple events can share a
  millisecond and `timestamp` arrives as a string.
- **Teams come from the command, not from Riot.** Lobby events carry a PUUID
  per join and never a side, and spectator is unreliable for customs, so
  `/lobby create` takes `blue:` and `red:` lists. That is what makes the
  prematch card and the Bryan Bucks market possible at all. `teamSize` is
  derived as `max(blue, red)`; two lists and a size option could disagree.
- **Every participant must be tracked in the calling guild.** Not gatekeeping:
  the per-player match-history cursor is the only ingest path, so an untracked
  lobby would produce a code, a game, and no report.
- **The poller links, it never ingests.** It writes the `ActiveGame` row so the
  post-match report replies to the card, through the unchanged
  `getPrematchMessageIdsForMatchIdOrEmpty` path. The match-history cursor still
  owns ingest, and its S3 write still gates the cursor advance.
- **Never fabricate a `RawCurrentGameInfo`** from lobby events. That value is
  the canonical S3 match record the report lake rebuilds from; invented
  champion IDs would permanently corrupt ScoutQL, Explore, and AI review.
- **Bryan Bucks needs a Scout-minted code, not `queueType === "custom"`.**
  `"custom"` is deliberately absent from `BUCKS_EARNING_QUEUES`: an arbitrary
  custom is trivially farmable and `earn_game` moves real balance. 5v5 only —
  the MVP formula normalizes against a hardcoded five-man baseline.
- **The provider callback acknowledges and discards.** tournament-v5 has no
  shared secret, so the URL is the only credential; a mutating handler would be
  an unauthenticated injection path into the S3 match store.

Operator setup, once per (mode, region):

```bash
cd packages/scout-for-lol/packages/backend
op run --env-file=../../dev-web.env.tpl -- \
  bun run scripts/register-tournament-provider.ts --mode=stub --region=AMERICA_NORTH
```

`scripts/tournament-stub-smoke.ts` validates routing, the auth header, and
every response schema against real Riot today. It cannot validate the feature:
see the "cannot be validated" list in the PR.

## Database (Prisma)

- **PostgreSQL 16** - `datasource provider = "postgresql"`, connected through
  Prisma's `@prisma/adapter-pg`. Locally, `ensureDevPostgres`
  (`src/testing/postgres-server.ts`) runs the shared machine-wide server; in
  beta/prod each namespace runs a Zalando postgres-operator cluster
  (`scout-<stage>-postgresql`) and the deployment composes `DATABASE_URL` from
  the operator secret.
- **Schema-first approach** - Define models in `schema.prisma`
- **Migration strategy** - Use `prisma migrate` for production, `db:push` for
  development. The 67 SQLite-era migrations were squashed into one baseline
  migration (`prisma/migrations/20260820000000_postgresql_baseline/`).
- **Legacy SQLite import** - the entrypoint chain is
  `prisma migrate deploy && bun run scripts/import-legacy-sqlite.ts && bun run scripts/audit-report-windows.ts --database "$DATABASE_URL" --fix && bun run src/index.ts`.
  The boot-time importer reads the legacy `/data/db.sqlite` (still on the 24Gi
  PVC as `LEGACY_SQLITE_PATH`) exactly once, tracked by the
  `_legacy_sqlite_import` marker table with a fail-closed decision table;
  rollback = repin the previous image, which reads the untouched file.
- **Type safety** - Generated client provides full type safety
- **Connection management** - Proper connection pooling and cleanup
- Validate database inputs with Zod schemas
- Use transactions for multi-step operations
- Handle connection errors and timeouts
- **Integration tests** - Must disconnect Prisma clients (enforced by `custom-rules/prisma-client-disconnect`)

---

## Environment & Configuration

- Use `env-var` for type-safe environment variables
- Validate all configuration with Zod schemas
- Keep sensitive data in secret stores (1Password / k8s secrets), never in the repo
- Separate development and production configurations

---

## Code Organization

- **Functional approach** - Use `remeda` for data transformations
- **Modular design** - Each package has clear responsibilities
- **Proper dependency injection** - Avoid global state
- **Consistent naming** - Use TypeScript naming conventions
- **No barrel re-exports** - Enforced by `custom-rules/no-re-exports`
- **No parent imports** - Enforced by `custom-rules/no-parent-imports`
- **Prefer Bun APIs** - Use Bun.file(), Bun.write(), Bun.spawn() instead of Node.js fs/child_process

---

## Testing Strategy

- **Unit tests** - Test individual functions and components
- **Integration tests** - Test package interactions
- **Snapshot testing** - For report generation output
- **Type testing** - Ensure type safety in complex scenarios
- **Run tests**: `bun run test` in any package or root

### Local testing without Discord login or a real Discord backing

There is **no blanket auth bypass** (no `SKIP_AUTH`/`DEV_AUTH` flag): the web
mutations are gated by a signed session cookie + CSRF + `assertGuildAdmin`
(which calls Discord). The one narrow, dev-only exception is `DEV_USER_GUILDS`,
documented under **Web UI** above — it substitutes for the Discord _membership
lookup_ only, and never for the session, CSRF, or the allowlist itself.

To exercise the web/tRPC surface offline, use one of these — both
run fully in-process against an isolated Postgres database cloned from the
hash-scoped template on the shared local dev server (`createdb -T`, ~100ms; the
bun test preload rebuilds the template when the hash of migrations + SEASONS +
harness changes — `src/testing/test-template.ts`), no OAuth,
no Discord API:

- **Domain layer (simplest)** — call the exported functions directly (e.g.
  `setSubscriptionFilters` / `setChannelFilters` from
  `src/lib/subscription/filters.ts`) with a test client from
  `createTestDatabase(...)`. No auth surface at all. See
  `src/database/subscriptions.integration.test.ts`.

- **Full tRPC router** — `createOfflineTrpcHarness(...)` from
  `src/testing/test-trpc-caller.ts`. It stubs the Discord guild guard and points
  the router's Prisma singleton at an isolated migrated DB, then hands you an
  authenticated (and an anonymous) `appRouter.createCaller(...)`. This exercises
  the real procedures — input validation, audit-row writes, domain wiring — the
  exact surface OAuth gates. Example: `src/trpc/router/subscription-filters.router.test.ts`.

  ```ts
  const trpc = await createOfflineTrpcHarness("my-feature-test");
  const res = await trpc
    .authedCaller()
    .subscription.setFilters({ guildId, channelId, alias, filters });
  // assert against trpc.prisma …; trpc.anonCaller() for unauthenticated-rejection tests
  // remember: await trpc.prisma.$disconnect() in afterAll
  ```

  Constraints (documented in the harness): call it at the TOP of the test file
  before anything imports `appRouter`, and take `appRouter` from the returned
  object. `assertGuildAdmin` / `assertChannelInGuild` are stubbed, so real Discord
  admin/membership is out of scope for these tests.

For the running app end-to-end, `bun run dev:web` uses the explicit local
session bootstrap above when OAuth click-through is unnecessary. Use real
Discord OAuth only when testing the OAuth flow itself; the BETA app must still
contain the localhost callback URI and the test guild must contain the BETA bot.

---

## Performance Considerations

- **Lazy loading** - Load heavy dependencies only when needed (image generation, API clients)
- **Connection pooling** - For database connections
- **Caching** - Cache expensive operations appropriately (API responses)
- **Memory management** - Clean up resources and connections
- **Bundle optimization** - Use proper bundling strategies

---

## Queue availability windows (committed, bot-refreshed)

Limited-time queue availability lives in
`packages/data/src/model/queue-windows.json` (validated by
`queue-windows.schema.ts`; loaded by `queue-availability.ts` — end dates are
inclusive through the whole UTC day). The `scout-queue-windows-daily` Temporal
schedule (06:45 PT, `packages/temporal/src/activities/scout-queue-windows.ts`)
scans the `scout-prod` match lake for a 28-day lookback and proposes edits via
the pure drift engine (`queue-window-drift.ts`): window opens/reopens auto-merge;
window closes open a plain PR for human confirmation against patch notes;
warnings-only runs (unknown queue ids, sparse modes) send an email.

A close is gated on the window being at least `CLOSE_MIN_WINDOW_AGE_DAYS` (21)
old, and its volume baseline is only counted from observations still inside the
lookback — so the lookback is what decides how many consecutive daily runs
re-propose the same close. Because the job closes its proposal PR as soon as a
run produces no drift, a lookback equal to the minimum age would give a human
exactly one day to review before the proposal vanished for good. The engine
rejects any `lookbackDays` below `MIN_DRIFT_LOOKBACK_DAYS`; keep the schedule's
`LOOKBACK_DAYS` and the CLI's default in step.

Local dry-run (no writes):

```bash
cd packages/backend
AWS_PROFILE=seaweedfs bun run update-queue-windows -- --bucket scout-prod --lookback-days 28 --dry-run
```

New modes with unmapped queue ids surface as "new mode?" warnings — add the
QueueType enum value + `parseQueueType` mapping by hand, then the watcher
maintains its windows.

## Marketing showcase assets (committed, bot-refreshed)

The marketing homepage's screenshots live as committed generator output:
`packages/frontend/public/generated/scout-showcase/*.png` + the asset index
`packages/frontend/src/data/generated/scout-showcase-assets.json`, generated
from the curated manifest `showcase/marketing-showcase.manifest.json` against
real objects in the `scout-prod` bucket. Never hand-edit the outputs.

- **Weekly refresh**: the `scout-showcase-refresh-weekly` Temporal schedule
  (Mon 10:00 PT, `packages/temporal/src/activities/scout-showcase-refresh.ts`)
  regenerates and opens a PR on drift (review the image diffs visually);
  `generatedAt`-only churn is suppressed.
- **GC protection**: `scout-image-gc-daily` exempts every key the manifest
  references (it fetches the manifest from `main` before pruning), so curated
  sources outlive the 30-day image window. Consequence: manifest edits on a
  branch don't protect new keys until merged. It prunes **both** `scout-prod`
  and `scout-beta`, so the exemption list is grouped by the bucket each entry
  actually reads (`bucket` if pinned, else `scout-prod`) — a flat list applied
  to prod alone would leave a beta-pinned source unprotected. It only prunes
  `.png`/`.svg` under `games/` and `prematch/`, so `leaderboards/**` snapshots
  are never collected and need no exemption.
- **Per-entry `bucket` override**: an entry may pin its own source bucket.
  Both buckets sit behind one SeaweedFS endpoint, so only the bucket name
  swaps, not the client. The competition graph uses it to source `scout-beta`,
  whose competitions have ~28 players against prod's richest at 3. `discover`
  treats any entry carrying an explicit `bucket` as pinned and returns it
  untouched, for every entry kind — without that it would rebuild the entry
  from the run's `--bucket` and silently revert the pin. The pin has to carry
  the whole entry, not just the `bucket` field: a freshly discovered key came
  from the run bucket and generally does not exist in the pinned one.
  Untouchable is not unconditional, though: `discover` verifies every pinned
  entry's source keys in its own bucket up front, and a missing one is a hard
  error rather than a silent rebuild — see the NoSuchKey recovery below.
- **Player names are pseudonymous in the charts.** `showcase/anonymize.ts` maps
  a player to a curated handle by hashing `${stableKey}|${realName}`, where the
  stable key is a non-display identity (`playerId` / `puuid`). The weekly job
  commits these PNGs, so a pseudonym that moved between runs would open a junk
  PR every Monday. What is guaranteed is **reproducibility, not a fixed
  key→handle mapping**: a handle depends on the whole call sequence, because
  the seed includes the display name and collisions probe past the handles
  already taken. Re-running the same manifest over the same rosters reproduces
  the same PNGs; a re-curation, a rename, or a change to how many players an
  entry renders can move handles, including for players who did not change.
  Read that as a one-off image diff to eyeball, not drift. Assign handles to the
  players you will actually render (slice, then anonymize): the report graph
  aggregates ~120 participants but draws ten, and anonymizing before the slice
  exhausts the pool into a numbered fallback. **Known gap:** `s3-image` and
  `discord-screenshot` entries are byte copies of prod-rendered PNGs, so the
  names in those are baked into the pixels and are still real.
- **Discovery finds rare modes.** `wantedCombos` is derived from the full
  `variantSpecs()` set, split by state, and is the scan's loop terminator —
  it was once hard-coded to `{solo:1, flex:1}`, which stopped the walk after a
  few dozen objects and left every rarer variant carried forward from `--prev`
  indefinitely. Combos verified absent (flex 4/5) are excluded so the loop can
  still terminate early. A mode with no post-match payload (League Classic —
  Riot exposes none) declares `states: ["prematch"]` rather than emitting a
  variant that can only ever resolve to a miss.
- **Re-curation runbook** (after a renderer redesign, or if the weekly job
  fails NoSuchKey): from `packages/backend`,
  `AWS_PROFILE=seaweedfs bun run scripts/discover-marketing-showcase.ts
--bucket scout-prod --out ../../showcase/marketing-showcase.manifest.json
--prev ../../showcase/marketing-showcase.manifest.json`, then run
  `scripts/generate-marketing-showcase.ts` with the standard flags (see the
  Temporal activity for the exact invocation) and commit manifest + outputs.
  Both scripts validate their flag names against a closed `z.enum`, so there is
  **no** endpoint flag and an unknown `--…` fails CLI parsing rather than being
  ignored. `createS3Client()` sets no endpoint, region, or credentials, so all
  three come from standard AWS resolution — that is what `AWS_PROFILE=seaweedfs`
  (its `endpoint_url` in `~/.aws/config`) is doing above; point the run
  somewhere else by selecting a different profile. Expect roughly 30s: the
  post-match scan runs to its full head budget whenever a wanted combo is never
  satisfied, and today `aram mayhem` post-match is that combo — the manifest has
  carried it as unsupported since the generator landed. Unlike League Classic,
  whose absence was verified against prod (zero `classic` reports across 1,078
  post-match objects), ARAM Mayhem has no such survey, so it is deliberately
  **not** declared `states: ["prematch"]` — the scan keeps looking. Run that
  survey before narrowing the spec.
- **Recovering a dead pinned source.** `discover` verifies each pinned entry's
  keys before scanning, so a deleted source stops the run in seconds with the
  entry id, the bucket, and the missing key — instead of letting `generate`
  fail on NoSuchKey again. Repointing a hand-curated source is a decision, so
  the fix is explicit, not inferred. Either re-pin the entry by hand to a live
  object in the same bucket, or discard the pin with
  `--refresh-pinned <entry-id>` (comma-separate ids, or `all`) to rebuild it
  from the run bucket. Unknown ids fail rather than silently refreshing
  nothing. Prefer re-pinning for the competition graph: refreshing it moves the
  chart back to prod's three-player leaderboard, which renders fine and is not
  what anyone chose.
- **Adding or renaming a variant** touches four places: the spec in
  `discover-marketing-showcase.ts`, `REQUIRED_SHOWCASE_VARIANT_IDS` in
  `src/showcase/manifest.ts`, `showcasePreviews` in the frontend's
  `index.astro` (`requireShowcaseAsset` **throws** on a missing id, so a stale
  reference breaks the marketing build), and the committed PNGs. The
  `discord-screenshot` templates in `src/showcase/discord-templates.ts` are an
  independent `(queue, playerCount)` lookup — leaving one at a player count the
  bucket no longer produces pins it to a stale object while everything else
  refreshes.

## Pre-commit gates

The lefthook `pre-commit` hook checks staged files only (Gitleaks, Prettier,
line endings, merge markers, environment-variable names, file size, and the
staged-diff automation rules). There is no `pre-push` hook; the exhaustive
`bun run verify` graph runs in the Buildkite pipeline. Running checks yourself
before pushing catches failures earlier:

- Prettier formatting on touched files (also auto-fixed by the pre-commit hook)
- Markdownlint on `.md` files
- Per-package: `bunx turbo run typecheck test lint --filter=<pkg>`
- Rust formatting and Clippy for desktop/src-tauri

## Non-core message budget — a promise to users, not a guideline

Scout sends at most **3** onboarding/feedback messages per server, ever, and
says so in the body of every one of them ("Message 2 of 3 for <server>").
That text is generated from the same counter that gates sending, so it cannot
drift from reality. Treat this as an invariant:

- **Route every non-core message through `sendDM` with a `budget`.** Enforcement
  lives in `discord/utils/dm.ts`, the audit chokepoint, precisely so no caller
  can forget the check. Do not add a second send path.
- **`DmAuditLog` is the ledger.** Budget spend, ladder rung, and "have we asked
  for feedback?" are derived from audit rows created after `installedAt`, never
  stored as counters. A counter updated after a send goes stale if that write
  fails, and the "Message N of 3" text then contradicts the gate that produced
  it. Only delivered rows count, so a bounced DM charges nothing.
- **Core product output is not budgeted.** Match reports, competition invites,
  permission errors, and prune notices are what the user asked for. Everything
  else is non-core and `sendDM` refuses to send it without a budget — that is
  what stops a fourth message slipping out on a path nobody thought about.
- **A new channel shares the budget.** If email or any other channel is added,
  it consumes the same allowance (`emailNudgeSentAt` exists for this) — a fourth
  message arriving by another route would make the printed count a lie.
- **Rung is recorded, not counted.** `DmAuditLog.ladderStage` stores which rung
  a message was. The Nth delivery is not rung N: a bounced day-3 DM followed by
  a delivered day-14 DM is rung 2, and legacy history contains lone
  `outreach_30d` rows. Reconstructing from position repeats rungs and
  mis-attributes conversions.
- **Ladder position comes from the calendar, budget from deliveries.** Deriving
  the rung from spend strands any guild that is legitimately skipped — a
  configured guild delivers nothing at rung 1, so a spend-derived rung never
  advances and the rung-2 feedback ask becomes unreachable. A skip records
  nothing.
- **Never message a guild Scout is not in.** `GuildInstall` rows outlive a
  removal by design, and rows predating `removedAt` carry no stamp, so the
  ladder checks live guild membership before sending. `cleanupRemovedGuild`
  stamps `removedAt` for every confirmed-removal path.
- **Re-install resets by moving `installedAt`.** Because state is scoped to rows
  after that timestamp, there is no list of counters to remember to clear —
  which is exactly what previously left a re-installed server exhausted.

Validate ladder changes with `DATABASE_URL=postgres://scout@127.0.0.1:5471/scout_beta_snapshot \
  bun run scripts/outreach-dry-run.ts` against a restored beta copy before the
first real fire — the failure mode here is messaging real people. Create that
copy with the `pg_dump`/`createdb`/`pg_restore` sequence above; never point the
dry run at production itself.

## Server-side product analytics invariants

- PostHog guild lifecycle identity is `GuildInstall.analyticsInstallationId`.
  Preserve it across reconnect-style `guildCreate` events; rotate it only after
  a confirmed removal and reinstall. It remains the event `distinctId`.
- Every event also carries `guild_id`, the Discord guild id, sourced from
  `AnalyticsInstallation.serverId`. The two identifiers answer different
  questions and must not be collapsed into one: `analyticsInstallationId`
  rotates on reinstall so install-level funnels restart cleanly, while
  `guild_id` is stable for the guild's whole history. The browser SPA registers
  the same `guild_id` as a super property, which is what lets a web session be
  joined to a guild installation. Register it only once `usePermissions`
  confirms the viewer may access that guild — before that it is an unvalidated
  route parameter, and a deep link to `/g/<anything>` would stamp an
  attacker-supplied value onto every event — and register it for the session,
  not durably: the workspace clears it from a React effect cleanup that a hard
  navigation or a closed tab never runs.
- Keep the event/property registry closed and bounded. Beyond `guild_id`, never
  send Discord user or channel IDs, guild names, Riot IDs, command options,
  message content, URLs, or error messages. **The distinct id counts.** The
  browser identifies with `User.analyticsUserId`, an opaque app-owned UUID —
  never `discordId`. A distinct id is the durable join key for a person's
  events and recordings, so a snowflake there makes all of it addressable by
  Discord account, which is exactly what this rule exists to prevent.
- The identity sync lives in `RootLayout` (`useAnalyticsIdentity`), which every
  route renders through — **not** in `RequireSession`. `/login` is mounted
  outside that guard, so the guard only ever runs for people who still have a
  session: exactly the people who do not need resetting. Putting it there left
  the login page, the one screen a signed-out person actually sees, attributed
  to the previous account. `router-analytics-identity.test.ts` pins this.
- **PostHog's persisted state is the only source of truth for who is
  identified.** `analytics.ts` deliberately keeps no module-level "current user"
  variable, and `identifyUser` decides from `_isIdentified()` +
  `get_distinct_id()`. Module state is empty on every fresh page load while
  PostHog still holds the previous person, and a full-page navigation is the
  normal case here — the OAuth round trip, a hard reload, a restored tab. Every
  identity bug this file has had was those two disagreeing: a stale identity
  surviving an expired cookie, and an account switch aliasing two people because
  `identify` ran without a reset. Do not reintroduce a cache of the current user.
- **Nothing is captured until the gate opens.** `initAnalytics` calls
  `opt_out_capturing()` explicitly on **every** initialisation, and `RootLayout`
  calls `startAnalyticsCapture()` only once the session has answered and the
  route's own context is attached. The explicit close is load-bearing:
  `opt_out_capturing_by_default` is consulted only when the browser has no
  stored consent decision, so once a visit opts in, every later cold load would
  honour that stored opt-in and capture immediately — leaving the gate inert for
  exactly the returning visitors it protects. Keep
  `opt_out_persistence_by_default` at `false`, or opting out takes the distinct
  id with it.
  The gate exists because autocapture begins the instant PostHog initialises:
  ordering a `capture()` call later cannot hold it back, so a cold load with a
  stale persisted identity recorded autocapture — and the entry pageview —
  against the previous account, which PostHog cannot reattribute afterwards.
  The trade is deliberate: pre-gate events are dropped rather than
  mis-attributed. A route that carries its own analytics property
  must be listed in `analyticsContextRoute` and must call `resolveGuildContext`
  (or an equivalent) when its answer settles, including when access is denied —
  unresolved is the default, so forgetting withholds the pageview instead of
  leaking an unattributed one.
- **Every `reset()` must be followed by a re-opt-in, and only
  `resetPersistedIdentity` may call it.** `posthog.reset()` clears consent along
  with the person, returning the instance to its configured default — which is
  opted out. A reset after the gate opened therefore kills capture permanently
  and silently for that browser. This is a worse failure than any bug the gate
  fixes, and it is invisible in review, so the re-opt-in lives in one helper
  rather than at call sites.
- **Only a successful session response is an answer.** `syncAnalyticsIdentity`
  acts on `isSuccess`, never on `!isLoading`. A failed query also stops loading,
  and the session query runs with retries disabled, so reading failure as
  "signed out" resets a live identity and strands the rest of the visit as
  anonymous while the cookie is still valid. Loading and failure are both
  "unknown", and unknown means do nothing.
- Scout's replay masks every text node (`maskTextSelector: "*"`), not just form
  values. `person_profiles: "always"` associates each recording with an
  identified person, and the workspace renders guild names, Discord display
  names, Riot accounts, player aliases, and channel names as ordinary text.
  Do not narrow this to a per-component allowlist: it fails open the first time
  a new screen renders a name, and the failure is silent.
- **Replay masking and autocapture masking are different switches**, and a site
  that renders an identity needs both. `maskTextSelector` governs recordings
  only; autocapture independently collects element `textContent` and attributes,
  so a masked recording can sit beside a click event carrying the alias as
  `$el_text` and the guild path in `href` — attached to a durable person profile.
  Scout, Mario Kart, and Pokémon therefore all set `mask_all_text` and
  `mask_all_element_attributes`; `scripts/check-analytics-sites.ts` enforces it
  for every tracker marked `masksAllText`.
- `guild_id` on browser events deliberately joins a website session to a bot
  installation, and the published privacy policy
  (`packages/frontend/src/pages/privacy.mdx`) discloses that join. If the join
  ever changes shape — new identifiers, a wider link, or removing it — update
  that policy in the same change. It is a user-facing legal statement, not a
  code comment.
- Person profiles are ON. Do not reintroduce `$process_person_profile: false` or
  `$geoip_disable` — install-level retention depends on them being off.
- GeoIP is ON for browser events and OFF for these server events
  (`disableGeoip: true`). These captures come from Discord gateway events and
  background database/delivery workflows with no end-user `$ip`, so PostHog
  would resolve the backend's own egress location — one datacenter, identical on
  every event — and present it as the guild's. Do not turn it on for a country
  breakdown: the breakdown it produces is wrong, not merely coarse.
- PostHog _group_ analytics is a paid add-on and is deliberately NOT used; guild
  analysis goes through the `guild_id` property.
- Capture first subscription only after the web or Discord transaction commits,
  and claim `firstSubscriptionAt` atomically (like `firstCoreOutputAt` below)
  rather than deriving "first" from the current subscription count: a guild
  that deletes its last subscription and later adds another sees that count
  hit zero again, and a count-derived check would double-fire the milestone.
- Capture core output only after successful logical Discord delivery. Aggregate
  match channels by guild; require every report/pairing chunk; exclude previews,
  setup/welcome, ephemeral replies, DMs, recovery, debug, cancellation, and
  failed sends.
- Claim `firstCoreOutputAt` atomically. Migrated lifecycle rows remain
  `analyticsLifecycleTracked: false`, so they produce recurring output/removal
  events but no synthetic historical first-value events.
- Claim removal with the first `removedAt: null → timestamp` transition and
  classify activation before cleanup deletes subscriptions, reports, or
  competitions. Both Discord deletion and reconciliation use the same path.
- Analytics is best effort. SDK and capture errors are logged and counted but
  must not fail product behavior; graceful shutdown must flush the SDK queue.
- Slash-command usage is tracked guild-scoped as `discord_command_used`
  (`analytics/command-usage.ts`): a closed command-name union plus
  success/error status, captured from the dispatcher's `finally` against the
  guild's installation identity. DM invocations are deliberately not captured
  (no installation distinct id exists) and stay visible in the
  `discord_commands_total` Prometheus counter. Command options, user ids, and
  channel ids remain forbidden, per the registry rule above.
- Scout desktop and Scout evals analytics are out of scope.
