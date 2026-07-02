# Scout for LoL — Promote the Web App UI

## Status

Complete — shipped in PR #1265; Discord redirect-URI registration is an external operator step.

## Context

Scout's marketing site funneled every visitor into one flow: **Add to Discord → learn slash commands**. Scout now has a full **web dashboard** (the React SPA at `packages/scout-for-lol/packages/app/`: guild picker → subscriptions / competitions / reports / admin) that does everything the slash commands do behind a sleek UI. This change promotes that dashboard as the primary way to use Scout.

New onboarding flow: **sign in → add Scout to a server → return to the dashboard to configure it**. Slash commands become optional.

### Architecture

- **Marketing site** — Astro static, `packages/frontend/`.
- **Dashboard** — Vite + React Router SPA, `packages/app/`, basename `/app`.
- **Backend** — Bun `Bun.serve()` + tRPC, `packages/backend/`. OAuth HTTP routes in `src/http-server.ts` + `src/trpc/auth-web.ts`.
- **Serving** — marketing + SPA merge into one origin (`scout-for-lol.com`), Caddy SPA-falls-back `/app/*`. Marketing→app links are relative `/app/`.

### Decisions (from user)

1. **Dashboard-only CTAs** — all marketing "Add to Discord" buttons become "Get Started" → `/app/`. The bot invite now lives inside the app (guild picker), after login.
2. **UI screenshots: drive a browser** against the running dashboard to capture them.

## Part A — Redirect flow (DONE)

- `GET /api/discord/install` → 302 to Discord bot-authorize (`scope=bot applications.commands`, channel-posting permissions, `redirect_uri=${origin}/app/installed`). `handleDiscordInstall` in `auth-web.ts`; wired in `http-server.ts`.
- SPA `/app/installed` landing route (`app/src/routes/installed.tsx`) reads `guild_id` → deep-links `/g/<id>/subscriptions`, else falls back to guild picker. Registered in `app.tsx` under `RequireSession`.
- Guild picker (`guild-picker.tsx`): real "Add Scout to a server" button (empty state) + "Add another server" (populated).

## Part B — Marketing copy + CTA rewrite (DONE)

- `marketing-constants.ts`: `DISCORD_INVITE_URL` → `APP_DASHBOARD_URL="/app/"`; `DISCORD_INSTALL_CLICK_EVENT` → `GET_STARTED_CLICK_EVENT="get_started_click"`. Tracking machinery (Plausible/Pinterest/Reddit) updated in `MarketingTracking.astro`; `DiscordCtaLocation` type → `CtaLocation`.
- CTAs → "Get Started" → `/app/`: Navbar, mobile nav, index hero + final CTA, getting-started, docs, whatsnew.
- index "How it works" rewritten: Sign in → Add Scout → Configure in the dashboard.
- getting-started rewritten to lead with the UI; `/subscription add` walkthrough demoted to optional "Prefer slash commands?" section.
- docs: "Slash commands are optional" InfoBox; admin-permission note softened to mention the dashboard.
- privacy.mdx: tracked-button copy updated.

## Part C — Images (DONE)

- Captured the live dashboard UI by booting `dev:web` and driving a headed browser (PinchTab, `scout-e2e` profile already signed into Discord) through login → guild picker → subscriptions → add-subscription dialog → competition form. Seeded a real subscription via the UI (Faker / `Hide on bush#KR1` / KR → `#hall-of-fame`).
- Processed (auto-trim whitespace, downscale to 1600w, optimize PNG) into `frontend/public/`: `dashboard-add-subscription.png`, `dashboard-subscriptions.png`, `dashboard-competition.png`.
- Wired into: a new "Set it up from a sleek dashboard" showcase on `index.astro`, and `getting-started.astro` Step 3.
- **Not done (deferred):** refreshing/compressing the existing Discord-report images (`match.png` 3.26 MB, etc.) and pruning unreferenced assets — out of scope for promoting the UI; can be a follow-up.

## Discord Developer Portal (operator step — load-bearing for Part A)

Register `redirect_uri` on both apps or Discord rejects `invalid redirect_uri`:

- PROD `1182800769188110366` → `https://scout-for-lol.com/app/installed`
- BETA `1311755320745394317` → `https://beta.scout-for-lol.com/app/installed` + `http://localhost:5180/app/installed`

## Verification

1. `bun run --filter='./packages/scout-for-lol' typecheck` + per-package eslint. ✅ app/backend/frontend green.
2. Frontend build needs `PUBLIC_PINTEREST_TAG_ID` + `PUBLIC_REDDIT_PIXEL_ID` (CI-set; dummy values locally). ✅ 15 pages build.
3. Local e2e via `dev:web`: marketing `/` → Get Started → login → guild picker → Add Scout → install → `/app/installed?guild_id=…` → `/g/<id>/subscriptions`.
4. PR media: marketing screenshots + end-to-end flow recording.

