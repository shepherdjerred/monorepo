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
- Enable Stash's persisted `FFmpeg hardware encoding` setting through its
  authenticated UI during rollout. The setting is application state, not a
  `config.yml` field, so it is not managed by the authentication init
  container.

## Verification

- Focused CDK8s tests, GPU-resource checks, typecheck, lint, and synthesized
  manifest inspection pass.
- The ArgoCD `stash` Application is Synced and Healthy after the chart is
  published and reconciled.
- The running pod has the GPU limit, runs on `torvalds`, and exposes a readable
  `/dev/dri/renderD128`.
- Stash startup logs report supported hardware codecs after the persisted
  setting is enabled.
- The container's FFmpeg completes a short `h264_vaapi` smoke encode.

## Remaining

- [ ] Merge and publish the GitOps change.
- [ ] Enable the Stash hardware-encoding setting and complete live acceptance.

## Comment Log

- 2026-08-11: The cluster GPU device plugin and Stash image were verified live;
  Stash was CPU-only because its pod requested no GPU resource and had no
  `/dev/dri` device.
