---
id: reference-completed-2026-05-22-scout-web-ui-foundation
type: reference
status: complete
board: false
---

# Scout for LoL — Web UI Foundation (`scout-for-lol.com/app/`)

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

## Future work

Captured 2026-05-23 after end-to-end local verification (`bun run dev:web`). The web UI foundation works; these are the things we'd build on top once we have appetite.

### Bulk import sources (the original motivating problem)

The whole reason this plan existed was bulk onboarding. The foundation makes each of these a self-contained PR.

| Source                                                      | Verdict from feasibility research | Sketch                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **op.gg / U.GG / Mobalytics URL paste**                     | ✅ Smallest, biggest reach        | Textarea in the web UI accepting any mix of Riot IDs (`name#tag`) and op.gg URLs. Regex-parse URL → Riot ID + region → existing `resolveRiotIdToPuuid()`. Preview table with success/failure before commit; bulk-create via the existing `subscription.add` mutation in a Promise.allSettled.  |
| **Discord linked Riot account** (`connections` OAuth scope) | ⚠️ Self-claim only                | "Import my linked Riot account" button. Add `connections` to the OAuth scope set, call `GET /users/@me/connections`, find the `riotgames` entry, re-resolve the Riot ID through `account-v1/by-riot-id` (don't trust Discord's name field). Only adds the _operator's_ own account — not bulk. |
| **LCU friend-list import** (local Discord/LoL client)       | ✅ Viable, power-user             | Small Tauri/Go binary reads the LCU lockfile, hits `localhost:<port>/lol-chat/v1/friends`, dumps a JSON file (each entry contains PUUID directly — no second resolution). User uploads the file to the web UI. Shipping examples: `league-connect`, `ancient-chimes`, `Hextech Friends`.       |

### Web UI capability expansion

- **Roster diff / dry-run mode** — before any bulk import, show what _would_ change (added players, accounts grouped under existing aliases, channel routing).
- **Audit log UI improvements** — currently a JSON-payload table; build proper action-specific row renderers ("Alice added `Faker#KR1` to #general").
- **Per-channel routing controls** — drag-and-drop a player between channels in the roster grid instead of going through the move modal.
- **Notification preferences per player** — opt out of certain match types (ARAM-only, ranked-only, etc.). Schema change needed (`SubscriptionPreference` table).
- **Search + filter on the roster** — once a guild has 50+ subscriptions, the flat table breaks down. Add column filters and a search box.

### Auth / identity

- **Multi-guild operator UX** — current model gates per guild via Discord Administrator. Consider a richer permission system (read-only, add-only, full-admin) once we have demand.
- **Real session revocation** — JWTs are stateless today; if we add a revocation list (per-`jti`), rotation becomes graceful. Acceptable for v1 to just force re-login.
- **RSO (Riot Sign-On)** — needed if we ever want users to _prove_ PUUID ownership (self-service player claim). Gated behind Riot product approval; not v1.

### Platform / ops

- **CI build for `scout-app` image** — backend has a Dagger `buildScoutImageHelper`; the SPA Dockerfile exists but no CI job calls it. `versions.ts` still has `0.0.1-dev` placeholders. Wire a Dagger helper + Buildkite step so `scout-app:beta` and `scout-app:prod` get pushed to GHCR on merge.
- **Rate limiting on tRPC mutations** — no per-IP limits today; with public web UI this should be added before we go wide.
- **Replace in-memory guild cache with Redis** once we scale `replicas > 1`.
- **Metric: `scout_discord_guild_fetch_total`** — would catch a misconfig that blows up the Discord rate limit. Trivial Prometheus counter add.

### Migration off Discord commands

- **Phase-out plan for `/subscription *`** if and when the web UI reaches confidence parity. Audit data already covers both surfaces (Discord-command writes need instrumentation — small follow-up).
- **Discoverability** — add a `/scout` slash command that links to the web UI with a guild-pre-selected deep link.
