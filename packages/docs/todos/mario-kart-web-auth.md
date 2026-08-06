---
id: mario-kart-web-auth
type: todo
status: planned
board: true
verification: agent
disposition: active
source_marker: true
---

# Mario Kart web controller — real authentication

The `login` request handler in
`packages/discord-plays-mario-kart/packages/backend/src/webserver/dispatch.ts`
returns a hardcoded cosmetic identity. Control is gated by seat ownership, not
identity, so this is not a security hole today — but real auth (e.g. Discord
OAuth) should replace the placeholder before identity is relied on for anything
that matters.

Canonical implementation scope is tracked in
`packages/docs/todos/discord-plays-discord-oauth.md`. This child remains solely
because the unresolved source marker requires a matching todo document.

## Remaining

- [ ] Complete the MK64 portion of `discord-plays-discord-oauth`, remove `TODO(todo:mario-kart-web-auth)` from `dispatch.ts`, then mark and archive this child in the same change.

## Comment Log

- 2026-07-27 — Consolidated duplicate implementation scope into
  `discord-plays-discord-oauth`; retained this narrow child to preserve the
  source-marker invariant until implementation removes the marker.
