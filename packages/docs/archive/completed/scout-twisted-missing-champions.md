---
id: scout-twisted-missing-champions
type: todo
status: complete
board: false
origin: packages/docs/archive/completed/2026-07-11_fix-temporal-weekly-refreshes.md
---

# Bump twisted so scout recognizes Locke and Zaahen

The original follow-up assumed Scout needed Twisted's hard-coded champion enum
to recognize newly released champions. Scout no longer has that dependency for
champion identity or display data.

## Closure Evidence

- `packages/scout-for-lol/packages/data/src/data-dragon/images.ts` builds the
  authoritative champion ID-to-key map from the refreshed bundled
  `champion.json`, explicitly covering champions newer than Twisted's enum.
- `packages/scout-for-lol/packages/backend/src/utils/champion.ts` falls back to
  that map whenever Twisted lacks an ID.
- The committed Data Dragon assets include Locke and Zaahen, and tests assert
  that champion 805 resolves to Locke rather than a placeholder.

A future Twisted bump remains routine dependency maintenance, but it is no
longer required for Scout to recognize these champions.

## Comment Log

### 2026-07-27 — in-progress board audit

- Closed the stale version-watch task because the Data Dragon-backed runtime
  path supersedes the missing-enum failure mode.
