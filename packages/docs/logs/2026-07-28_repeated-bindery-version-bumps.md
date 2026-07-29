---
id: log-2026-07-28-repeated-bindery-version-bumps
type: log
status: complete
board: false
---

# Repeated Bindery Version Bumps

## Finding

The repeated `chore: bump pending image versions` merges are an active
Bindery feedback loop, not duplicate GitHub webhook delivery.

Main has remained red, so each build correctly selects the accumulated image
work since last-green commit `55dfc50ce465200fc0eaad015dac4f5654cfdb53`.
Bindery is therefore rebuilt on each new main commit.

`packages/homelab/images/bindery/Dockerfile` compiles the current Buildkite
version and Git commit into the Go binary with linker flags. The image
no-change gate compares root filesystem DiffIDs. Every rebuild consequently
changes the final `/bindery` layer even when Bindery's sources and dependencies
are unchanged, records a new digest, and opens another generated pin PR. A
merged pin PR is itself another main commit, so the cycle repeats while the
last-green base remains old.

Registry inspection confirmed that the Bindery images from builds 6733, 6736,
6744, 6746, and 6749 have the same first 12 DiffIDs and a different final
DiffID. The Buildkite image outcome artifacts classified Bindery as `bumped`
in every one of those builds.

## Current State

- PR #1767 merged pins for Temporal and Bindery from build 6733.
- Its merge build 6736 produced another Bindery digest and opened #1768.
- Build 6744 refreshed #1768 with legitimate Temporal changes plus another
  Bindery digest.
- The #1768 merge build 6746 produced another Bindery-only digest and opened
  #1771.
- Build 6749 produced another Bindery-only digest and opened auto-merge PR
  #1772.
- PR #1772 was closed as metadata-only churn with a root-cause explanation.
- A replacement implementation now makes Bindery's embedded identity depend on
  upstream source plus the local patch instead of each Buildkite invocation.

No CI setting or live resource was changed during the diagnosis.

## Session Log — 2026-07-28

### Done

- Fetched current `origin/main` and identified generated merges #1767, #1768,
  and #1771.
- Correlated the generated pins with main builds 6733, 6736, 6744, 6746, and 6749.
- Downloaded the image outcome artifacts and confirmed repeated Bindery bumps.
- Compared the exact registry RootFS DiffIDs and isolated the changing final
  binary layer.
- Closed auto-merge PR #1772 as the next iteration of the feedback loop.
- Implemented the deterministic identity and verified that two builds with
  different `VERSION` and `GIT_SHA` inputs have identical 13-layer root
  filesystems.
- Passed all 217 tasks in the complete local `bun run verify` graph.
- Published the replacement as draft PR #1775 through git-spice.
- Confirmed Buildkite #6756 passed every executable lane; its only failure was
  a 1,200-second Codex review-provider timeout with zero recorded findings.

### Remaining

- Merge PR #1775 after its required current-head checks are green.
- After human merge, verify one legitimate pin bump, the following
  `content-unchanged` result, and the live rollout.

### Caveats

- Temporal's bumps in builds 6733 and 6744 were real source changes; the
  endlessly repeating member is Bindery.
- Skipping every generated pin merge in image selection is not automatically
  safe: a concurrent source commit could otherwise become part of a green
  snapshot without its image work running.
- The latest main build was still red during this diagnosis, so the cumulative
  last-green replay remains active.
- The first main build after the fix should create one legitimate Bindery pin
  bump because the embedded identity changes once.
- Buildkite #6756 is superseded because `origin/main` advanced before its
  provider timeout; the restacked replacement head is the authoritative PR
  signal.
