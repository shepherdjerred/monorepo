# Scout for LoL — Web UI Foundation (`scout-for-lol.com/app/`)

## Status

Complete (initial implementation; awaiting 1Password secrets + image-build CI wiring before deploy)

## Context

Today, every Scout subscription is created one at a time via `/subscription add` in Discord (and the four sibling commands). For a guild owner with a friend group of 10+, this is tedious — and reverting to Discord's UI for _every_ future edit isn't great either.

This plan delivers the **foundation** for a managed web UI at `scout-for-lol.com/app/`: Discord OAuth, JWT-based stateless sessions, per-guild Administrator gating, an audit log, a typed tRPC surface for subscriptions, and a React SPA that achieves parity with the existing Discord commands (list / add / delete / add-channel / move).

Out of scope for this plan: bulk-import sources (op.gg paste, Discord linked accounts, LCU helper). Those plug into this foundation in follow-up plans.

## Current state (from exploration)

**POC vs. core:** The existing `packages/frontend/` (match-review tool) and `soundPackRouter` + `ApiToken` table (desktop clients) are POC, not core product. The web UI in this plan is the first **core** web surface — design decisions should not be constrained by POC compatibility, but also shouldn't actively break the POC code while it lives in the tree.

| Concern               | Reality                                                                                                                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend HTTP          | `Bun.serve()` with tRPC fetch adapter in [http-server.ts](packages/scout-for-lol/packages/backend/src/http-server.ts). Health/metrics/`/trpc` routes. **Keep Bun.serve.**                                                                                                          |
| tRPC routers          | `auth`, `soundPack` (POC), `event` (POC), `user` in [router/index.ts:13-18](packages/scout-for-lol/packages/backend/src/trpc/router/index.ts)                                                                                                                                      |
| Existing auth (POC)   | Discord OAuth (`identify email` scopes) → SHA256-hashed Bearer token in `ApiToken` table, 7-day. Built for soundpack desktop clients. [auth.router.ts](packages/scout-for-lol/packages/backend/src/trpc/router/auth.router.ts) — reusable shape, but the cookie + JWT path is new. |
| OAuth callback URL    | Already hardcoded as `/app/callback` in `getRedirectUri()` — the slot we're filling.                                                                                                                                                                                               |
| Permission gate       | Discord `Administrator` (not Manage Guild) on every `/subscription` command — must mirror.                                                                                                                                                                                         |
| Ingress               | Cloudflare Tunnel routes the apex domain; no `/app/` ingress yet. CDK8s chart at [cdk8s-charts/scout.ts](packages/homelab/src/cdk8s/src/cdk8s-charts/scout.ts).                                                                                                                    |
| Naming collision risk | Prisma `Account` already exists for Riot accounts — keep auth-side models named `User` / `AuditLog`, never `Account`.                                                                                                                                                              |

## Architecture

```
Browser (https://scout-for-lol.com/app/)
       │
       ├──  static SPA bundle (Vite/React)         ←── new package: packages/app/
       │
       └──  /trpc/*  (Bun.serve + tRPC adapter)    ←── existing backend
                │
                ├── authRouter (extend: guilds scope, JWT mint)
                ├── subscriptionRouter (new) ─── mirrors /subscription * commands
                ├── guildRouter (new)        ─── lists user's admin guilds + channels
                │
                └── Prisma: User, ApiToken, Player, Account, Subscription,
                            + new AuditLog
```

**Why two servers, not one:** the React SPA is static — served by an nginx/Caddy sidecar (or Cloudflare Pages). The Bun backend exposes only `/trpc` and friends. Cloudflare Tunnel routes by path: `/app/*` → static, `/trpc/*` → backend. Same origin → SameSite=Strict cookies are viable.

## Auth design (the load-bearing part)

### 1. OAuth flow

| Step             | Where                     | Detail                                                                                                                                                                     |
| ---------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initiate         | SPA `/app/login`          | Calls existing `auth.getOAuthUrl` — **extend scopes to `identify email guilds`** so we can list manageable guilds without a second round-trip                              |
| Discord redirect | `/app/callback?code=...`  | SPA route reads `code`, calls new `auth.exchangeCodeWeb`                                                                                                                   |
| Token exchange   | Backend `exchangeCodeWeb` | Exchanges code → stores Discord access/refresh in `User` (existing pattern), then **mints a JWT**                                                                          |
| Session set      | Backend response          | Sets two cookies: `scout_session` (JWT, HttpOnly, Secure, SameSite=Strict, 7d) + `scout_csrf` (random token, JS-readable, SameSite=Strict, 7d). Returns user profile JSON. |
| Subsequent       | Browser → backend         | Cookie auto-attached; SPA reads `scout_csrf` and sends as `X-CSRF-Token` header on mutations                                                                               |

