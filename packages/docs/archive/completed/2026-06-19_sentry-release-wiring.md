# `toSorted` fix + monorepo-wide Sentry release wiring + coverage gaps

## Status

Complete — shipped in PR #1267.

## Context

Bugsink triage of **Better Skill Capped** (project 3) found two open `[...].toSorted is not a function`
issues that were "resolved" in March and **recurred in June** (the Bugsink resolve never fixed the source).
Every Better Skill Capped event also has `release: null`, so regressions can't be tied to a deploy. User wants:
(1) root-cause `toSorted`, (2) fix release tracking, (3) audit the whole repo so every Sentry usage has
`release`+`environment`, and (4) add Sentry to the 3 deployed apps that have none.

**Confirmed decisions:** scope = everything (all archetypes); **no ESLint guard** (bot-only error) — just swap
the 4 calls; **wire scout Astro frontend**; **add Sentry to streambot + scout `app/` + trmnl-dashboard**; skip
libs/CLI/manual-pipelines. **HA workflows are already covered — no action** (see below).

## Root cause — `toSorted`

ES2023 (`Array.prototype.toSorted`, Chrome 110+/Safari 16+/FF 115+). Vite/esbuild does syntax-only transforms,
no API polyfills → ships verbatim and throws on old engines. All Better Skill Capped events were from a
`HeadlessChrome/105` bot (~zero real-user impact). Same bug class as the **2026-02-26 tasks-for-obsidian
audit** (`.toSorted`→`.sort` ×10 for Hermes; no guard added → recurred here). The 4 call sites all spread into
a fresh array first, so `.sort()` is a safe swap.

## HA workflows — already covered (no work)

