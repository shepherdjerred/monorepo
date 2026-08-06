---
id: plan-2026-07-25-scout-version-visibility
type: plan
status: complete
board: false
---

# Scout version visibility: build number + git SHA + contract hash in the UI

## Historical follow-up state

- PR merged (stacked on #1630)
- Post-merge: `curl https://scout-for-lol.com/api/version` returns version/gitSha/contractHash; SPA footer shows both identities; no mismatch banner on a healthy pair

## Context

Follow-up to the Renovate promotion work (PR #1630). The user wants runtime visibility of what each half of scout is running: expose **build version + git SHA + a tRPC contract hash** from the backend, show the SPA's own build info alongside the backend's, and warn in the UI when the contract hashes differ. Deploy-time skew windows (rollout transient, open tabs, hand-edits) are explicitly accepted — this is visibility + a reload nudge, not a prevention mechanism.

**Key constraint (from the promotion work):** build numbers legitimately differ in a healthy pair (backend image is content-gated; prod today = site `2.0.0-6017` + backend labeled `5991`). So the mismatch signal must be the **contract hash** — a deterministic hash of the contract-defining sources — never a version comparison. Two builds at different commits hash equal iff the contract didn't change.

**Facts verified by exploration:**

- Backend already has `configuration.version` / `configuration.gitSha` (`packages/scout-for-lol/packages/backend/src/configuration.ts:64-65`) from `VERSION`/`GIT_SHA` ARG→ENV baked by `docker-bake.hcl` `_app` target — zero build changes needed for those.
- HTTP surface is a `Bun.serve` fetch chain (`packages/backend/src/http-server.ts:158`) with unauthenticated `/healthz` etc.; `corsHeadersFor(request)` at `:60`. No `/api/version` exists.
- Contract surface: `packages/backend/src/trpc/router/**` + `src/trpc/trpc.ts` + `packages/data/src/**` + `packages/backend/prisma/schema.prisma` (Prisma types leak into inferred outputs). No codegen; the SPA imports `AppRouter` type-only (`packages/app/src/lib/trpc.ts:3`).
- Site build env is injected in `scripts/scout-site-release.ts` `buildSite()` (`buildEnv` map, lines ~115-140) and inherited through `packages/scout-for-lol/scripts/build-bucket.ts`. SPA reads `VITE_*` via bracket access; no `vite-env.d.ts` exists (template: `packages/better-skill-capped/src/vite-env.d.ts`); optional-env zod pattern: `packages/app/src/lib/discord-invite.ts:15-26`.
- SPA has no footer/toast; banner precedent = `GetStartedBanner` Card (`packages/app/src/routes/guild-picker.tsx:170`); app shell = `packages/app/src/app.tsx:20`. Marketing footer = `packages/frontend/src/components/Footer.astro` (© line); Astro env via `astro.config.mjs` `env.schema` (~line 37-56).
- Tests: backend `bun:test` (pure-function pattern for HTTP handlers — health handlers are exported functions); SPA precedent is pure-logic tests (`onboarding-steps.test.ts`).

## Deliverable

One PR, stacked on `feature/scout-renovate-promotion` (#1630) in the existing worktree `.claude/worktrees/scout-renovate-promotion` (git-spice `branch create` on top).

## Changes

### 1. Contract hash script — `packages/scout-for-lol/scripts/contract-hash.ts`

Dependency-free (Bun stdlib only — `Bun.Glob`, `crypto`), so it runs under `bun --no-install` in the images step. Deterministic: collect files from

- `packages/backend/src/trpc/router/**/*.ts` + `packages/backend/src/trpc/trpc.ts`
- `packages/data/src/**/*.ts`
- `packages/backend/prisma/schema.prisma`

(excluding `*.test.ts`), sort relative paths, sha256 over `relpath \0 content` sequence, print hex to stdout. All inputs are image sources, so any hash change implies a new image digest — a minted pair always has equal hashes on both sides.

### 2. Bake the hash into the backend image

- `docker-bake.hcl`: `variable "CONTRACT_HASH" { default = "dev" }`; add `args = { CONTRACT_HASH = CONTRACT_HASH }` to the `scout-for-lol` target only (not `_app` — other images don't declare the ARG).
- `packages/backend/Dockerfile`: `ARG CONTRACT_HASH=dev` + `ENV CONTRACT_HASH=${CONTRACT_HASH}` in the late ARG block (lines ~46-49, alongside VERSION/GIT_SHA — no cache bust).
- `.buildkite/scripts/bake-images.sh`: compute once before bake — `CONTRACT_HASH="$(bun --no-install packages/scout-for-lol/scripts/contract-hash.ts)"` — and export for the bake invocation (both PR and push modes, same place VERSION/GIT_SHA are set).

### 3. Backend: config + `/api/version`

- `configuration.ts`: `contractHash: getRequiredEnvVar("CONTRACT_HASH")` + getter (mirrors `version`/`gitSha`; ARG default guarantees presence in images). Add `CONTRACT_HASH=local-dev` to `packages/scout-for-lol/dev-web.env.tpl` next to the existing `VERSION`/`GIT_SHA` lines.
- `http-server.ts`: exported pure handler `handleVersion(request)` → `Response.json({ version, gitSha, contractHash }, { headers: { ...corsHeadersFor(request), "Cache-Control": "no-store" } })`; wire `if (url.pathname === "/api/version")` next to `/healthz` (~line 189). Deliberately NOT a tRPC procedure: stays curl-able (`curl https://scout-for-lol.com/api/version`) and independent of the contract it reports on.
- Test: `http-server` handler unit test (pure function, like the health handlers would be) asserting shape + no-store + CORS echo for the configured origin.

### 4. Site builds get the same metadata

`scripts/scout-site-release.ts` `buildSite()`: extend `buildEnv` with

- `VITE_APP_VERSION: version`, `VITE_GIT_SHA: gitSha`, `VITE_CONTRACT_HASH: contractHash` (SPA)
- `PUBLIC_APP_VERSION: version`, `PUBLIC_GIT_SHA: gitSha` (marketing footer; no hash — it doesn't call the API)

where `gitSha` = `BUILDKITE_COMMIT` ?? `git rev-parse HEAD` (same resolution `archive()` already uses — extract a small shared helper) and `contractHash` = run `packages/scout-for-lol/scripts/contract-hash.ts` (via `run([...])`, `--no-install` — script is in validate-pipeline's automation-source scan scope only if referenced; keep spawns compliant).

### 5. SPA display + mismatch banner (`packages/scout-for-lol/packages/app`)

- `src/vite-env.d.ts` (new, from better-skill-capped template): type `VITE_SENTRY_RELEASE?`, `VITE_APP_VERSION?`, `VITE_GIT_SHA?`, `VITE_CONTRACT_HASH?`, `VITE_DISCORD_CLIENT_ID?`.
- `src/lib/build-info.ts`: zod `EnvSchema` (all `.optional()`, `discord-invite.ts` pattern) → `{ version, gitSha, contractHash }` with `"dev"` fallbacks; export pure `isContractMismatch(local, remote)` — true only when **both** hashes are real (not `"dev"`/empty) and differ. `bun:test` for it (`build-info.test.ts`).
- `src/components/version-info.tsx`: react-query `useQuery` fetching `/api/version` (`credentials: "include"`, zod-parse the response). Renders:
  - a subtle one-line footer at the bottom of the app shell (`app.tsx` outer div): `app 2.0.0-6017 (abc1234) · api 2.0.0-6017 (def5678)` — muted, `text-xs text-muted-foreground`, sha shortened to 7, hash not shown (it's in the tooltip/title attribute).
  - on `isContractMismatch`: a dismissible `<Card>` banner (GetStartedBanner pattern, `AlertCircle` icon) at the top of `app.tsx`: "This page was built against a different API version — reload to get the matching version" with a Reload button (`location.reload()`).
  - fetch failure or missing data → render nothing beyond the app's own info (no error noise).

### 6. Marketing footer

- `astro.config.mjs` `env.schema`: add `PUBLIC_APP_VERSION`, `PUBLIC_GIT_SHA` (client/public/optional string fields).
- `Footer.astro`: append `· v{version} ({sha7})` to the © line in both variants, only when the env vars are present (guarded bracket access, `Layout.astro:44` pattern).

## Files touched (summary)

| Area         | Files                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Hash script  | `packages/scout-for-lol/scripts/contract-hash.ts` (new)                                                                               |
| Image bake   | `docker-bake.hcl`, `packages/scout-for-lol/packages/backend/Dockerfile`, `.buildkite/scripts/bake-images.sh`                          |
| Backend      | `src/configuration.ts`, `src/http-server.ts` (+ handler test), `packages/scout-for-lol/dev-web.env.tpl`                               |
| Site release | `scripts/scout-site-release.ts`                                                                                                       |
| SPA          | `packages/app/src/vite-env.d.ts` (new), `src/lib/build-info.ts` (+ test, new), `src/components/version-info.tsx` (new), `src/app.tsx` |
| Marketing    | `packages/frontend/astro.config.mjs`, `src/components/Footer.astro`                                                                   |

## Verification

1. `bun run verify -- --affected` (typecheck/lint/tests incl. the new hash + handler + mismatch tests).
2. Determinism: run `contract-hash.ts` twice → identical output; touch a router file → output changes; touch an unrelated backend file → unchanged.
3. Local e2e: `bun run dev:web` → `curl localhost:3000/api/version` returns `{version: "local-dev", gitSha: "local-dev", contractHash: "local-dev"}`; SPA footer shows dev values; no banner (dev hashes excluded from mismatch).
4. Banner state: temporarily override the SPA env (e.g. `VITE_CONTRACT_HASH=deadbeef bun run dev` in packages/app) against the local backend → banner renders; screenshot both footer and banner states for the PR (visual change ⇒ screenshots per repo policy).
5. CI: PR-mode bake rehearses the CONTRACT_HASH plumbing; `sites-pr` dry-runs `buildSite` env additions.

## Out of scope (accepted by user)

Rollout-window skew, open-tab staleness beyond the reload nudge, hand-edit enforcement, marketing-site contract hash, toast infrastructure.
