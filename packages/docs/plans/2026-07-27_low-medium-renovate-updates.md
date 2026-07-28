---
id: low-medium-renovate-updates-2026-07-27
type: plan
status: in-progress
board: false
---

# Low- and Medium-Effort Renovate Updates

## Goal

Clear the executable XS, S, and M dependency backlog without pulling in the
blocked or dedicated L/XL migrations.

## Included Updates

- Dashboard reconciliation: confirm the nginx digest entry has no active source
  pin, and finish the remaining Emscripten v6 metadata migration.
- Low-risk dependencies: React 19.2.8, release-please 17.10.4, Rust 1.97.1,
  pinned Docker bases, Playwright 1.62.0, and Knip 6.29.0.
- Medium runtime/tooling changes: Claude Agent SDK 0.3.220, TypeScript ESLint
  8.65.0, Anthropic SDK 0.115.0, tslog 5, the GitHub MCP server replacement,
  and Worklets 0.11 with its compatible Reanimated update.
- Operational updates: BuildKit 0.31.2, Scout and Starlight production
  promotions, and Seerr 3.4.0.

## Exclusions

- Leave every upstream-blocked dashboard entry visible and unchanged.
- Defer Babel, Astro, Gesture Handler, Satori, Chevrotain, OpenAI, Temporal,
  OpenTelemetry, node-av, fluent-ffmpeg, Unicorn, postgres-operator, and the
  Discord selfbot replacement.
- Do not create source changes for stale dashboard entries with no active
  repository pin.

## Implementation

1. Re-verify every requested target against current `main` and upstream package
   constraints; drop stale/no-op entries from the source diff.
2. Apply coherent dependency sets and refresh the single root lockfile.
3. Fix forward for compilation, typing, linting, native, and runtime contract
   changes without suppressions.
4. Apply operational pins only with immutable tags/digests and validate their
   deployment-specific safety surfaces.
5. Run focused checks throughout and finish with affected repository
   verification.
6. Commit intended files only, publish a draft git-spice PR, and record exact
   completed and deferred work.

## Acceptance Criteria

- Every included executable update is either landed in the diff or documented
  with current evidence that it is already complete or no longer applicable.
- The root lockfile passes a frozen install.
- Runtime SDK and native changes have focused behavior tests in addition to
  typechecking.
- Production promotions preserve the repository's minted-tag/digest invariants.
- Affected verification passes with no skipped or weakened quality gates.

## Session Log — 2026-07-27

### Done

- Created the isolated `feature/renovate-low-medium` git-spice worktree and
  recorded the approved XS/S/M scope.
- Updated the executable dependency set and root lockfile: Knip 6.29.0,
  release-please 17.10.4, Rust 1.97.1, Claude Agent SDK 0.3.220, Anthropic SDK
  0.115.0, TypeScript ESLint 8.65.0, tslog 5.1.0, Worklets 0.11.3, and
  Reanimated 4.5.3.
- Pinned the Bun, Playwright, Emscripten, BuildKit, Seerr, Scout, Starlight,
  GitHub MCP, and MCP proxy images/releases to immutable digests. Verified the
  Scout `2.0.0-6660` static-site archive manifest exists before promotion.
- Replaced the deprecated npm GitHub MCP server with GitHub's supported,
  checksum-verified binary and updated gateway, editor, Scout, documentation,
  and managed/live agent-skill examples.
- Made Mario Kart patch application deterministic and rebuilt its WASM output
  successfully with Emscripten 6.0.4.
- Completed focused TypeScript build, test, and lint checks; Docker smoke builds
  for Playwright and the MCP gateway; homelab synth and 1Password validation;
  Tasks native dependency checks, Metro release bundle, CocoaPods install, and
  a full iOS simulator build.
- Built the Scout desktop frontend, then passed Rust 1.97.1 formatting, check,
  Clippy with warnings denied, and all-target/all-feature tests (23 passed).
- Passed the complete affected repository verification surface: 217 of 217
  Turbo tasks, including build, typecheck, test, lint, security, policy, native,
  infrastructure, and rehearsal checks.
- Passed current-head Buildkite Turbo verification. Its image dry-run exposed a
  Bindery smoke-test port collision; diagnosed and reproduced the fix, then
  restacked onto the broader distinct-port fix that landed concurrently in
  PR #1748.
- Confirmed production React consumers are already on 19.2.8 and that no active
  nginx image pin corresponds to the dashboard digest entry.
- Committed the verified change and opened draft PR
  [#1749](https://github.com/shepherdjerred/monorepo/pull/1749).

### Remaining

- [ ] Confirm current-head Buildkite and review checks, then mark PR #1749 ready.

### Caveats

- Blocked and L/XL dashboard entries are intentionally deferred, not silenced.
- The detached Sentinel web proof-of-concept was not changed: its standalone
  lockfile cannot resolve the repository-only `workspace:*` lint package, while
  active production React packages are already current.