HA automations live in `packages/temporal/src/workflows/ha/` (welcome-home, leaving-home, reconcile-lock, …),
run in the temporal worker (`worker.ts:75` inits Sentry with `release: VERSION` + `environment`). Project 4
events carry `release: "2.0.0-977"`, `environment: production`, and `entity_id`/`workflow` tags — the
gold-standard pattern. Nothing to change. (Minor note: project 4 has been quiet since 2026-04-22; optional to
verify it still receives events post-migration, but that's ops, not code.)

## Audit — `release` state of existing inits

**Wired ✅:** temporal (+HA), tasknotes-server, scout-for-lol/backend, starlight-karma-bot, birmel.

| Missing ❌                        | File                                | Archetype             | Release source                                |
| --------------------------------- | ----------------------------------- | --------------------- | --------------------------------------------- |
| better-skill-capped               | `src/index.tsx:23`                  | static Vite site      | `import.meta.env.VITE_SENTRY_RELEASE`         |
| sjer.red                          | `src/layouts/BaseLayout.astro:81`   | static Astro site     | `import.meta.env.PUBLIC_SENTRY_RELEASE`       |
| scout-for-lol/frontend            | _(not initialized)_                 | static Astro site     | new init, `PUBLIC_SENTRY_RELEASE`, DSN proj 1 |
| discord-plays-pokemon/backend     | `packages/backend/src/index.ts:3`   | custom-Dockerfile Bun | `Bun.env.VERSION` (baked)                     |
| discord-plays-pokemon/frontend    | `packages/frontend/src/main.tsx:16` | Vite in container     | `import.meta.env.VITE_SENTRY_RELEASE`         |
| discord-plays-mario-kart/backend  | `packages/backend/src/index.ts:3`   | custom-Dockerfile Bun | `Bun.env.VERSION` (baked)                     |
| discord-plays-mario-kart/frontend | `packages/frontend/src/main.tsx:16` | Vite in container     | `import.meta.env.VITE_SENTRY_RELEASE`         |
| scout-for-lol/desktop             | `packages/desktop/src/main.tsx:7`   | Tauri + Vite          | Vite `define` from package version            |
| tasks-for-obsidian                | `App.tsx:22`                        | React Native (Hermes) | app/native version constant                   |

## Plan

### Part 1 — Fix `toSorted`

- Swap 4 `.toSorted(`→`.sort(` in `packages/better-skill-capped/src/components/app.tsx:64,68,72` + `router.tsx:49`.
- After deploy, resolve the two open `toSorted` Bugsink issues via web UI.

### Part 2 — Release wiring for existing inits

**Convention:** Bun→`Bun.env.VERSION`; Vite→`import.meta.env.VITE_SENTRY_RELEASE`; Astro→`import.meta.env.PUBLIC_SENTRY_RELEASE`; always set `environment` too.

- **A. pokemon/mario-kart backends** — add `release: Bun.env.VERSION` (env baked; no Dagger change).
- **B. pokemon/mario-kart frontends** — set `VITE_SENTRY_RELEASE` env **before** the frontend `bun run build`
  in the Dagger helpers (`.dagger/src/image.ts:1130` + mario-kart equiv); read it in each `main.tsx`.
- **C. Static sites (better-skill-capped, sjer.red, scout frontend + scout `app/`)** —
  1. In `scripts/ci/src/steps/sites.ts`, prepend a release env to the site build cmd
     (`VITE_SENTRY_RELEASE`/`PUBLIC_SENTRY_RELEASE` = `2.0.0-$BUILDKITE_BUILD_NUMBER`); regen pipeline.
  2. better-skill-capped `src/index.tsx`: replace commented lines with `release`+`environment: import.meta.env.MODE`.
  3. sjer.red `BaseLayout.astro`: add `release`+`environment`.
  4. scout frontend: add `PUBLIC_SENTRY_RELEASE` to `astro.config.mjs` env schema + new Sentry `<script>` init
     (DSN scout proj 1) in `Layout.astro` + `app/AppLayout.astro` (mirror `MarketingTracking.astro`).
- **D. scout desktop (Tauri)** — Vite `define` exposing package version; set `release`+`environment` in `main.tsx`.
- **E. tasks-for-obsidian (RN)** — `environment: __DEV__ ? "development" : "production"` + `release` from app/native
  version (build-time constant). Most involved; confirm version source at implementation.

### Part 3 — New Sentry coverage (3 apps)

**streambot** and **trmnl-dashboard** are Bun services (streambot via `buildImageHelper`, trmnl via its own
helper `image.ts:1425`) → confirm both bake `VERSION` env, then:

- Add `@sentry/bun`; `Sentry.init({ dsn: Bun.env.SENTRY_DSN, environment, release: Bun.env.VERSION })` in
  `src/index.ts` (mirror birmel/starlight; gate on DSN presence).
- **Prereqs (operational):** create a Bugsink project per app (`POST /projects/` → DSN), store DSN in the app's
  1P item (streambot-config; new trmnl item), wire `SENTRY_DSN` env in the homelab deployment
  (`resources/streambot.ts`, `resources/trmnl-dashboard/index.ts`) like scout/starlight.

**scout `app/`** (Vite SPA, served from the scout-frontend bucket under `/app/`):

- Add `@sentry/react`; `Sentry.init` in `packages/app/src/main.tsx` (`release: import.meta.env.VITE_SENTRY_RELEASE`,
  `environment: import.meta.env.MODE`, DSN = scout proj 1). Release rides the Part 2C env (build-bucket.ts runs
  the app build in the same process), so just ensure `VITE_SENTRY_RELEASE` reaches it.

## Verification

- `bun run typecheck` + `bun run test` + `bunx eslint . --fix` in each touched package.
- `cd scripts/ci && bun run src/main.ts` after `sites.ts` change.
- Build each frontend locally; confirm release env resolves in the bundle.
- Post-deploy: confirm new Bugsink events per project carry non-null `release` (API/UI), incl. the 3 new projects.

## Caveats / flags

- **mario-kart shares the Pokémon Bugsink project (DSN `…/8`)** — no dedicated project, so tags won't fully
  separate them. Recommend a dedicated mario-kart project as follow-up (out of default scope unless wanted now).
- scout `app/` reuses the scout backend project (1), matching desktop; a dedicated app project is optional.
- One worktree + single PR (theme: "Sentry release wiring + coverage"). Riskiest surface = CI/Dagger/cdk8s;
  Bugsink-project + 1P-secret creation are operational prereqs (op calls need approval — batch them).
- Bugsink API is read-only for issue state; resolving the `toSorted` issues is a web-UI action.

## Session Log — 2026-06-19

### Done

Branch `feature/sentry-release-wiring` (5 commits):

- **toSorted root cause** (`a52114e1b`): the actual cause of the recurrence was
  `unicorn/no-array-sort` (unicorn recommended preset) **mandating** `Array#toSorted()`
  — the March `.sort()` fix was reverted to satisfy it. Disabled the rule in
  `packages/eslint-config/src/configs/base.ts`; converted 9 browser/RN-context
  `.toSorted()` → `.sort()` (4 in better-skill-capped, 5 in scout-for-lol frontend/ui);
  modernized bsc's stale CRA `react-scripts` type ref → `vite/client`.
- **Release wiring** (`c0b80bf86`, `c9879cfcf`, `26d3b8794`): every previously-unwired
  Sentry init now sets `release` + `environment` —
  pokemon/mario-kart backends (`Bun.env.VERSION`) + frontends (`VITE_SENTRY_RELEASE`
  injected before the Dagger frontend build); static sites bsc/sjer.red/scout-frontend +
  the scout `app/` SPA (CI `sites.ts` stamps `VITE_/PUBLIC_SENTRY_RELEASE=2.0.0-$BUILDKITE_BUILD_NUMBER`);
  scout desktop (Vite `define` from package version); tasks-for-obsidian (RN, package version).
- **New coverage** (`caa6a1a9f`): streambot (Bugsink project 14) + trmnl-dashboard
  (project 15) got `@sentry/bun` + init + homelab `SENTRY_DSN`/`ENVIRONMENT` env +
  1P `SENTRY_DSN` fields + refreshed vault snapshot. scout `app/` (the live `/app/` SPA)
  got `@sentry/react` + init (shipped in the static-sites commit).
- Verified: per-package typecheck + eslint, `sites.ts` pipeline regen, 1P linter,
  homelab test (via the proper `bun run test` that `cd`s to `src/cdk8s`), and an
  end-to-end build proving `VITE_SENTRY_RELEASE` inlines into the bsc bundle.

### Remaining

- **Post-deploy**: confirm new Bugsink events carry non-null `release` per project
  (esp. the 2 new projects). Resolve the 2 open better-skill-capped `toSorted` issues
  (`7d89ba6c…`, `70a12686…`) via the Bugsink web UI once the fix deploys (API is
  read-only for issue state).
- CI on the PR must go green (Buildkite).

### Caveats

- **mario-kart shares the Pokémon Bugsink project (DSN `…/8`)** — no dedicated project,
  so `release`/`environment` tags won't fully separate the two. A dedicated mario-kart
  project remains a recommended follow-up (out of this PR's scope).
- The audit subagent wrongly reported scout-frontend "not initialized" — it already had a
  `Sentry.init` in `Layout.astro`; caught by reading the file. (Reinforces
  verify-before-asserting.)
- scout `app/` reuses the scout backend project (1), matching desktop; a dedicated app
  project is optional.
- `AppLayout.astro` left uninstrumented on purpose: build-bucket.ts overwrites the Astro
  `/app/` output with the `packages/app` SPA, so the SPA's init is the live one.
