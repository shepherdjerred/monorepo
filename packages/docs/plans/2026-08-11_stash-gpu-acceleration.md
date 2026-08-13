---
id: plan-2026-08-11-stash-gpu-acceleration
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Stash Intel GPU Acceleration

## Goal

Give the existing private Stash deployment one shared Intel iGPU slot through
the cluster's Intel device plugin and enable VAAPI hardware encoding without
changing its storage, authentication, ingress, or security boundaries.

## Changes

- Request `gpu.intel.com/i915: 1` on the Stash container using the existing
  cdk8s JSON-patch convention.
- Set `STASH_HW_DRI_DEVICE` explicitly to `/dev/dri/renderD128`.
- Extend the Stash synth test and the repository GPU-resource test to prevent
  the resource from disappearing in a later manifest change.

Stash's persisted `FFmpeg hardware encoding` setting is application state rather
than a `config.yml` field, so enabling it needs the authenticated UI and is out
of scope here. It is tracked as operator-blocked work in
`packages/docs/todos/stash-hardware-encoding-setting.md`.

## Verification

- Focused CDK8s tests, GPU-resource checks, typecheck, lint, and synthesized
  manifest inspection pass.
- The ArgoCD `stash` Application is Synced and Healthy after the chart is
  published and reconciled.
- The running pod has the GPU limit, runs on `torvalds`, and exposes a readable
  `/dev/dri/renderD128`.
- The container's FFmpeg completes a short `h264_vaapi` smoke encode.

Stash reporting its supported hardware codecs at startup depends on the
operator-only setting and is verified in
`packages/docs/todos/stash-hardware-encoding-setting.md`.

## Remaining

- [ ] Merge and publish the GitOps change.
- [ ] Confirm the ArgoCD `stash` Application is Synced and Healthy, and that the
      running pod carries the `gpu.intel.com/i915` limit on `torvalds` with a
      readable `/dev/dri/renderD128`.
- [ ] Run a short `h264_vaapi` FFmpeg smoke encode inside the container.

## Comment Log

- 2026-08-11: The cluster GPU device plugin and Stash image were verified live;
  Stash was CPU-only because its pod requested no GPU resource and had no
  `/dev/dri` device.
- 2026-08-13: Split the authenticated-UI hardware-encoding enablement into
  `stash-hardware-encoding-setting` so this item stays genuinely agent-operable;
  the remaining checks here are all deterministic and do not need that setting.
