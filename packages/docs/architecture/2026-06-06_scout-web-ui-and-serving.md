# Scout-for-LoL Web UI & S3/Caddy Serving

Two front-end surfaces (a marketing Astro site and a Vite React SPA) are built into one bucket per stage and served by a shared S3-proxy Caddy that reverse-proxies `/api` + `/trpc` to the Scout backend.

## Two front-end surfaces

Both live as Bun workspaces under `packages/scout-for-lol/packages/`:

| Surface        | Package     | Tech                             | Served at  | Purpose                                                  |
| -------------- | ----------- | -------------------------------- | ---------- | -------------------------------------------------------- |
| Marketing site | `frontend/` | Astro + React + Tailwind v3      | `/` (apex) | Public landing/marketing pages                           |
| Management SPA | `app/`      | Vite + React 19 SPA, Tailwind v4 | `/app/`    | Authenticated guild/subscription/player/admin management |

The SPA (`packages/app/`, name `@scout-for-lol/app`) uses React Router v7 with `BrowserRouter basename="/app"` (`src/main.tsx`), tRPC + TanStack Query against the backend (`src/lib/trpc.ts`), and Vite `base: "/app/"` so assets emit under `/app/assets/` (`vite.config.ts`). It is a peer of the marketing site, not nested inside it at build time — they are merged only at deploy.

### Distinct design system (hard constraint)

The SPA's visual design is intentionally **separate** from the marketing site. Shared _dependencies_ (Tailwind, Radix, lucide-react) are fine; shared _visual tokens_ are never. The SPA defines its own neutral shadcn-style tokens in `packages/app/src/styles/global.css` (`@theme inline` + `:root`/`.dark` CSS vars, `@custom-variant dark`), with shadcn primitives copied into `packages/app/src/components/ui/`. The marketing site (`frontend/`) conversely bans shadcn theme tokens via the `no-shadcn-theme-tokens` ESLint rule and uses explicit Tailwind colors. Do not cross-import components or tokens between the two trees.

## Merged build (`scripts/build-bucket.ts`)

A single bucket must contain both surfaces, because the CI deploy runs `aws s3 sync --delete` and would otherwise wipe whichever half is missing. `packages/scout-for-lol/scripts/build-bucket.ts`:

