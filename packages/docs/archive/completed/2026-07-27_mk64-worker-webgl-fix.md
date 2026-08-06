---
id: plan-mk64-worker-webgl-fix
type: plan
status: complete
board: false
---

# MK64 Worker WebGL Initialization Fix

## Summary

The production worker fails while loading Emscripten because its browser host
does not define `WebGLRenderingContext`. The failure reproduces locally with the
production WASM assets and canonical ROM. A constructor stub allows the real
emulator core to boot, and the same initialization can be covered without a ROM.

## Implementation

- Add a callable `WebGLRenderingContext` stub to the worker browser environment
  while keeping the fake WebGL2 context outside that class.
- Extract WASM/glue initialization into a shared internal loader used by both
  `N64Emulator` and a ROM-free smoke command.
- Add an isolated Bun Worker regression test for the Emscripten compatibility
  predicate.
- Run the ROM-free smoke inside the production image as UID 1000 in local and
  Buildkite image-smoke paths.
- Document the ROM-free smoke and full ROM-gated worker harness.

## Test Plan

- Prove the regression test fails before the implementation and passes after it.
- Run package tests, typecheck, and lint.
- Build WASM with the pinned Emscripten Docker image and run the ROM-free smoke.
- Run the real `e2e:worker` harness with the canonical local ROM.
- Build and smoke the production image.
- Run `bun run verify -- --affected`.

## Remaining

- [x] Implement the worker host and shared WASM loader.
- [x] Add unit and image-level regression coverage.
- [x] Complete local ROM, image, and affected verification.
- [x] Publish PR #1730 through git-spice and verify its executable CI lanes.
- [x] Verify the GitOps rollout and a real `/play` session after merge.

## Assumptions

- The canonical ROM remains at
  `/Users/jerred/syncthing/Sync/roms/mariokart64.z64`.
- The pinned Docker-based WASM build remains the reproducible compiler path.
- Deployment changes remain GitOps-driven; no direct Kubernetes mutation is
  required.
