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

## Session Log — 2026-05-30

### Done

- Added the web-gated `player` tRPC router and player/admin service helpers under `packages/scout-for-lol/packages/backend/src/lib/player-admin/`.
- Added audit actions for successful player and account web mutations.
- Added guild workspace routes for subscriptions, players, player detail, admin, and audit.
- Added subscription add-channel and move dialogs, with explicit domain result messages.
- Added player list/detail views and compact admin forms for player/account operations.
- Added focused backend tests for subscription add-channel/move and player admin mutations.
- Verified app typecheck, app build, app lint, backend typecheck, backend lint, and focused backend tests.
- Opened draft PR #980 from `codex/scout-web-ui-admin-basics`.
- Started Scout beta locally in the foreground with beta credentials and confirmed Vite plus backend startup; stopped it before ending the session because detached startup did not stay up cleanly in this environment.

### Remaining

- No local OAuth/browser smoke test was run; live Discord session validation remains a manual follow-up if desired.
- Detached beta local dev startup still needs a stable operator workflow if it should remain running after the agent session ends.

### Caveats

- The app production build succeeds but still emits the existing Vite warnings for `/app/init-theme.js` and large chunks.
- Standard `dev:web` startup and Prisma `migrate deploy`/`db push` hit a generic Prisma schema engine error locally, so beta startup used the generated test template database for verification.

## Session Log — 2026-05-31

### Done

- Addressed Greptile P1/P2 review feedback by adding cursor-backed player list pagination, collapsing the current linked player lookup to one query, and moving duplicate alias/account checks into transactional paths with Prisma unique-constraint handling.
- Addressed follow-up rename behavior by returning the expected `NOT_FOUND` path for missing source aliases and adding negative-path coverage.
- Addressed the final P1 account-removal race by rechecking the source account count inside the `deleteAccount` and `transferAccount` transactions.
- Added focused backend coverage for last-account delete and transfer failures without audit rows.
- Pushed fixes through commit `32f9002c9`; Buildkite build #3102 passed for that commit with only the requested-to-ignore Trivy soft failure.
- Confirmed PR #980 remained mergeable and all Greptile P3-or-higher review threads were resolved.

### Remaining

- PR #980 remains draft unless it should be marked ready manually.

### Caveats

- Buildkite soft failures were intentionally ignored per request.
