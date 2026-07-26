---
id: log-2026-07-26-patched-deps-refresh
type: log
status: complete
board: false
---

# Patched-deps refresh: revive twisted champion patch, drop satori, add liveness check

## Context

Found during the docker-image-optimization PR (#1668) review cycle: bun applies
a `patchedDependencies` patch only when the resolved version exactly matches
the `name@version` key, so a routine dependency bump silently un-applies the
patch. Two entries had died this way:

- `twisted@1.73.0` (added champion ZAAHEN = 904) — dead since the lock moved
  to 1.81.0. No upstream twisted release (through 1.82.0) has ZAAHEN, so scout
  has been running WITHOUT the champion since the bump.
- `satori@0.18.3` — dead since satori 0.26.0; the diamond-centering problem it
  related to was later fixed in scout's report code (inline SVG shapes), so
  the patch is obsolete. User confirmed removal.

## Changes

- **twisted bumped ^1.73.0 → ^1.82.0** (scout root/data/backend manifests;
  1.82.0's runtime bundle is byte-identical to 1.81.0 — types-only release).
- **Regenerated `patches/twisted@1.82.0.patch`** via `bun patch` against the
  new single-bundle dist layout: adds `ZAAHEN = 904` and, per user request,
  the new champion `LOCKE = 805` (the Ashen Exorcist; ids confirmed against
  scout's in-repo Data Dragon assets) to both `dist/index.js` and
  `dist/index.d.ts`. Runtime-verified through scout's real import path:
  `Constants.Champions.ZAAHEN === 904`, `LOCKE === 805`,
  `getChampionName(904) === "ZAAHEN"`.
- **Deleted** `patches/satori@0.18.3.patch`, `patches/twisted@1.73.0.patch`
  and their manifest entries (both were no-ops at current resolutions, so
  zero runtime change from the deletions themselves).
- **New repo check `check-patched-deps`** (`scripts/check-patched-deps.ts`,
  wired into `verify` + turbo): every `patchedDependencies` key must match a
  resolved id in `bun.lock`, every referenced patch file must exist, and no
  orphan files may sit in `patches/`. The next Renovate bump of a patched dep
  now fails loudly instead of silently shedding the patch.

## Session Log — 2026-07-26

### Done

- twisted 1.82.0 bump + regenerated patch with ZAAHEN(904) + LOCKE(805),
  runtime-verified; satori patch removed; `check-patched-deps` added to
  verify; PR opened from `feature/patched-deps-refresh`.

### Remaining

- Scout will only fully handle Zaahen/Locke matches if the data-dragon assets
  are current — the `scout-data-dragon-weekly-refresh` schedule owns that
  (assets for both champions are already present in-repo).

### Caveats

- The patch is keyed to `twisted@1.82.0`; the new check makes the next twisted
  bump fail until the patch is regenerated — that is the intended behavior.