## Session Log — 2026-06-19

### Done

- **Part A (flow):** `handleDiscordInstall` + `GET /api/discord/install` (`backend/src/trpc/auth-web.ts`, `http-server.ts`); `/app/installed` landing route (`app/src/routes/installed.tsx`, `app.tsx`); "Add Scout to a server" button in `guild-picker.tsx`. Commit `c54c3f924`.
- **Part B (copy):** dashboard-only CTAs, constant rename (`APP_DASHBOARD_URL`, `GET_STARTED_CLICK_EVENT`, `CtaLocation`), rewritten index/getting-started/docs/privacy. Commit `c54c3f924`.
- **Part C (images):** captured + processed 3 dashboard screenshots, wired into index showcase + getting-started Step 3. Commit `c0f7f4e40`.
- Verified: app/backend/frontend typecheck + eslint green; Astro build (15 pages) green with dummy `PUBLIC_*` pixel env; live dashboard flow exercised end-to-end via `dev:web` + headed browser.

### Remaining

- **Operator:** register `/app/installed` redirect URI on prod (`1182800769188110366`) and beta (`1311755320745394317`) Discord apps before the install leg works in prod/beta/local.
- Open the PR and attach media.
- Optional follow-up: refresh/compress the existing Discord-report images and prune unreferenced assets in `frontend/public/`.

### Caveats

- Analytics: the tracked conversion event was renamed `discord_install_click` → `get_started_click`; any Plausible/Pinterest/Reddit goals keyed on the old name need reconfiguring.
- The dashboard workspace header renders the raw guild ID (and briefly raw channel IDs until names resolve) — minor UI polish opportunity, visible in `dashboard-subscriptions.png`.
- Frontend build requires `PUBLIC_PINTEREST_TAG_ID` + `PUBLIC_REDDIT_PIXEL_ID` (CI-set); locally pass dummy values.

## Addendum — Marketing image regeneration (2026-06-19)

Follow-up on the same PR: regenerated **all** product imagery from the showcase pipeline, made `discover` fast, and added Discord-message composites.

### How to run the pipeline (local)

From `packages/scout-for-lol/packages/backend`, with `AWS_PROFILE=seaweedfs AWS_ENDPOINT_URL=https://seaweedfs.sjer.red`:

```bash
bun run discover:marketing-showcase --bucket scout-prod \
  --prev ../../showcase/marketing-showcase.manifest.json \
  --out  ../../showcase/marketing-showcase.manifest.json   # ~18s
bun run generate:marketing-showcase --bucket scout-prod \
  --manifest ../../showcase/marketing-showcase.manifest.json \
  --out ../../packages/frontend/public/generated/scout-showcase \
  --asset-index ../../packages/frontend/src/data/generated/scout-showcase-assets.json
```

### Key facts / gotchas

- **SeaweedFS public ingress (`seaweedfs.sjer.red`) 403s `HeadObject` and ranged GETs** but serves plain `GetObject`/`ListObjectsV2` fine. `discover` now reads object metadata via a plain `GetObject` + immediate body-cancel (`objectMetadata`). Any future S3 metadata reads against this endpoint must avoid HEAD/Range.
- **Fast discover design** (`discover-marketing-showcase.ts`): list newest-first, `GetObject` metadata until the frequent `solo-1`/`flex-1` combos are seen (early-exit) or `--max-head` (default 800); everything else (Arena, ARAM, multi-player, draft, rotating modes) is best-effort and **falls back to `--prev`** so `validateRequiredShowcaseCoverage` never regresses. ~104 reads / ~18s vs the old ~16K-HeadObject full scan (~30 min).
- **3 Discord composites** (`arena-discord`, `ranked-solo-discord`, `aram-discord`) are emitted from `src/showcase/discord-templates.ts` (curated chrome + chat; fresh report swapped in per run). They're in `REQUIRED_SHOWCASE_VARIANT_IDS`.
- **`generate` tolerates a missing `match.json`** (recent matches upload the report image first) via `readS3JsonOptional` — needed because `discover` picks the newest match, which may be mid-upload.
- `generate.ts` was at the 500-line cap; the graph generators were split into `competition-graph.ts` / `report-graph.ts` + shared `generate-types.ts` (510 → 260 lines).
- Marketing pages reference gallery assets via `getGeneratedScoutShowcaseAssetSrc(id)` (throws if not `generated`); the showcase grid covers Arena ×2 / Flex / Solo / ARAM. The 9 standalone `public/*.png|webp` were deleted; dashboard UI screenshots stay (not gallery-generatable).
