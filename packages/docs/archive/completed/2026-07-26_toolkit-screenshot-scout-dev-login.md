---
id: plan-2026-07-26-toolkit-screenshot-scout-dev-login
type: plan
status: complete
board: false
---

# Happy-path frontend visual testing (screenshot tooling)

Mirrored from the approved plan-mode plan
(`~/.claude/plans/let-s-make-some-happy-transient-wilkes.md`), updated below
with what was actually built (the plan assumed a REST client; live testing
against the real `pinchtab` CLI showed a simpler, CLI-shell-out design was
both correct and available).

## Historical follow-up state

- PR opened and merged (worktree `.claude/worktrees/toolkit-screenshot`,
  branch `feature/toolkit-screenshot`)
- Post-merge, with 1Password access, confirm the dev-login route works
  over a real HTTP round-trip against `bun run dev:web` (the unit tests
  exercise the same function directly, not over `Bun.serve`) — run
  `toolkit screenshot scout-app /app/ --discord-id 160509172704739328`
- Once both above are done: flip `status` to `complete` and move this
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
- **`lib/screenshot/dev-server.ts`** — `ensureDevServer`: **fixed-port,
  deterministic, always spawns fresh** (the bound port is NEVER parsed from
  stdout — dev commands print inconsistent/hard-coded banners, so an
  output-derived port can't be trusted). Flow: it never reuses an
  already-running server (a status probe can't verify that server is actually
  the requested app — an unrelated process, a stale build, or an auth-gated
  stack started without `ENABLE_DEV_LOGIN` could be on the port), so
  `expectedPort` must be free (TCP-connect occupancy check on 127.0.0.1 + ::1)
  and a fresh `Bun.spawn` (`detached`, `BROWSER=none`) binds exactly
  `expectedPort`. If the port is occupied, **fail fast** rather than
  auto-bumping to an unknown port or capturing whatever is there. Readiness =
  poll `readyPath` on `expectedPort`, watching `proc.exitCode` to fail fast if
  the child dies first. `stop()` signals the whole process group (descendants
  too). Uses the existing `lib/deployed/git.ts` `repoRoot()` helper (git
  rev-parse-based) to resolve `cwd` — not `import.meta.url` introspection, which
  would break under `bun build --compile`.
- **`lib/screenshot/pinchtab-driver.ts`** — `captureScreenshot`: creates a
  session, opens a blank tab and applies viewport + `prefers-color-scheme`
  emulation **before** navigating (so pages that read `matchMedia` once at load
  honor `--theme`), then navigates (through the auth flow URL first if the
  package requires one — PinchTab's `nav` follows redirects, so one navigation
  covers both sign-in and arrival), polls `countSelector` for
  `--wait-for-selector` (or a fixed 1s settle delay), screenshots, closes the
  tab, and revokes the session on both the happy and error paths (a nonzero
  revoke on the happy path is a hard error). It also registers the session's
  revoke with the orchestrator via `registerCleanup` so a SIGINT/SIGTERM tears
  the session down too — signal teardown is coordinated in `screenshotCommand`,
  which owns both the dev server and the session.
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
