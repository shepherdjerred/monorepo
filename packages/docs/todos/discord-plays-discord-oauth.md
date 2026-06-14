---
id: discord-plays-discord-oauth
status: deferred
origin: packages/docs/logs/2026-06-13_new-todos-batch.md
source_marker: false
---

# Real Discord OAuth for the discord-plays web controllers (MK64 + Pokémon)

## What

Both discord-plays web controllers authenticate with a hardcoded, cosmetic
identity instead of a real login. Replace the placeholders with a real Discord
OAuth flow so the server derives identity from a verified session.

- **MK64** — `packages/discord-plays-mario-kart/packages/backend/src/webserver/dispatch.ts:75`
  returns `{ discordId: "id", discordUsername: "username" }`. Control is gated by
  **seat ownership** (`input/seat-manager.ts`), so identity is purely cosmetic
  today. Already tracked by source marker `TODO(todo:mario-kart-web-auth)` — see
  [mario-kart-web-auth.md](mario-kart-web-auth.md) for the MK64-specific detail.
- **Pokémon** — `packages/discord-plays-pokemon/packages/backend/src/index.ts:125`
  has the same placeholder (`// TODO: perform auth here`, returns the same
  constant). There is no seat concept; commands queue directly to the emulator,
  so identity is also cosmetic for now.

## Why it's open

Identity isn't load-bearing in either app yet, so this is not a security hole
today. But it must be real before identity is relied on for anything that
matters — per-user rate limiting, bans/abuse handling, attribution, or
leaderboards.

## Done when

- Both backends complete a real Discord OAuth flow and derive `discordId` /
  `discordUsername` from the verified session, not a constant.
- A shared OAuth helper is used across both backends if practical (they share the
  placeholder pattern).
- MK64's `TODO(todo:mario-kart-web-auth)` marker is removed and
  `mario-kart-web-auth.md` resolved in the same change.
