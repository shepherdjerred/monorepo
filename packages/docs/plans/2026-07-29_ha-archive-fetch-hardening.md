---
id: plan-2026-07-29-ha-archive-fetch-hardening
type: plan
status: in-progress
board: false
---

# Home Assistant Archive Fetch Hardening

## Goal

Make Home Assistant custom-component archive downloads resilient to bounded,
transient GitHub transport failures while preserving checksum verification and
hard failures for permanent errors or invalid archives.

## Implementation

- Fetch tag archives directly from
  `https://codeload.github.com/<repo>/tar.gz/refs/tags/<version>`.
- Add a typed package-local fetch helper with four attempts, 20-second
  per-attempt timeouts, and 1/2/4-second retry delays.
- Retry HTTP 408, 429, 500, 502, 503, and 504 plus recognized timeout, DNS,
  connection-refused, and connection-reset transport errors.
- Fail immediately for permanent HTTP responses and fail after the bounded
  retry budget is exhausted.
- Keep checksum, extraction, and patch failures outside the retry boundary.
- Give generated runtime init-container downloads equivalent bounded curl
  retry and timeout behavior.
- Update hash-regeneration examples and add focused unit coverage for retry
  classification and generated shell scripts.

## Verification

- `bunx turbo run build typecheck test lint --filter=@homelab/cdk8s`
- `HA_CUSTOM_COMPONENT_TARBALL_TEST=1 bun test packages/homelab/src/cdk8s/src/ha-custom-component-integrity.test.ts`
- `bunx lefthook run pre-commit`
- Current-head Buildkite, unresolved review threads, and merge-tree readiness

## Session Log — 2026-07-29

### Done

- Diagnosed the current PR 1810 failure and confirmed the archive digest remains
  valid when the network request succeeds.
- Agreed on bounded retry behavior and direct codeload URLs.
- Added `github-tag-archive.ts` with direct codeload URLs, four bounded attempts,
  per-attempt timeouts, and narrow HTTP/transport retry classification.
- Kept checksum verification, extraction, and patch application outside the
  retry boundary.
- Hardened both generated Home Assistant init-container install shapes with
  bounded curl retries and timeouts.
- Updated all nine hash-regeneration examples to use codeload.
- Added unit coverage for URL construction, every retryable HTTP status,
  transport errors, retry exhaustion, permanent failures, request timeouts, and
  both generated script shapes.
- Passed the focused package build, typecheck, test, and lint tasks plus the live
  nine-archive integrity suite.
- Passed the staged-file pre-commit gate and created draft pull request 1839.

### Remaining

- Verify pull request 1839 current-head Buildkite, review threads, and merge-tree
  readiness.
- After merge, verify the generated main build independently.

### Caveats

- Review-provider availability is separate from archive download hardening.
- Post-merge verification cannot begin until the pull request is merged.
