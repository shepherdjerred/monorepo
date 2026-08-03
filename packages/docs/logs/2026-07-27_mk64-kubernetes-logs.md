---
id: log-2026-07-27-mk64-kubernetes-logs
type: log
status: complete
board: false
---

# MK64 Kubernetes Log Investigation

## Request

Investigate why the live Mario Kart 64 workload is not working by inspecting
Kubernetes state and logs. Keep the investigation read-only.

## Findings

- Kubernetes is healthy:
  - Argo CD Application `mario-kart` is `Synced` / `Healthy`.
  - Deployment `mario-kart` is available at revision 77.
  - Pod `mario-kart-5fcc67ccc4-qdfc2` is `Ready`, has zero restarts, and is
    running image `2.0.0-6529@sha256:2d2dd8d2...`.
  - All three PVCs are bound, the UI Service has endpoint
    `10.244.0.242:8081`, and namespace events contain no warnings.
- The 2026-07-27 20:19:28 UTC `/play` attempt failed during emulator
  initialization:

  ```text
  restored MEMFS save state
  driver onSessionStart threw; releasing userbot
  error="WebGLRenderingContext is not defined"
  mario-kart driver stop reason="error"
  ```

- Root cause is the Worker-thread emulator rollout from
  `ff8334f23` / PR #1698. `WorkerEmulator` now initializes N64Wasm inside a Bun
  Worker. The generated Emscripten glue executes
  `gl instanceof WebGLRenderingContext` while creating the fake WebGL context,
  but `installBrowserStubs()` does not define `WebGLRenderingContext`. The live
  image uses Bun 1.3.14, where the global is `undefined`.
- The image smoke test deliberately sets `emulator.enabled = false` because CI
  has no ROM. It validates startup and Discord authentication, but never boots
  the Worker or evaluates the Emscripten WebGL context path, so this regression
  passed the image gate.
- This is not a ROM, save, secret, PVC, GPU, scheduling, or service-endpoint
  failure. The session fails before the emulator finishes booting; the
  application catches the error, releases the userbot, and leaves the pod
  healthy.

## Repair Target

Make the headless browser shim safe for the Emscripten WebGL constructor check
inside Bun Workers, and add a worker-boot verification that exercises the
production image/runtime path. The follow-up implementation is recorded in
[`../archive/completed/2026-07-27_mk64-worker-webgl-fix.md`](../archive/completed/2026-07-27_mk64-worker-webgl-fix.md).

## Session Log — 2026-07-27

### Done

- Inspected live Mario Kart Kubernetes workload state, events, Argo CD health,
  PVCs, Service endpoints, current logs, and previous-container availability.
- Correlated the exact session failure with the deployed image and the
  Worker-thread source change.
- Confirmed the missing WebGL global in the live Bun runtime and located the
  reference in the generated Emscripten glue.
- Identified why the existing image smoke test did not cover the failing path.
- Implemented the source repair and regression coverage in the follow-up
  worktree, including the production-image smoke path.

### Remaining

- Publish and verify the implementation PR.
- After merge, verify the GitOps rollout and a real `/play` session.

### Caveats

- The application log records the error message but not its stack. The root
  cause is supported by the live runtime global check, the generated glue
  reference, and the Worker initialization source path.
- No live Kubernetes resources were mutated during diagnosis or implementation.

## Session Log — 2026-08-02

### Done

- Updated the MK64 WebGL plan link after live runtime proof completed and archived that plan.

### Remaining

- None added by this link maintenance.

### Caveats

- The historical log content is otherwise unchanged.
