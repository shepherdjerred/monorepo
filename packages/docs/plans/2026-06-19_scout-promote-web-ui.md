# Scout for LoL — Promote the Web App UI

## Status

In Progress

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

## Part C — Images (TODO, collaborative)

- Inventory in `frontend/public/`: `match.png` (3.26 MB, compress), `solo-discord.png`, `leaderboard-lp.png`, `generated/scout-showcase/*` (regenerate via `backend/src/showcase/generate.ts`), unreferenced assets to prune, `discord-preview.png` (137 B placeholder).
- **New dashboard screenshots** (guild picker, subscriptions, competition setup) captured by driving a browser against `dev:web`, wired into getting-started + index + a new UI showcase block.

## Discord Developer Portal (operator step — load-bearing for Part A)

Register `redirect_uri` on both apps or Discord rejects `invalid redirect_uri`:

- PROD `1182800769188110366` → `https://scout-for-lol.com/app/installed`
- BETA `1311755320745394317` → `https://beta.scout-for-lol.com/app/installed` + `http://localhost:5180/app/installed`

## Verification

1. `bun run --filter='./packages/scout-for-lol' typecheck` + per-package eslint. ✅ app/backend/frontend green.
2. Frontend build needs `PUBLIC_PINTEREST_TAG_ID` + `PUBLIC_REDDIT_PIXEL_ID` (CI-set; dummy values locally). ✅ 15 pages build.
3. Local e2e via `dev:web`: marketing `/` → Get Started → login → guild picker → Add Scout → install → `/app/installed?guild_id=…` → `/g/<id>/subscriptions`.
4. PR media: marketing screenshots + end-to-end flow recording.
