---
id: renovate-small-medium-batch-2026-07-28
type: plan
status: complete
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
- [x] Validate the final PR head in Buildkite and inspect automated review; PR #1762 subsequently merged.

## Human Verification

- Review and merge the consolidated dependency PR after its current-head
  Buildkite checks and automated review are green.
