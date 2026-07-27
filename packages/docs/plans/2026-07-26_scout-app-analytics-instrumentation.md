---
id: plan-2026-07-26-scout-app-analytics-instrumentation
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Instrument Scout app SPA (+ server-side) for product-usage analytics

## Context

We want to see **which app features actually get used** (trigger: "I added an AI query
editor but idk if it's used"). Decision: use infra we already run — **self-hosted
Plausible** for client-side feature events + a **Prometheus counter** for server-side
query execution — instead of standing up PostHog.

Today the **app SPA** (`packages/scout-for-lol/packages/app/`, Vite + React, served at
`scout-for-lol.com/app/`) has **zero product analytics** — only Sentry/Bugsink error
tracking. The marketing site already uses Plausible (`plausible.sjer.red`), so the
pattern and instance exist; this brings the same capability to the authenticated
product surface, comprehensively across every feature.

**Confirmed decisions:**

- **Reuse existing Plausible sites** (no dedicated app site). `data-domain` is
  **flavor-specific**: prod → `scout-for-lol.com`, beta → `beta.scout-for-lol.com`.
  Both flavors emit; **local dev is a no-op** (env var absent).
- **Privacy:** cookieless Plausible, **no PII / no high-cardinality props** — never send
  `discordId`, `guildId`, aliases, or Riot IDs. Only low-cardinality enums. Dynamic
  route segments are templated in pageviews.

## Design

### 1. Central analytics module — `app/src/lib/analytics.ts` (new)

Mirror `lib/build-info.ts` (Zod-validated `import.meta.env`) + `lib/discord-invite.ts`
(lazy DOM access, importable from Bun unit tests).

- Zod env: `VITE_PLAUSIBLE_DOMAIN` (optional), `VITE_PLAUSIBLE_SRC` (optional, default
  `https://plausible.sjer.red/js/script.manual.js` — manual variant so we control SPA
  pageviews; auto would leak guild IDs into path cardinality).
- `initAnalytics()`: when domain configured, install the queue stub and inject the
  `<script defer data-domain=… src=…>` tag; **no-op when domain absent**.
- `trackPageview(path)`, `track(event, props?)` — guarded by
  `typeof window.plausible === "function"`. Typed `ScoutAnalyticsEvent` union + a
  `Record<string, string | number | boolean>` props type. `declare global` adds
  `Window.plausible?`.
- `normalizePath` templates `/g/:guildId`, `/reports/:reportId`, `/players/:alias`,
  `/competitions/:competitionId`.
- Colocated `analytics.test.ts`: no-op when disabled; `normalizePath` templating.

### 2. Init + pageviews

- `main.tsx`: `initAnalytics()` right after `Sentry.init(...)`.
- `app.tsx`: `useLocation` effect → `trackPageview(normalizePath(pathname))`.

### 3. All ~30 mutations — one DRY wiring point (React Query `MutationCache`)

- Augment RQ meta typing once (`declare module "@tanstack/react-query"` →
  `Register.mutationMeta = { analyticsEvent?: ScoutAnalyticsEvent }`).
- `main.tsx` `QueryClient` gets a `MutationCache` whose `onSuccess`/`onError` read
  `mutation.meta?.analyticsEvent` → `track(event, { outcome })`.
- Each mutation site adds one-line `meta: { analyticsEvent: "…" }`.
- **Rich-outcome exceptions** (`subscription.add` kind) fire an explicit `track()` and
  omit `meta` (no double-fire).
- **Excluded:** `report.previewQuery` (500 ms debounce spam) — counted server-side.

### 4. AI editor + ScoutQL — explicit events

`report-ai-editor.tsx` (+ `lib/report-ai-stream.ts`): `ai_edit_started`,
`ai_edit_applied`, `ai_edit_cancelled`, `ai_edit_error`. Plus `report_preset_used`
(`report-common-presets.tsx`), `data_explorer_action` (`report-data-explorer.tsx`).

### 5. Onboarding funnel + entry/auth

`onboarding_step` (`onboarding-wizard.tsx`), `bot_install_click` (`guild-picker.tsx`),
`login_click` (`login.tsx`), `sign_out` (`user-menu.tsx`), `theme_changed`
(`use-theme.tsx`).

### 6. Server-side query counter — `backend/src/metrics/report-query.ts` (new)

`scout_report_query_runs_total{source,outcome}` (+ optional
`scout_report_query_duration_seconds`), incremented at the single choke point
`executeReportQuery` in `backend/src/reports/query-engine.ts`. Auto-scraped (shared
`registry`, existing `scout-${stage}` ServiceMonitor) — no scrape config change.

### 7. Config / deploy

- `app/src/vite-env.d.ts`: declare optional `VITE_PLAUSIBLE_DOMAIN`, `VITE_PLAUSIBLE_SRC`.
- `scripts/scout-site-release.ts` `buildSite` `buildEnv`: per-flavor
  `VITE_PLAUSIBLE_DOMAIN` (prod `scout-for-lol.com`, beta `beta.scout-for-lol.com`) —
  public domain string, no secret.

## Operator prerequisites (one-time, outside code)

- Ensure Plausible sites exist: `scout-for-lol.com` (exists) + `beta.scout-for-lol.com`
  (create in Plausible admin if missing).
- Add key events as Goals in each site to chart them.

## Verification

1. Local smoke: `bun run --filter='./packages/scout-for-lol' dev:web` with
   `VITE_PLAUSIBLE_DOMAIN=beta.scout-for-lol.com`; confirm `POST
plausible.sjer.red/api/event` w/ right name/domain/templated `u`/low-cardinality
   props, no PII; and no requests without the var.
2. Backend: run a report/preview in `dev:web`, `curl -s localhost:3000/metrics | grep
scout_report_query_runs_total`.
3. Gates: `bunx turbo run typecheck lint test --filter=@scout-for-lol/app
--filter=@scout-for-lol/backend`, then `bun run verify -- --affected`.
4. Dashboard: after beta deploy, events land under `beta.scout-for-lol.com`; AI events
   answer the original question.

## Out of scope

- No PostHog / session replay / funnels-platform.
- No desktop or marketing-site changes.
- No new Grafana panel (existing `scout-dashboard.ts` can add one later).

## Session Log — 2026-07-26

### Done

- Client analytics module `packages/scout-for-lol/packages/app/src/lib/analytics.ts`
  (+ `analytics.test.ts`, 10 tests): env-gated Plausible loader, typed event catalog,
  `track`/`trackPageview`/`analyticsMeta`/`trackMutationMeta`, `normalizePath`.
- Init in `main.tsx` (MutationCache → `trackMutationMeta`); pageviews in `app.tsx`.
- 31 mutations tagged `meta: analyticsMeta(...)`; explicit events for AI editor,
  presets, data explorer, onboarding funnel, bot install, login, sign-out, theme,
  `subscription_add` (kind).
- Backend `metrics/report-query.ts` (`scout_report_query_runs_total` + histogram),
  wired at `executeReportQuery`.
- Per-flavor `VITE_PLAUSIBLE_DOMAIN` in `scripts/scout-site-release.ts`;
  `vite-env.d.ts` declarations.
- Verified: `bun run verify -- --affected` all green; prod build inlines the domain +
  script + events; site-release dry-runs emit the var. PR #1688 (ready for review).

### Remaining

- See `## Remaining` below (operator Plausible-site + goals, post-deploy dashboard
  check, Grafana scrape confirmation, PR merge).

### Caveats

- Chose a Zod-validated `trackMutationMeta` + typed `analyticsMeta()` helper over a
  React Query `Register` augmentation: the augmentation needs `interface` (declaration
  merging) which trips `consistent-type-definitions`, and the `eslint-disable` for it is
  blocked by the pre-commit `check-suppressions` gate. The helper keeps compile-time
  typo safety with zero suppressions.
- `report.previewQuery` is intentionally NOT client-tracked (500 ms debounce spam);
  query volume is captured server-side instead.
- Plausible dashboard evidence can only exist after a real beta deploy fires events —
  it is a post-deploy verification item, not a pre-merge screenshot.

## Remaining

- [ ] Land the PR (`feature/scout-app-analytics`) after review.
- [ ] Operator: ensure the `beta.scout-for-lol.com` Plausible site exists (create in
      the `plausible.sjer.red` admin if missing); `scout-for-lol.com` already exists.
- [ ] Operator: add the key app events as Goals in each Plausible site so they chart
      (custom events are auto-collected; goals surface them).
- [ ] Post-beta-deploy: confirm events land under `beta.scout-for-lol.com` and that the
      AI-editor events answer the original "is the AI query editor used" question.
- [ ] Confirm `scout_report_query_runs_total` is scraped in Grafana after deploy.
