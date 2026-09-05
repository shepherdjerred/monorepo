---
name: homelab-operations
description: Inspect, troubleshoot, reconcile, or verify the live homelab across ArgoCD, Kubernetes, Talos, storage, backups, networking, and observability. Use for incidents, health checks, deployment verification, or production operations.
---

# Homelab operations

Start read-only. Establish the intended revision and owning repository source
before considering a live mutation. Use the existing `toolkit`, `argocd`,
`kubectl`, `talosctl`, Grafana, and provider wrappers; never expose credentials.

## Investigation order

1. Identify the service, namespace, ArgoCD Application, expected revision, and
   source definition.
2. Check exact-head CI and artifact publication when deployment is involved.
3. Inspect ArgoCD desired/live state and operation history.
4. Inspect Kubernetes rollout, events, probes, logs, and resource pressure.
5. Check dependencies: DNS, certificates, network policy, storage, secrets, and
   external control planes.
6. Exercise the user-visible path or a service-specific acceptance probe.

Correlate evidence before changing anything. A healthy pod does not prove the
route, and an ArgoCD `Healthy` state does not prove application behavior.

Use the repository release workflow for root syncs and pruning. `OutOfSync` or
`requiresPruning` alone does not identify a safe prune candidate. Never bypass
the exact revision, rendered inventory, cascade annotation/finalizer,
apply-safety preflight, or request UUID ownership.

Storage and backup work is data-sensitive. Inspect the StorageClass, PVC/PV,
snapshot or backup object, retention policy, and restore path before mutation.
Treat a successful backup job and a verified restore as separate claims.

Prefer a GitOps repair when the source is wrong. A narrowly scoped live action
is appropriate for diagnosis or emergency recovery only when authorized; record
what must be reconciled back to source.