1. Builds the Astro marketing site → `packages/frontend/dist/`
2. Builds the Vite SPA → `packages/app/dist/`
3. `cp -R` the SPA into `packages/frontend/dist/app/`
4. Fail-fast asserts both `dist/index.html` and `dist/app/index.html` exist (and that the SPA index isn't suspiciously small) before any sync runs

Final layout in `packages/frontend/dist/`: marketing at `/`, SPA at `/app/`. That `dist` is the `distDir` the CI deploy syncs.

## Prod vs beta bucket fan-out

Registered in `scripts/ci/src/catalog.ts`, both stages run the same `bun run scripts/build-bucket.ts` from `packages/scout-for-lol`:

| Bucket                | Hostname                 | Analytics env                                                             |
| --------------------- | ------------------------ | ------------------------------------------------------------------------- |
| `scout-frontend`      | `scout-for-lol.com`      | real `PUBLIC_PINTEREST_TAG_ID` / `PUBLIC_REDDIT_PIXEL_ID`                 |
| `scout-frontend-beta` | `beta.scout-for-lol.com` | placeholder pixel IDs so beta traffic never inflates prod conversion data |

The `scout-for-lol` package maps to **both** buckets (`scout-frontend`, `scout-frontend-beta`) — any change fans out to both on every main merge (most other packages map to a single bucket).

## Serving layer: caddy-s3proxy + s3-static-sites chart

A single shared Caddy deployment (`s3-static-sites` chart) serves all static sites from SeaweedFS, including both Scout stages. There is **no** dedicated in-cluster Caddy for Scout — an earlier per-app Caddy was deleted in favor of this shared pattern (`archive/completed/2026-05-24_scout-app-s3-caddy-migration.md`).

- **Image** (`.dagger/src/image.ts`, `buildCaddyS3ProxyImageHelper`): a two-stage build where `xcaddy` compiles a custom Caddy binary with `github.com/shepherdjerred/caddy-s3-proxy@v0.5.7-head1` (a fork of lindenlab's module kept at the same import path; adds native HEAD support and fixes a 304-on-index regression), pushed as `ghcr.io/shepherdjerred/caddy-s3proxy`.
- **Deployment / Caddyfile generation**: `packages/homelab/src/cdk8s/src/misc/s3-static-site.ts` (`generateCaddyfile`, `S3StaticSites` construct). The Caddyfile is rendered into a ConfigMap, hashed into a pod annotation to force rollout on change, and the container reads S3 creds from `seaweedfs-s3-credentials`. S3 endpoint `https://seaweedfs.sjer.red`, `force_path_style`.
- **Per-site config**: `packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts`. Cloudflare Tunnel binds each hostname to the shared Service; DNS records are OpenTofu-managed (`src/tofu/cloudflare/`).

### Per-Scout-site Caddy routing (both prod and beta)

Each Scout host in `sites.ts` declares, in `handle`-block order (longest path first, so narrow routes aren't shadowed):

- `reverseProxies`: `/api/healthz` (rewritten to `/healthz`), `/trpc*`, and `/api/*` → the backend Service `scout-service-{prod,beta}.scout-{prod,beta}.svc.cluster.local:3000` (cross-namespace, `round_robin`). Same-origin so cookies (`SameSite=Strict`, CSRF) work.
- `spaFallbacks`: `/app/*` → `/app/index.html`, so SPA deep links (e.g. `/app/g/123/audit`) survive a hard refresh instead of 404-ing on a missing bucket key.
- `handle {}` (catch-all) → `s3proxy` against the bucket for everything else (the marketing site and SPA static assets).
- `responseHeaders`: a per-app CSP (`scoutCsp`) on top of the defense-in-depth `defaultResponseHeaders` (HSTS, nosniff, `X-Frame-Options: DENY`, etc.). `script-src 'self'` is why first-paint dark-mode init lives in `/app/init-theme.js` rather than inline.
- `probes`: blackbox probes for `/app/` and `/api/healthz` in addition to the implicit root probe.

A `@noTrailingSlash` redirect matcher explicitly **excludes** the proxy and SPA-fallback paths, so the trailing-slash 301 doesn't break `/api/healthz` probes or proxy rewrites.

## Backend, auth, and admin surface

The SPA talks to the Scout backend (`packages/backend`, Discord.js + Prisma + twisted) over the same origin. The backend is `Bun.serve()` in `packages/backend/src/http-server.ts`, exposing `/healthz`, `/metrics`, `/trpc*`, and the web-auth routes `/api/auth/discord/start`, `/api/auth/discord/callback`, `/api/auth/logout`.

- **Auth**: Discord OAuth → cookie-based web session (distinct from the legacy `ApiToken` Bearer flow used by desktop soundpack clients). `RequireSession` (`packages/app/src/routes/require-session.tsx`) guards every route except `/login` via `trpc.auth.meWeb`, redirecting unauthenticated users to `/login?returnTo=…`. The tRPC client attaches the `scout_csrf` cookie as an `X-CSRF-Token` header and sends `credentials: "include"` (`src/lib/trpc.ts`). Per-guild access is gated on Discord **Administrator**, mirroring the `/subscription` commands.
- **Routes** (`packages/app/src/app.tsx`): `/login`; guild picker at `/`; and a `GuildWorkspace` at `/g/:guildId` with nested `subscriptions`, `players`, `players/:alias`, `admin`, and `audit` tabs.
- **Admin basics**: the `AdminTools` route (`src/routes/admin-tools.tsx`) renders player + account admin forms backed by web-gated `player`/`subscription` tRPC procedures; successful admin mutations write audit rows surfaced in the `audit` tab. Auth-side Prisma models are named `User`/`AuditLog` (never `Account`, which is reserved for Riot accounts).

## Key file map

- SPA: `packages/scout-for-lol/packages/app/` (`vite.config.ts`, `index.html`, `src/main.tsx`, `src/app.tsx`, `src/lib/trpc.ts`, `src/routes/`, `src/styles/global.css`)
- Marketing: `packages/scout-for-lol/packages/frontend/` (Astro)
- Merge build: `packages/scout-for-lol/scripts/build-bucket.ts`
- Deploy registry: `scripts/ci/src/catalog.ts`
- Caddy image: `.dagger/src/image.ts` (`buildCaddyS3ProxyImageHelper`)
- Caddyfile gen: `packages/homelab/src/cdk8s/src/misc/s3-static-site.ts`
- Per-site routing: `packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts`
- Backend HTTP: `packages/scout-for-lol/packages/backend/src/http-server.ts`, `src/trpc/router/`
