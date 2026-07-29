---
id: ci-base-digest-pin
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/archive/completed/2026-07-25_ci-write-reduction-impl.md
---

# Pin ci-base by digest; drop `imagePullPolicy: Always`

## Context

Track 2.2 of the CI capacity remediation, deferred out of the write-reduction
PR (#1639): every CI pod pulls `ghcr.io/shepherdjerred/ci-base:latest` with
`imagePullPolicy: Always` (manifest check per pod; the mutable-tag staleness
class that bit build 5648 is guarded by the Always pull + toolchain.sh
runtime bootstrap). A digest pin makes the toolchain deterministic per commit
and lets pods use `IfNotPresent`.

Deferred deliberately: the pin needs a bump loop (ci-image-refresh pushes →
digest recorded → auto-merge PR updates the pin), which touches the same
release automation where bump-loop bugs have bitten before, for the smallest
write win of the reduction levers.

## Design sketch (from the impl plan)

- `build-ci-image.ts` already pushes an immutable `:<commit-sha>` tag; also
  capture the pushed digest.
- Committed pin: either a `.buildkite/ci-image/DIGEST` file interpolated at
  upload time (`upload-pipeline.sh` exports `CI_BASE_IMAGE`; anchors use
  `${CI_BASE_IMAGE}`) or direct rewrites of the four pod-anchor image lines.
- Bump PR: reuse the `update-versions.ts` find-or-create auto-merge pattern
  (`chore/version-bump-pending`); ci-image-refresh hands the digest via
  meta-data; version-commit-back gains an optional `--ci-base-digest`.
- `validate-pipeline.ts`: assert all pod anchors resolve the same pinned
  ref + `IfNotPresent`; keep toolchain.sh bootstrap for the gap between an
  image change and the bump merge.

## Remaining

- [x] Replace all five `.buildkite/pipeline.yml` `ci-base:latest` references with one validated digest-pinned reference and `IfNotPresent`.
- [x] Teach the CI image refresh/version-bump flow to carry the built digest into a narrow bump PR without an unpinned intermediate state.
- [x] Make pipeline validation reject mutable or divergent CI base references.
- [x] Add tests for no-change, changed-digest, and failed-bump behavior.
- [ ] Prove one main-branch image change produces and lands a digest bump before pods consume it.

## Comment Log

- 2026-07-27 — Board audit confirmed five static Buildkite pod definitions still
  use `ghcr.io/shepherdjerred/ci-base:latest` with `imagePullPolicy: Always`.
  The task remains active and now names the validation and no-gap requirements.

### 2026-07-27 — board audit reconciliation

- Confirmed as the only accepted residual from the completed CI write-reduction implementation plan; implementation must target the current static pipeline.

### 2026-07-28 — implementation

- PR #1776 adds independent immutable pins and monotonic candidate-to-pin
  promotion for `ci-base` and `ci-playwright`; the remaining proof requires a
  post-merge main build against live GHCR and the generated pin PR.