### 2. JWT contents (stateless)

```ts
{
  sub: discordId,
  iss: "scout-for-lol",
  iat, exp,              // 7d default
  jti: random,           // for revocation list if we ever add one
  ver: 1                 // schema version, lets us evolve claims
}
```

- **HS256** signed with `JWT_SIGNING_SECRET` (1Password, per env — beta/prod separate).
- No DB lookup for identity — `sub` is authoritative.
- Discord access/refresh tokens stay server-side in `User` (already there); we fetch them on demand for guild checks.

### 3. CSRF

Double-submit cookie + SameSite=Strict belt-and-braces:

- `scout_csrf` cookie (not HttpOnly, SameSite=Strict, 32-byte random per session).
- SPA reads it and sends `X-CSRF-Token: <value>` header on every mutating tRPC call.
- Server middleware (new `webProcedure`) verifies `X-CSRF-Token` matches the cookie value and the request `Origin` is `scout-for-lol.com`.
- Read-only queries do not require the CSRF header (so direct links / RSS-style use stays simple).

### 4. Per-guild authorization

On every guild-scoped mutation, server:

1. Resolves the user via JWT `sub`.
2. Loads `User.discordAccessToken`; if expired, refreshes via `discordRefreshToken`.
3. Calls Discord `GET /users/@me/guilds` (cached per-user, 5-minute TTL in memory) to get the user's guilds with their permission bitfield.
4. Asserts the target `guildId` is in that list AND `permissions & ADMINISTRATOR`.
5. Only then proceeds.

The cache is intentionally short so admin removal in Discord propagates quickly without being free.

### 5. Audit log

New Prisma model:

```prisma
model AuditLog {
  id              Int      @id @default(autoincrement())
  createdAt       DateTime @default(now())
  actorDiscordId  String                       // User.discordId
  serverId        String                       // guild
  action          AuditAction                  // enum
  targetChannelId String?
  targetPlayerId  Int?
  targetAccountId Int?
  payload         Json                         // before/after snapshot
  ipAddress       String?
  userAgent       String?
  @@index([serverId, createdAt])
  @@index([actorDiscordId, createdAt])
}

enum AuditAction {
  SUBSCRIPTION_ADD
  SUBSCRIPTION_REMOVE
  SUBSCRIPTION_ADD_CHANNEL
  SUBSCRIPTION_MOVE
  PLAYER_CREATE
}
```

Every web-initiated mutation writes a row. Discord-command mutations _also_ get instrumented (small follow-up, same table) so the log is the source of truth, not split.

## tRPC surface (new)

### `subscriptionRouter` (mirrors Discord commands 1:1)

| Procedure    | Input                                                           | Behavior                                                                                                 |
| ------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `list`       | `{ guildId }`                                                   | Admin-gated. Returns Player+Account+Subscription rows for the guild.                                     |
| `add`        | `{ guildId, channelId, region, riotId, alias, discordUserId? }` | Calls the same `add-helpers.ts` resolution + limit-check path the Discord command uses. Writes AuditLog. |
| `remove`     | `{ guildId, alias, channelId }`                                 | Mirror of `/subscription delete`.                                                                        |
| `addChannel` | `{ guildId, alias, channelId }`                                 | Mirror of `/subscription add-channel`.                                                                   |
| `move`       | `{ guildId, alias, fromChannelId, toChannelId }`                | Mirror of `/subscription move`.                                                                          |

**Critical:** factor the existing command bodies in `discord/commands/subscription/*.ts` so the _business logic_ (resolve PUUID, limit check, write rows) is shared between Discord and tRPC. Don't reimplement.

### `guildRouter` (new — minimal)

| Procedure        | Input         | Behavior                                                                                  |
| ---------------- | ------------- | ----------------------------------------------------------------------------------------- |
| `listManageable` | —             | Returns user's guilds filtered to Administrator AND where Scout bot is present.           |
| `listChannels`   | `{ guildId }` | Returns text channels visible to the bot (so we don't show channels Scout can't post to). |

## Web UI scope (parity, not bulk)

