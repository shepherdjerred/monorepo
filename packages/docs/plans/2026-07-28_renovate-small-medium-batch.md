---
id: renovate-small-medium-batch-2026-07-28
type: plan
status: awaiting-human
board: false
---

# Renovate small and medium dependency batch

## Goal

Land the accepted small and medium Renovate updates in one git-spice pull
request, with `renovate.json` as the source of truth and `sandbox/**` excluded
from Renovate entirely.

## Scope

- Exclude every file under `sandbox/**` from Renovate extraction and updates.
- Apply the accepted active-package dependency, image, and Helm chart updates.
- Keep the explicitly large migrations deferred: Discord selfbot replacement,
  Astro 7, AI SDK 7 / OpenAI provider 4, eslint-plugin-unicorn 69, node-av 6,
  postgres-operator 2, and TypeScript 7.
- Repair the Emscripten custom manager so tag and digest pins are extracted
  separately and the Dockerfile and upstream metadata remain synchronized.
- Replace deprecated `fluent-ffmpeg` with a direct, typed FFmpeg process runner.
- Complete compatibility work for Babel 8, React Native Gesture Handler 3,
  OpenTelemetry, OpenAI 7, Temporal 1.21, Chevrotain 13, Vite 8, Satori 0.29,
  and changed Helm chart schemas.
- Refresh only the root `bun.lock`; do not create or edit sandbox lockfiles.

## Verification

- Validate Renovate configuration and confirm no `sandbox/**` package files are
  extracted.
- Run focused tests, builds, typechecks, renders, native dependency checks, and
  Helm type generation for every affected package.
- Run `bun run verify -- --affected`.
- Submit one draft PR through git-spice, then inspect current-head Buildkite
  status and unresolved review threads.

## Remaining

- [x] Configure Renovate and apply the accepted manifest/image/chart updates.
- [x] Implement the Emscripten synchronization guard.
- [x] Replace `fluent-ffmpeg` and migrate affected tests.
- [x] Complete Babel 8 and other source compatibility changes.
- [x] Regenerate Helm types and refresh the root lockfile.
- [x] Run focused and affected verification.
- [x] Submit one draft PR through git-spice.
- [ ] Validate the final PR head in Buildkite and inspect automated review.

## Human Verification

- Review and merge the consolidated dependency PR after its current-head
  Buildkite checks and automated review are green.

## Session Log — 2026-07-28

### Done

- Configured `renovate.json` to ignore `sandbox/**` completely and added a
  regression test for that boundary.
- Applied the accepted small and medium package, Docker image, and Helm chart
  updates while keeping the large migrations listed above deferred.
- Replaced deprecated `fluent-ffmpeg` with a direct typed FFmpeg runner and
  covered successful streaming, observability, and failure reporting.
- Added Emscripten tag/digest synchronization checks, completed the Babel 8 and
  React Native compatibility work, regenerated SeaweedFS Helm types, and
  refreshed the root lockfile.
- Passed focused builds, tests, typechecks, lint, native Metro bundling, external
  Helm rendering, Renovate validation, and `bun run verify -- --affected`
  (`217 successful, 217 total`).
- Fixed the first Buildkite head's compatibility findings for `js-yaml` 5 and
  `linkify-it` 6 consumers, including Astro, Kubernetes client, gray-matter,
  and Markdown-It, then re-ran their owning builds and tests.
- Fixed clean-install Astro event frontmatter validation after `js-yaml` 5
  stopped producing implicit `Date` objects; the exact site lane now passes all
  110 Playwright cases.
- Replaced host-dependent FFmpeg integration-test setup with an explicit
  executable seam and a deterministic Bun subprocess fixture, so the direct
  runner behavior is covered even when the CI image does not provide FFmpeg.
- Made the real dual-input FFmpeg integration test feed audio and video
  concurrently while honoring writable backpressure, eliminating the `EPIPE`
  race exposed by the full parallel verification load.
- Restacked onto the latest `main`, repaired its image-bake coverage regression,
  and fixed production digest discovery so `/prod` image pins participate in
  unchanged-layer detection.
- Submitted the consolidated change as draft PR #1762 through git-spice.

### Remaining

- Validate the final PR head in Buildkite, inspect automated review, and leave
  PR #1762 ready for human review and merge.

### Caveats

- The Discord selfbot replacement, Astro 7, AI SDK 7 / OpenAI provider 4,
  eslint-plugin-unicorn 69, node-av 6, postgres-operator 2, and TypeScript 7
  remain intentionally deferred as large migrations.
- The Emscripten and React pins were already current on the base revision; this
  change adds the missing Renovate configuration and synchronization coverage
  while retaining those exact pins.
