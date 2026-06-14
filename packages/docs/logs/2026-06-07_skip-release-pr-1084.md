# Skip release-please PR #1084

## Status

Complete

## Context

[PR #1084](https://github.com/shepherdjerred/monorepo/pull/1084) ("chore: release main") was a
release-please PR bumping three libraries as **no-op patch releases**:

- astro-opengraph-images 1.17.0 → 1.17.1
- webring 1.7.0 → 1.7.1
- helm-types (@shepherdjerred/helm-types) 1.3.0 → 1.3.1

The PR body itself noted there were no library behavior changes — the shipped code was identical to
the prior versions. The release was triggered only by a root CI-pipeline fix
([c0d3ff1](https://github.com/shepherdjerred/monorepo/commit/c0d3ff1eedfb305816f9770dcf5f99ee749ea596))
that release-please picked up. The user wanted to skip publishing these.

## Mechanism

Release-please is invoked in Dagger CI (`.dagger/src/release.ts`, ~L1102) with the standard
`release-please release-pr` and `release-please github-release` commands, so the normal
label-based skip mechanism applies:

- `github-release` only tags/publishes from **merged** release PRs → closing (not merging) means
  nothing is tagged or published to npm.
- Closing a release PR **without** snoozing causes release-please to recreate an identical PR on the
  next run for the same commits.
- The `autorelease: snoozed` label tells release-please to leave it closed until a new qualifying
  commit lands.

## Actions taken

1. Created the `autorelease: snoozed` repo label (did not previously exist; standard release-please
   label, now a permanent part of the workflow).
2. Swapped `autorelease: pending` → `autorelease: snoozed` on PR #1084.
3. Closed PR #1084 with an explanatory comment.

Verified: PR state `CLOSED`, label `autorelease: snoozed`.

## Session Log — 2026-06-07

### Done

- Closed + snoozed [PR #1084](https://github.com/shepherdjerred/monorepo/pull/1084); created the
  `autorelease: snoozed` label on `shepherdjerred/monorepo`.

### Remaining

- None. The deferred version bumps will roll into the next real release PR once a new
  `fix:`/`feat:` commit lands.

### Caveats

- A new permanent repo label `autorelease: snoozed` now exists.
- If a future change to these three packages should ship, a normal commit will produce a fresh
  release PR — no manual un-snooze is needed.
