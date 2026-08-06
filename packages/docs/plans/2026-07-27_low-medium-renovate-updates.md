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
