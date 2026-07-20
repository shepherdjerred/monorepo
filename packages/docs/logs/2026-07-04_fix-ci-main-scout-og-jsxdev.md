---
id: log-2026-07-04-fix-ci-main-scout-og-jsxdev
type: log
status: complete
board: false
---

# Fix CI on main — scout-for-lol OG template `jsxDEV` deploy failure

## Context

Main branch CI (Buildkite build **5069**, commit `ecd57aa74`) was **red**.
Task: "fix CI on main."

## Investigation

Build 5069 had four failed jobs. Classifying by whether they actually block the
build (`soft_failed` flag from the Buildkite API):

| Job                                    | `soft_failed` | Blocks build? |
| -------------------------------------- | ------------- | ------------- |
| `:scissors: Knip`                      | `true`        | No (advisory) |
| `:shield: Trivy Scan`                  | `true`        | No (advisory) |
| `:ship: Deploy scout-for-lol … (prod)` | `false`       | **Yes**       |
| `:ship: Deploy scout-for-lol … (beta)` | `false`       | **Yes**       |

So the **only** thing turning main red was the scout-for-lol deploy. (Confirmed
by comparing to build **5063**, which Buildkite marked `passed` overall even
though its Knip job had already `failed` — soft-fail jobs don't fail the build.)

### Root cause of the deploy failure

The deploy's `astro build` crashed in the `astro:build:done` OG-image hook:

```
[astro-opengraph-images] jsxDEV_7x81h0kn is not a function
  at ogTemplate (…/frontend/src/lib/og-template.tsx:35:9)
```

`packages/scout-for-lol/packages/frontend/astro.config.mjs` imports
`ogTemplate` **directly from a `.tsx` file**. Astro's config loader transpiles
that `.tsx` on the fly via esbuild. In CI's container (`oven/bun:1.3.14`, linux
x64 **baseline**) that transpile selects the **dev** automatic JSX runtime and
emits `jsxDEV(...)` calls whose `react/jsx-dev-runtime` import gets stripped from
the config bundle — leaving `jsxDEV` undefined at render time.

Why it never surfaced before: OG generation only runs in the **deploy** step
(main-only), so PR CI never exercised it. Build 5069 was the first completed main
build after the SEO/OG PR (#1382) merged. It also does **not** reproduce on the
local mac (arm64) build — the production JSX runtime is selected there — so it's
specific to the CI container's transpile path.

The package's own presets (used by `sjer.red`) work because they're pre-compiled
to `dist/` by `tsc` (`jsx: "react-jsx"` → production `react/jsx-runtime`). Only
scout ships a raw-source `.tsx` template imported into the config.

## Fix

`packages/scout-for-lol/packages/frontend/src/lib/og-template.tsx` — pin the file
to the **classic** JSX runtime with esbuild pragma comments:

```tsx
/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import React from "react";
```

JSX then compiles to `React.createElement(...)` using the already-imported
`React` default (which always resolves), independent of the ambient transpile
mode — no `jsxDEV`/`jsx-runtime` import to strip. JSX syntax stays intact.

### Verification

- Local `astro build` → 43 OG PNGs generated, ESLint + Prettier clean.
- esbuild pragma override proven under forced `--jsx=automatic --jsx-dev`
  (emits `React.createElement`, not `jsxDEV`) — **both** on the mac and inside
  the exact CI base image `oven/bun:1.3.14` (linux x64). This is the environment
  where the failure occurs, so it confirms the fix applies there.

## Soft-fail advisories — triaged out of scope

Both are **non-blocking** (soft-fail) and were already red on the last
`passed` build (5063); neither turns main red.

- **Trivy**: ~60 HIGH `CVE-2026-*` findings across ~20 `bun.lock` files **and**
  Go modules (undici, astro, vite, form-data, hono, ws, protobufjs, linkify-it,
  golang.org/x/{crypto,net}). This is a repo-wide dependency refresh — Renovate's
  domain, not a "make CI green" change. A partial fix (I trialed bumping toolkit
  undici → 6.27.0 and the webring example astro/vite, then reverted) wouldn't
  turn the check green anyway.
- **Knip**: findings are **identical** between builds 5063 and 5069 — pre-existing
  advisory noise (unused files, `eslint`/`vite`/`astro` binary detection quirks
  across nested workspaces, a couple of unused exports), not introduced by recent
  merges.

## Session Log — 2026-07-04

### Done

- Fixed the sole hard blocker on main: scout-for-lol deploy `jsxDEV` OG crash, via
  classic-runtime JSX pragmas in
  `packages/scout-for-lol/packages/frontend/src/lib/og-template.tsx`.
- Verified the fix end-to-end (local build produces OG images; pragma override
  confirmed in the exact CI base image).

### Remaining

- **Trivy** (soft-fail): repo-wide CVE refresh — recommend letting Renovate land
  the bumps, or a dedicated dependency-security pass. Not required for green CI.
- **Knip** (soft-fail): longstanding advisory noise — separate cleanup if desired.

### Caveats

- The failure does not reproduce on local mac builds; it is specific to the CI
  container's config transpile. Do not remove the pragma comments — they are the
  fix. The in-file comment says so.

## Session Log — 2026-07-05

### Done

- Removed the build-time requirement for marketing tracking env vars in
  `packages/scout-for-lol/packages/frontend/astro.config.mjs` and
  `packages/scout-for-lol/packages/frontend/src/lib/marketing.ts`.
- Gated `packages/scout-for-lol/packages/frontend/src/components/MarketingTracking.astro`
  so the pixel loader is skipped cleanly when those optional IDs are absent.
- Verified the frontend package with `bun run build`, `bun run lint`,
  `bun run typecheck`, `bun run test`, and `bunx prettier --check` in the Scout
  frontend workspace.

### Remaining

- Buildkite still needs a fresh run to reflect the pushed fixes.

### Caveats

- The only non-green items I saw locally were the existing Vite chunking
  warnings during `astro build`; they did not fail the build.
