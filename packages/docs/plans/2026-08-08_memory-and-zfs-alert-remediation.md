---
id: plan-2026-08-08-memory-and-zfs-alert-remediation
type: plan
status: in-progress
board: false
---

# Durable memory and ZFS alert remediation

## Context

The `MemoryLeakSuspected` PagerDuty incident on `liskov` was a false positive:
the PromQL `offset 24h` modifier applied only to the historical ZFS ARC selector,
so a large ARC drop looked like non-ARC memory growth. The corrected expression
must offset total memory, available memory, and ARC together.

The weekly `runZfsMaintenanceWorkflow` failed on 2026-08-02 after selecting the
`liskov` `zfs-zpool-collector` pod through `kubectl exec daemonset/...`. The
activity assumed that pod also contained `zfspv-pool-hdd`, but that pool exists
only on `torvalds`; the failure occurred before either node reached the scrub
loop. The maintenance activity now discovers one Ready collector pod per node
and only operates on that node's managed `zfspv-pool-*` inventory.

## Changes

- Correct and regression-test the memory alert expression.
- Make ZFS maintenance pod- and pool-aware, with fail-fast errors carrying node,
  pod, pool, and command context.
- Treat a zero scrub timestamp as an alert condition so never-scrubbed pools are
  visible instead of silently excluded.
- Document per-node verification and the Temporal workflow failure mode in the
  homelab runbook.

## Verification

- Focused Temporal and CDK8s tests and lint pass; CDK8s typecheck passes.
- The Temporal package-wide typecheck remains blocked by pre-existing missing
  `@shepherdjerred/glitter-context/schema` and `@shepherdjerred/llm-models`
  workspace artifacts plus dependent Glitter errors; no changed-file errors
  were reported.
- Rendered Prometheus rules contain the corrected memory and ZFS expressions.
- After the GitOps rollout, run the weekly workflow once, verify each node's
  managed pools have current scrub timestamps and no ZFS errors, then wait for
  Prometheus/Alertmanager to clear the incidents. This operator step is not part
  of the repository-only implementation.