| Page                    | Behavior                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/app/login`            | "Sign in with Discord" button → OAuth                                                                                                                                |
| `/app/callback`         | Exchange code → set cookies → redirect to `/app/`                                                                                                                    |
| `/app/`                 | Guild picker (from `guild.listManageable`). Empty state if none.                                                                                                     |
| `/app/g/:guildId`       | Subscriptions table for the guild. Columns: alias, Riot ID, region, channel, creator. Row actions: remove, add-channel, move. Top-right: "Add subscription" → modal. |
| `/app/g/:guildId/audit` | Last 100 audit entries for the guild.                                                                                                                                |

Bulk add / op.gg paste / LCU import are **deliberately deferred** to future plans.

## Files to add / change

**New package:** `packages/scout-for-lol/packages/app/` — Vite + React 18 + React Router. Same monorepo conventions as the existing frontend package (TypeScript strict, Zod for client-side parsing, tRPC client typed off `@scout-for-lol/backend`).

**New backend files:**

- `backend/src/trpc/router/subscription.router.ts` — new, calls into refactored helpers
- `backend/src/trpc/router/guild.router.ts` — new, Discord guild/channel listing with per-user cache
- `backend/src/trpc/jwt.ts` — sign/verify, using `jose` (already an indirect dep — verify, else add)
- `backend/src/trpc/web-procedure.ts` — middleware that validates JWT cookie + CSRF header + Origin
- `backend/prisma/schema.prisma` — add `AuditLog` model + `AuditAction` enum + index
- `backend/src/audit.ts` — `recordAudit({ action, actor, ...})` helper used by both Discord and tRPC paths

**Refactors (extract, don't duplicate):**

- `backend/src/discord/commands/subscription/add-helpers.ts` → split into `lib/subscription/{resolve,create,limits}.ts`; commands and tRPC both import these
- Same for `delete.ts`, `move.ts`, `add-channel.ts`

**Auth router additions:**

- `auth.router.ts`: add `exchangeCodeWeb` (returns nothing — sets cookies via response headers), `logout` (clears cookies + revocation entry if we add a list later), `me` (returns the JWT-decoded user + guild summary). The POC `exchangeCode` for desktop clients stays untouched so the soundpack POC isn't broken.
- Bump OAuth scope set to include `guilds` for the web flow. The POC flow keeps its current scopes.

**Infrastructure:**

- `packages/homelab/src/cdk8s/src/cdk8s-charts/scout.ts` — add a static-site Deployment + Service for the SPA bundle, and a Cloudflare Tunnel route mapping `scout-for-lol.com/app/*` → static, `/trpc/*` → backend
- 1Password: new `JWT_SIGNING_SECRET` item per env, plumbed via the existing `OnePasswordItem` pattern

## Verification

End-to-end checks the implementation must pass before merge:

1. **Auth happy path:** load `/app/` while logged out → redirected to Discord → returned to `/app/`, cookies set, guilds visible.
2. **Cross-guild guard:** with browser DevTools, attempt `subscription.add` against a `guildId` the user is _not_ admin of — must 403, must write nothing, must record nothing.
3. **CSRF guard:** craft a mutation request from a different origin (curl with cookies but no `X-CSRF-Token`) — must 403.
4. **Parity:** add a subscription via the web UI, then run `/subscription list` in Discord — must appear. And vice versa.
5. **Permission churn:** in a test guild, remove the user's Administrator role, wait 5 minutes (cache TTL), refresh `/app/g/:guildId` — must drop out of `listManageable`.
6. **Audit log:** every successful mutation writes a row; querying the audit table shows actor + before/after snapshot.
7. **Refresh path:** force `User.tokenExpiresAt` into the past in the DB, hit any guild endpoint — backend refreshes the Discord token transparently.
8. **Static + dynamic routing:** `curl -I https://scout-for-lol.com/app/` returns the SPA HTML; `curl -I https://scout-for-lol.com/trpc/auth.me` hits the backend.
9. **Typecheck + lint:** `bun run typecheck` and `bunx eslint .` clean across `backend/`, `app/`, and any touched packages.

## Risks and call-outs

- **Discord rate limits on `/users/@me/guilds`** — the 5-minute per-user cache plus the small expected user base makes this fine, but worth a metric (`scout_discord_guild_fetch_total`) so we'd notice if a misconfig blows it up.
- **JWT secret rotation** — HS256 means rotation invalidates outstanding sessions. Acceptable for v1 (force re-login). If we want graceful rotation later, move to a JWKS with `kid`.
- **Cookies + Cloudflare Tunnel** — verify CF Tunnel preserves `Set-Cookie` (it does, but Strict + Secure can surprise on local dev — document `localhost` flow).
- **POC code coexistence.** The Astro `frontend/` and `soundPackRouter` are POC and not core product, but they're still in-tree. Don't break them — the new cookie + JWT path lives next to the existing Bearer path. Future cleanup (removing the POC paths) is a separate plan.
- **AuditLog volume** — guild changes are low-frequency, but add the `(serverId, createdAt)` index up front anyway.

## What's explicitly deferred (out of scope)

- Bulk import via op.gg / U.GG / Mobalytics URLs
- Discord linked-account ("connections" scope) self-import
- LCU friend-list desktop helper
- Removing or migrating the POC Astro frontend / soundPack / event / desktop-client paths
- Deprecating the `/subscription *` Discord commands (keep both)

## Session Log — 2026-05-22

### Done

- Refactored subscription business logic into [`backend/src/lib/subscription/`](packages/scout-for-lol/packages/backend/src/lib/subscription/) (resolve, limits, add, remove, move, add-channel, list) so Discord commands and tRPC share the same code path; deleted the old `add-helpers*.ts` files
- Updated all five Discord command files under [`backend/src/discord/commands/subscription/`](packages/scout-for-lol/packages/backend/src/discord/commands/subscription/) to be thin adapters over the new lib
- Added `AuditLog` model + indexes to [`backend/prisma/schema.prisma`](packages/scout-for-lol/packages/backend/prisma/schema.prisma) and a `recordAudit` helper at [`backend/src/lib/audit/index.ts`](packages/scout-for-lol/packages/backend/src/lib/audit/index.ts); regenerated branded Prisma types
- JWT sign/verify via `jose` at [`backend/src/trpc/jwt.ts`](packages/scout-for-lol/packages/backend/src/trpc/jwt.ts) with HS256 + `JWT_SIGNING_SECRET` env
- Cookie + CSRF + Origin web middleware in [`backend/src/trpc/trpc.ts`](packages/scout-for-lol/packages/backend/src/trpc/trpc.ts) (`webProcedure` for reads, `webMutationProcedure` for state changes); context parses cookies in [`backend/src/trpc/context.ts`](packages/scout-for-lol/packages/backend/src/trpc/context.ts)
- HTTP-level OAuth callback + logout routes at [`backend/src/trpc/auth-web.ts`](packages/scout-for-lol/packages/backend/src/trpc/auth-web.ts) wired into [`backend/src/http-server.ts`](packages/scout-for-lol/packages/backend/src/http-server.ts) (cookies + redirect happen outside tRPC so the response can write `Set-Cookie` cleanly). Same-origin CORS now echoes the configured web origin and allows credentials.
- New [`backend/src/trpc/router/guild.router.ts`](packages/scout-for-lol/packages/backend/src/trpc/router/guild.router.ts) and [`subscription.router.ts`](packages/scout-for-lol/packages/backend/src/trpc/router/subscription.router.ts) (both gated by `assertGuildAdmin` from [`backend/src/trpc/guild-guard.ts`](packages/scout-for-lol/packages/backend/src/trpc/guild-guard.ts)); guild-admin lookups go through [`backend/src/lib/discord-rest.ts`](packages/scout-for-lol/packages/backend/src/lib/discord-rest.ts) with token refresh and a 5-minute in-memory cache
- `auth.getWebOAuthUrl` and `auth.meWeb` added to the existing auth router
- New SPA package at [`packages/scout-for-lol/packages/app/`](packages/scout-for-lol/packages/app/) — Vite + React 19 + React Router + TanStack Query + tRPC tanstack adapter. Routes: `/login`, `/`, `/g/:guildId`, `/g/:guildId/audit`. Session guard at [`require-session.tsx`](packages/scout-for-lol/packages/app/src/routes/require-session.tsx). Add-subscription dialog at [`add-subscription-dialog.tsx`](packages/scout-for-lol/packages/app/src/components/add-subscription-dialog.tsx). tRPC client at [`lib/trpc.ts`](packages/scout-for-lol/packages/app/src/lib/trpc.ts) reads `scout_csrf` cookie and sends `X-CSRF-Token` on mutations; all requests use `credentials: "include"`.
- SPA Dockerfile at [`packages/app/Dockerfile`](packages/scout-for-lol/packages/app/Dockerfile) (Bun build stage → Caddy serve stage)
- CDK8s resource [`homelab/src/cdk8s/src/resources/scout/app.ts`](packages/homelab/src/cdk8s/src/resources/scout/app.ts) provisions the Caddy + SPA Deployment, Service, and Cloudflare TunnelBinding (`scout-for-lol.com` for prod, `scout-for-lol-beta.sjer.red` for beta) with the Caddyfile served via ConfigMap and reverse-proxy rules for `/trpc/*` and `/api/*` to the scout backend
- [`homelab/src/cdk8s/src/cdk8s-charts/scout.ts`](packages/homelab/src/cdk8s/src/cdk8s-charts/scout.ts) now also creates `createScoutAppDeployment` and broadens NetworkPolicy to allow same-namespace + CF tunnel ingress
- Backend deployment env updated with `JWT_SIGNING_SECRET`, `DISCORD_CLIENT_SECRET`, `WEB_APP_ORIGIN` from the existing 1Password item
- New version entries for `shepherdjerred/scout-app/{beta,prod}` in [`homelab/src/cdk8s/src/versions.ts`](packages/homelab/src/cdk8s/src/versions.ts)
- Fixed 2 pre-existing `Set<LeaguePuuid>.has(string)` branding bugs that the SPA's stricter cross-package typecheck surfaced (widened to `Set<string>`) in [`helpers.ts`](packages/scout-for-lol/packages/backend/src/league/competition/processors/helpers.ts) and [`exceptional-game.ts`](packages/scout-for-lol/packages/backend/src/league/tasks/postmatch/exceptional-game.ts)
- Verification: `bun run typecheck` clean across backend, app, and homelab/cdk8s; `bunx eslint` clean across all touched files; `bun test` 913 pass / 0 fail in backend; SPA Vite build emits 314 KB JS (97 KB gz)

### Remaining

- **1Password secrets to add** (cannot be created from this session — they live in the existing scout vault items at `vaults/v64ocnykdqju4ui6j6pua56xw4/items/{beta,prod}`): `JWT_SIGNING_SECRET` (≥32 random chars) and `DISCORD_CLIENT_SECRET` (paste from Discord app dashboard for each app id). Without these the backend will refuse to mint sessions.
- **Build the scout-app container image and publish to ghcr.io.** Versions currently set to placeholder `0.0.1-dev`. Once the CI pipeline knows how to build `packages/scout-for-lol/packages/app/Dockerfile`, swap to real image digests via the existing version-commit-back flow.
- **CF Tunnel ingress configuration**: confirm the cluster's CF Tunnel allows `scout-for-lol.com` (apex) and `scout-for-lol-beta.sjer.red`. The TunnelBinding is created with `disableDnsUpdates: true` because the apex DNS for scout-for-lol.com is managed in OpenTofu — verify that pointer still routes correctly.
- **Add OAuth redirect URI** in the Discord Developer Portal for both apps: `https://scout-for-lol.com/api/auth/discord/callback` (prod) and `https://scout-for-lol-beta.sjer.red/api/auth/discord/callback` (beta).
- Apply the Prisma migration in beta + prod (db push will pick up the new `AuditLog` table).

### Caveats

- **Cross-package typecheck quirk**: the SPA's tsc traverses backend source via the `AppRouter` type import and applies slightly different inference than backend's own tsc — it caught 2 pre-existing branding bugs that backend's tsc missed. Both are now fixed, but if you add a new `Set<BrandedType>` anywhere in backend, the SPA typecheck may flag `.has(rawString)` errors. Use `Set<string>` for the lookup helper and keep branding on the values themselves.
- **Custom rules**: barrel re-exports (`export * from`, `export { X } from`) are banned by `custom-rules/no-re-exports`. The subscription lib has no `index.ts` — import each file directly. Parent imports (`../`) are also banned; use `#src/` aliases from `package.json#imports`.
- **POC paths still in tree**: the soundpack/desktop-client `auth.exchangeCode` (Bearer-token model) coexists with the new cookie+JWT web flow. Removing them is a separate plan; for now the two auth shapes live side-by-side in `auth.router.ts` and `context.ts`.
- **In-memory guild cache**: per-user `fetchUserGuilds` cache is per-pod, 5 min TTL. With a single backend replica this is fine; if we ever scale `replicas: 1 → 2+`, switch to Redis or set replica affinity.
- **CSRF defense relies on SameSite=Strict + double-submit cookie + Origin check**. Browsers without strict same-site (very old) will still be safe via the explicit Origin verification and CSRF header check.
