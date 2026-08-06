---
id: reference-completed-2026-05-30-scout-web-ui-admin-basics
type: reference
status: complete
board: false
---

# Scout Web UI: Subscription, Player, and Admin Basics

## Summary

Build functional web UI coverage for Scout's subscription, one-player lookup, and admin player/account management surfaces. This extends the existing `/app/` foundation rather than replacing the Discord commands.

## Planned Work

- Complete subscription parity by exposing add-channel and move actions in the React UI.
- Add web-gated tRPC procedures for player listing/detail, current linked player lookup, and admin mutations.
- Add guild workspace routes for subscriptions, players, player detail, admin tools, and audit log.
- Record audit rows for successful web admin mutations.

## Verification

- `bun run --filter='./packages/scout-for-lol/packages/app' typecheck`
- `bun run --filter='./packages/scout-for-lol/packages/app' build`
- `bun run --filter='./packages/scout-for-lol/packages/backend' typecheck`
- Focused backend tests for the new router where feasible.
- Relevant ESLint checks for touched files.
