---
id: mario-kart-web-auth
status: deferred
origin: packages/docs/logs/2026-06-07_mario-kart-input-not-reaching-game.md
source_marker: true
---

# Mario Kart web controller — real authentication

The `login` request handler in
`packages/discord-plays-mario-kart/packages/backend/src/webserver/dispatch.ts`
returns a hardcoded cosmetic identity. Control is gated by seat ownership, not
identity, so this is not a security hole today — but real auth (e.g. Discord
OAuth) should replace the placeholder before identity is relied on for anything
that matters.
