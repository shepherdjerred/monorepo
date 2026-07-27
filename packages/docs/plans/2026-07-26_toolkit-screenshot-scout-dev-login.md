---
id: plan-2026-07-26-toolkit-screenshot-scout-dev-login
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Happy-path frontend visual testing (screenshot tooling)

Mirrored from the approved plan-mode plan
(`~/.claude/plans/let-s-make-some-happy-transient-wilkes.md`), updated below
with what was actually built (the plan assumed a REST client; live testing
against the real `pinchtab` CLI showed a simpler, CLI-shell-out design was
both correct and available).

## Remaining

- [ ] PR opened and merged (worktree `.claude/worktrees/toolkit-screenshot`,
      branch `feature/toolkit-screenshot`)
- [ ] Post-merge, with 1Password access, confirm the dev-login route works
      over a real HTTP round-trip against `bun run dev:web` (the unit tests
      exercise the same function directly, not over `Bun.serve`) — run
      `toolkit screenshot scout-app /app/ --discord-id 160509172704739328`
- [ ] Once both above are done: flip `status` to `complete` and move this
      file to `packages/docs/archive/completed/`

## Context

A prior task in this session made a UI change to the Scout version-mismatch
banner (`packages/scout-for-lol/packages/app/src/components/version-info.tsx`,
PR #1676, still open) but couldn't produce a screenshot to prove it worked,
as the repo's own conventions require for visible UI changes. Two blockers:

1. The component only renders for an authenticated session belonging to a
   specific Discord user — and scout's web app has **no dev auth bypass**.
2. The monorepo has **no reusable way to boot a frontend package and grab a
   screenshot** at all.

The user's ask: build a **general, low-friction way to visually test
frontend changes across the whole monorepo**, not a one-off fix.

**Driver decision:** the repo already runs **PinchTab**, a persistent,
already-authenticated Chrome instance. During implementation, live testing
against the actual installed `pinchtab` CLI (materially richer than the
`pinchtab-helper` skill doc, which describes an older REST-only surface)
showed the CLI itself is the right integration point — `toolkit` shells out
to it (same pattern as `lib/github/client.ts`'s `gh` wrapper), so **no new
dependency, no Chromium download** was added.

**Scope decision:** PinchTab has no request-interception/mocking primitive.
**v1 explicitly drops network mocking / state-forcing.** This tool answers
"show me what this route currently renders, authenticated as X" — not "...
if the backend said Y." Accepted limitation.

Out of scope: `scout-for-lol/packages/desktop` (Tauri/Rust) and
`tasks-for-obsidian` (React Native/Metro).

## Part A — `toolkit screenshot` (as built)

New files under `packages/toolkit/src/`:

- **`lib/pinchtab-cli/client.ts`** — shells out to the `pinchtab` binary via
  Bun's `$` (not a REST client — the CLI already resolves its own daemon
  auth/config). Every call is scoped to a fresh `session create`/`session
revoke` pair via the `PINCHTAB_SESSION` env var passed to that one
  subprocess call only (never mutates the parent process env). Functions:
  `health`, `createSession`, `revokeSession`, `navigateNewTab` (`nav --new-tab
--print-tab-id`), `setViewport`, `setMedia` (`prefers-color-scheme`),
  `countSelector` (readiness polling), `screenshot` (`-o <path> --format
png`), `closeTab`.
- **`lib/screenshot/catalog.ts`** — alias → `{cwd, devCommand, expectedPort,
defaultRoute, readyPath?, requiresAuth?}` for `sjer-red`, `stocks-sjer-red`,
  `cooklang-rich-preview`, `better-skill-capped`, `docs-board`,
  `scout-marketing`, `mario-kart-frontend`, `pokemon-frontend`, and
  `scout-app` (`requiresAuth: "scout-dev-login"`). `astro-opengraph-images`
  omitted (no dev script). `resolvePackage(alias)` throws a
  known-aliases-listing error for typos.
- **`lib/screenshot/dev-server.ts`** — `ensureDevServer`: fast-probe-and-reuse
  (skipped when `--env` overrides are given — a running server can't pick up
  new env vars), else `Bun.spawn` + regex-match the bound `http://localhost:<port>/`
  banner from stdout/stderr + poll `readyPath`. Uses the existing
  `lib/deployed/git.ts` `repoRoot()` helper (git rev-parse-based) to resolve
  `cwd` — not `import.meta.url` introspection, which would break under
  `bun build --compile`.
- **`lib/screenshot/pinchtab-driver.ts`** — `captureScreenshot`: creates a
  session, navigates (through the auth flow URL first if the package
  requires one — PinchTab's `nav` follows redirects, so one navigation
  covers both sign-in and arrival), optional viewport/theme, polls
  `countSelector` for `--wait-for-selector` (or a fixed 1s settle delay),
  screenshots, closes the tab, revokes the session in a `finally` (so a
  failed run never leaks a session).
- **`commands/screenshot/screenshot.ts`** + **`handlers/screenshot.ts`** +
  routing in **`src/index.ts`** — new top-level `screenshot` command.

**Flag shape (as built):** `--out`, `--wait-for-selector`, `--timeout`,
`--discord-id <id>` (simpler than the planned `--auth <flow[:id]>` — the
auth flow itself is package-determined via the catalog's `requiresAuth`,
so the CLI only needs the optional identity to authenticate as),
`--env KEY=VALUE` (repeatable), `--viewport <WxH>`, `--theme <light|dark>`
(both turned out to be trivially supported — `pinchtab set viewport`/`pinchtab
set media prefers-color-scheme` — so included rather than cut), `--full-page`
(`--beyond-viewport`), `--json`, `--list`. No `--record`/mocking in v1.

**Tests:** `test/screenshot/catalog.test.ts` (fs-only: cwd exists, devCommand
script exists in that package's `package.json`, alias uniqueness,
`resolvePackage` error/success). `test-integration/screenshot.integration.test.ts`
boots `stocks-sjer-red` for real against a live PinchTab daemon and asserts
a real PNG (magic-byte check). PinchTab is a **mandatory prerequisite**: the
suite throws at module load with an actionable message if the health check
fails, rather than green-skipping (which would make "tests passed"
indistinguishable from "browser unavailable"). This suite lives in the
local-only `bun run test:integration` command — deliberately NOT part of
`bun run verify`/CI, which has no browser instance — so a hard failure when
PinchTab is absent is the correct fail-fast behavior, not a permanent red X.

**Live-verified this session** (real PinchTab daemon, real dev server):
`toolkit screenshot stocks-sjer-red /` produced a real 3200×1514 PNG of the
actual site; confirmed clean teardown (no leftover `astro dev` process,
PinchTab session shows `status: revoked`) both on success and on a failed
run hit while debugging. One PinchTab daemon gotcha found and worked
around: it needs a **browser instance already started** from a profile
(`pinchtab instance start --profile default --mode headless`) — a fresh
`session create` alone isn't sufficient — noted in the skill doc.

## Part B — scout-for-lol dev-only instant login (as built, matches plan)

`packages/scout-for-lol/packages/backend/src/trpc/dev-login.ts` —
`handleDevLogin(request)`: validates optional `discordId` (default
`"000000000000000001"`) via the existing `DiscordAccountIdSchema`, upserts
the `User` row, `signSession({discordId, ttlSeconds: 24h})`, sets
`scout_session`/`scout_csrf` cookies, 302s to `returnTo` (default `/app/`).

Refactored `auth-web.ts` along the way: extracted `handleAuthRoutes(request,
url): Promise<Response | null>` consolidating its 4 existing routes (start/
install/callback/logout) behind one delegate — required because adding the
dev-login `if` directly to `http-server.ts`'s `fetch` pushed its cyclomatic
complexity from 20 (the repo's max) to 22. The consolidation net-reduced it
below budget while also being a legitimate cleanup (matches the
`handleImageRoute`/`handleReportAiRoute` `Response | null` delegate pattern
already used in that same file). Exported `buildCookie`/`getAppOrigin`/
`safeReturnTo` (were module-private) and extracted `generateCsrfToken()`
from `handleDiscordCallback`'s inline snippet, reused by both callers.

`http-server.ts` dispatch:

```ts
const authResponse = await handleAuthRoutes(request, url);
if (authResponse !== null) return authResponse;

if (
  configuration.environment === "dev" &&
  configuration.enableDevLogin &&
  url.pathname === "/api/dev/login"
) {
  return await handleDevLogin(request, prisma);
}
```

Gated on BOTH `environment === "dev"` AND the explicit, default-off
`ENABLE_DEV_LOGIN` flag. The extra flag is load-bearing: `ENVIRONMENT`
defaults to `"dev"` when unset (see `resolveEnvironment`), so gating on
environment alone would fail **open** — a beta/prod deploy that omitted
`ENVIRONMENT` would expose an unauthenticated session-minting route.
`ENABLE_DEV_LOGIN` defaults off, so an omitted config fails closed; only the
catalog's spawned `dev:web` (`scripts/dev-web.sh`) turns it on. Do not drop
the flag check when copying this dispatch.

**Tests (`dev-login.test.ts`, run for real, all passing):** default fake
user mints session + upserts row; chosen `discordId`/`username`; malformed
`discordId` → 400 (not a throw); open-redirect `returnTo` rejected, falls
back to `/app/`; same-app `returnTo` honored; `handleDevLogin` throws when
`environment !== "dev"` (the regression guard for "never reachable outside
dev" — asserted directly against the function, not by trying to boot a real
`Bun.serve` instance in a test).

**Not live-verified:** the real HTTP round-trip through a running
`bun run dev:web` backend — that needs `op signin` (not available this
session) plus Discord/Riot secrets. The unit tests exercise the exact same
`handleDevLogin` function object with a real Prisma DB and real JWT
signing/verification, which is strong but not identical to a real `Bun.serve`
request. Left as a caveat, not a blocker.

## What this tool does and does not solve

Solves the OAuth-login friction. Does **not** solve forcing the
contract-hash mismatch state itself (no mocking in v1; `buildInfo.contractHash`
defaults to `"dev"` locally and `isContractMismatch` special-cases that to
always false — confirmed by reading `build-info.ts`). For that specific
state, the practical path is a PinchTab profile with one real login against
the live `beta.scout-for-lol.com` (which had a genuine mismatch as of this
session, root-caused separately to an ongoing CI outage) — a different,
complementary use of PinchTab, not part of this build.

## Part C — skill/docs wiring (as built)

- `packages/toolkit/skills/screenshot/SKILL.md` — flag table, registry,
  `--discord-id` recipe, explicit "Limitations" section (no mocking, no
  auto-start of the PinchTab daemon itself).
- `packages/toolkit/AGENTS.md` (symlinked from `CLAUDE.md`) — new
  `## screenshot` section + structure tree entries.
- `packages/scout-for-lol/AGENTS.md` (symlinked from `CLAUDE.md`) — new
  "Local UI screenshots" subsection under "Web UI (Local end-to-end)".

## Verification

1. ✅ Live: `pinchtab health` → `toolkit screenshot stocks-sjer-red /` → real
   PNG produced, confirmed via `file` + visual inspection; clean teardown
   confirmed (no leftover process, session `revoked`).
2. ✅ `dev-login.test.ts` (6 tests, real Prisma + real JWT signing) — all
   pass. Not separately live-curled against a running `bun run dev:web`
   (needs `op signin`, not available this session).
3. ⏭️ Not run: `toolkit screenshot scout-app /app/ --discord-id
160509172704739328` end-to-end (same `op signin` blocker).
4. ✅ `bun run verify -- --affected` (see Session Log).

## Session Log — 2026-07-26

### Done

- Root-caused the original "can't screenshot the banner" blocker; designed
  and built both pieces per plan, with one architecture pivot (PinchTab CLI
  shell-out instead of a REST client) made after live-testing the real
  `pinchtab` binary mid-implementation and finding it materially richer
  than the `pinchtab-helper` skill doc describes.
- `packages/toolkit`: `screenshot` command (catalog, dev-server lifecycle,
  PinchTab CLI wrapper, driver, command/handler/routing), unit +
  integration tests (both passing live), skill doc, `AGENTS.md` updates.
- `packages/scout-for-lol/packages/backend`: `dev-login.ts` route,
  `auth-web.ts` refactor (`handleAuthRoutes` delegate + exported helpers +
  shared `generateCsrfToken`), `http-server.ts` wiring, `dev-login.test.ts`
  (6 tests passing), `AGENTS.md` update.
- Live end-to-end verification of the zero-auth path (`stocks-sjer-red`),
  including cleanup-on-failure behavior observed while debugging an
  argument-parsing bug (fixed: `positionals[1]`, not `[0]`, is the route —
  `positionals[0]` duplicates the alias, matching the `deployed` handler's
  own convention).

### Remaining

- [ ] Open the PR (worktree `.claude/worktrees/toolkit-screenshot`, branch
      `feature/toolkit-screenshot`).
- [ ] Whoever has 1Password access can do the one remaining live check:
      `toolkit screenshot scout-app /app/ --discord-id 160509172704739328`
      against a real `bun run dev:web`, to confirm the dev-login route works
      over a real HTTP round-trip (not just the unit-tested function call).
- [ ] Once merged: flip `status` to `complete` and move this file to
      `packages/docs/archive/completed/`.

### Caveats

- PinchTab needs a browser **instance** already started
  (`pinchtab instance start --profile default --mode headless` if `pinchtab
instances` is empty) — the daemon being up isn't sufficient by itself;
  `toolkit screenshot` does not auto-start one. Documented in the skill;
  could be a future enhancement (auto-detect-and-start) if this trips people
  up in practice.
- `--viewport`/`--theme` ended up supported (turned out to be trivial via
  `pinchtab set viewport`/`pinchtab set media`) even though the original
  plan text said v1 would exclude them — a strict improvement, not a scope
  change, so implemented rather than artificially cut.
- The scout-app auth-flow composition (`--discord-id`) is implemented and
  unit-level-correct but not live-HTTP-verified end-to-end (see Remaining).

## CI Remediation Session Log — 2026-07-26

### Done

- Repaired PR #1685's hard Buildkite failure: `dev-login.test.ts` no longer
  depends on the process-global default Prisma client, which can be bound to
  the uninitialized `test.db` by a sibling test suite.
- `handleDevLogin` now receives its Prisma client from the dev-only HTTP route;
  the test supplies its isolated, schema-backed test client and disconnects it
  after the suite.
- Verified with `bun run --cwd packages/scout-for-lol/packages/backend test`,
  `bunx turbo run typecheck lint --filter=@scout-for-lol/backend
--concurrency=1`, and `bun run --cwd packages/scout-for-lol/packages/backend
check:test-template`.

### Remaining

- [ ] Push this CI remediation commit and wait for Buildkite plus the Codex
      review gate on the new head.

### Caveats

- The full backend test command still logs expected no-table errors from a
  separate metrics test's intentionally stubbed default database; the command
  exits successfully and the dev-login regression is covered by the isolated
  database client.
