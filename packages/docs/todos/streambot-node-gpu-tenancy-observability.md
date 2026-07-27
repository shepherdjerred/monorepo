---
id: streambot-node-gpu-tenancy-observability
type: todo
status: planned
board: true
verification: agent
disposition: deferred
origin: packages/docs/archive/superseded/streambot-stutter-observability-followup.md
---

# Add node-wide GPU tenancy observability for Streambot

Per-pod fdinfo cannot show competing GPU clients, and `intel_gpu_top` is not a
reliable source on the current Raptor Lake host. A node-level DRM clients
exporter would make whole-GPU contention visible.

## Remaining

- [ ] Evaluate a maintained DRM fdinfo exporter against the torvalds kernel and
      i915 device, including the least host access it requires.
- [ ] If the signal is reliable and the privilege cost is acceptable, deploy it
      as a node-scoped exporter with dashboard panels that distinguish
      Streambot from other GPU clients.
- [ ] Validate the series under simultaneous Streambot and another GPU workload
      before using it for incident conclusions.

## Comment Log

### 2026-07-27 — split from stutter follow-up

- Deferred as a visibility enhancement; current playback metrics can drive the
  bounded residual-stutter investigation without this exporter.
