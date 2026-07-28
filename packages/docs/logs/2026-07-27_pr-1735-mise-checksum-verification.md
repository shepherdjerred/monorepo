---
id: log-2026-07-27-pr-1735-mise-checksum-verification
type: log
status: complete
board: false
---

# PR #1735 mise checksum verification

Buildkite #6623 failed its review gate because the CI image stored
architecture-specific mise checksums beside a Renovate-managed version. A
future version-only update would therefore download new assets and validate
them against stale checksums.

The CI image now verifies mise's signed `SHASUMS256.txt` manifest with the
project's pinned Minisign public key, then validates the selected musl archive
against that manifest. Renovate only updates `MISE_VERSION`; the matching
architecture checksum is obtained from the signed release metadata.

## Session Log — 2026-07-27

### Done

- Updated `.buildkite/ci-image/Dockerfile` to verify signed release checksums.
- Added a regression contract to `.buildkite/scripts/toolchain.test.sh`.
- Passed the focused Linux/amd64 Docker build through the mise installation
  layer.
- Passed the pipeline validator, ShellCheck, focused unit tests, and uncached
  root-scripts test and lint tasks.

### Remaining

- Buildkite must validate the pushed commit and the review gate must complete
  against that current head.

### Caveats

- The local Docker build intentionally stopped after the modified mise layer;
  the remaining CI image layers were unchanged.

## Session Log — 2026-07-27 (CI follow-up)

### Done

- Diagnosed Buildkite #6645's first hard failure as a pipeline-validator
  contract violation in the Playwright lanes.
- Restored the stale NodeSource APT-source cleanup in both Playwright commands
  in `.buildkite/pipeline.yml`.
- Passed the focused pipeline validator and toolchain shell contract locally.

### Remaining

- Push the fix to PR #1735 and confirm its replacement Buildkite build is green.

### Caveats

- The canceled E2E and review-gate jobs in #6645 were dependency fallout after
  the validator failed; they need a replacement build rather than separate
  source changes.
