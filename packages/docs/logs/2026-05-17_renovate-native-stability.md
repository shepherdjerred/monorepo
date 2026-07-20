---
id: log-2026-05-17-renovate-native-stability
type: log
status: complete
board: false
---

# Renovate Native Stability Gating

## Summary

Backed out the Buildkite-side Renovate stability skip and configured Renovate's
native `internalChecksFilter=strict` behavior explicitly. Renovate's official
minimum release age docs recommend this setting with `minimumReleaseAge` so
updates that have not passed `renovate/stability-days` do not create branches
or PRs.

## Session Log -- 2026-05-17

### Done

- Removed the uncommitted Buildkite guard files from `scripts/ci/src/`.
- Restored `scripts/ci/src/main.ts` to the normal catalog validation, change
  detection, and pipeline generation flow.
- Added top-level `"internalChecksFilter": "strict"` to `renovate.json`.
- Removed the now-superseded Buildkite stability skip plan document.
- Fetched the official Renovate minimum release age docs with `toolkit fetch`
  and validated `renovate.json` with Renovate's config validator.
- Published draft PR #842 from branch `codex/renovate-native-stability`.

### Remaining

- Watch the next Renovate run to confirm pending minimum-release-age updates
  stay in the Dependency Dashboard instead of opening PRs.

### Caveats

- Renovate docs note that `internalChecksFilter=strict` is the default, but this
  config now makes the intended behavior explicit in-repo.
