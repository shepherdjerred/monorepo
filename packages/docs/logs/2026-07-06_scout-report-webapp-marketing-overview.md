# Scout for LoL — Report / Web App / Marketing Overview

## Status

Complete

Read-only architectural walkthrough of three Scout-for-LoL areas, requested for orientation. No code changed.

## Report generation — `packages/scout-for-lol/packages/report`

- Pipeline: React/JSX → **satori** (yoga-wasm flexbox) → SVG → **@resvg/resvg-js** → PNG @600 DPI, auto bbox-crop. Sync render, so images preloaded to base64 first.
- Five exported renderers (`src/index.ts`): `matchToImage`, `arenaMatchToImage`, `loadingScreenToImage`, `competitionChartToImage` (echarts), `discordScreenshotToImage`.
- Fonts (`src/assets/index.ts`): Beaufort for LoL (titles) + Spiegel (body), per weight/style TTF buffers.
- Data Dragon cache (`src/dataDragon/image-cache.ts`): spells/items base64 at init, champions per-render; graceful degradation — item miss → placeholder SVG, missing skin → skin 0; optional `setItemMissHandler` / `onSkinFallback` callbacks for Prometheus metering.
- Constraints enforced by shared ESLint rule `satori-best-practices` (inline styles, stateless JSX, no external URLs).
- `src/browser.ts` = browser-safe `Report` export (no satori/resvg) for frontend preview.
- Tests: SHA256 SVG snapshots, seeded-RNG fixtures to `test-output/`, real-data integration tests.

## Web app — `frontend/src/pages/app` + `packages/desktop`

- Authenticated dashboard (Astro, `/app`, noindex, same origin as marketing): Dashboard, API Tokens (create/revoke, for desktop auth), Settings (Discord account), Sound Packs CRUD.
- Backend comms: tRPC `createTRPCClient<AppRouter>` → `${BACKEND_URL}/trpc`, `AppRouter` import-type only; Discord login, session token in localStorage as Bearer (`src/lib/trpc.ts`).
- `/dev` internal tools: **review-tool** (`components/review-tool/`, ~28 files) — AI match-review pipeline harness (S3/R2 match browser, multi-stage LLM pipeline, cost tracking, star ratings/analytics, history, IndexedDB config); **report-ui** — browser preview of Report/ArenaReport.
- Desktop (`packages/desktop`, Tauri + React 19 + Vite): LCU live-game monitor, configures backend URL + API token, streams events to backend; League/Backend/Monitor sections + debug panel; Rust IPC; Sentry. Shares `@scout-for-lol/ui`.
- Dev: `dev:web` → backend :3000 (BETA bot) + Vite :5180 proxying /trpc+/api, Prisma migrations vs local-web-dev.db, `op run` secrets. Disconnects beta bot from Discord while running.

## Marketing frontend — `packages/frontend` public pages

- scout-for-lol.com, Astro v6 static + React 19 islands + Tailwind v4 + MDX.
- Pages: index (landing), commands, docs, getting-started, support, whatsnew (changelog `data/changelog.tsx`), privacy/tos (MDX).
- Design system on base `Card.astro`; Hero/CTA/Navbar/Footer/SectionHeader/Button(+tracking)/WhatsNewBanner/etc. Tokens in `src/lib/colors.ts`. Beaufort/Spiegel, victory-gold/defeat-crimson palette. ESLint `no-shadcn-theme-tokens`.
- SEO: `SeoHead.astro` (canonical/OG/Twitter/JSON-LD), OG images via **astro-opengraph-images** (satori, `src/lib/og-template.tsx`). Tracking: Plausible (self-hosted) + Pinterest/Reddit pixels via `MarketingTracking.astro`, `get_started_click` conversion. Sentry → bugsink. Sitemap excludes `/app/*` and `/dev/*`.

## Session Log — 2026-07-06

### Done

- Ran three parallel Explore agents (report / web app / marketing) and synthesized a consolidated overview into a chat answer and this log.

### Remaining

- None requested. Possible follow-ups offered: deep-dive on review-tool LLM pipeline, satori internals, or how backend consumes `report/`.

### Caveats

- Overview assembled from Explore-agent reports; paths cited are main-checkout relative. Not independently re-verified line-by-line.
