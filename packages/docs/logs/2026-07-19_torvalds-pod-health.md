---
id: log-2026-07-19-torvalds-pod-health
type: log
status: complete
board: false
---

# Torvalds Pod Health Check

## Scope

Read-only health assessment of the live `admin@torvalds` Kubernetes context on
2026-07-19 at approximately 17:30 PDT.

## Findings

### Workload state

- All 161 non-Job pods were `Running` and fully ready at the final snapshot.
- No Deployment, StatefulSet, or DaemonSet had unavailable replicas.
- All persistent volume claims were bound.
- The single Talos node was `Ready`, with no memory, disk, PID, or network
  pressure conditions. CPU usage was 14% and memory usage was 69%.

### Critical control-plane I/O saturation

- The API server's `/readyz` endpoint failed specifically on `etcd-readiness`.
- The critical `KubeAPIErrorBudgetBurn` alert was firing.
- etcd repeatedly logged request timeouts and slow linearizable reads. These
  caused the scheduler, controller manager, and several operators to lose
  leader election and restart together. Thirteen containers recorded another
  termination between 17:20 and 17:29 PDT.
- `nvme0n1`, which backs Talos ephemeral storage and etcd, was writing between
  187.4 and 257.3 MiB/s during the inspection. Its weighted I/O queue increased
  from approximately 1,177 to 1,849.
- Concurrent Buildkite jobs were the dominant visible container writers. The
  largest individual jobs were writing approximately 13-31 MB/s each, with
  several running simultaneously. Persistent application pods were not the
  source of the write spike.
- Talos still reported all system services healthy, etcd had no active alarm,
  and the etcd database was 512 MB with 52 MB in use. The failure mode is
  latency/saturation rather than capacity exhaustion.

### Monitoring and GitOps findings

- Twenty `ServiceProbeDown` alerts were firing, but representative direct
  blackbox probes resolved DNS and returned HTTP 404 in approximately 2 ms.
  The new root-path probes are therefore misconfigured for services whose `/`
  route intentionally returns 404; these alerts do not prove service outages.
- Four Argo CD applications were healthy but `OutOfSync`: `apps`,
  `cert-manager`, `dagger`, and `kyverno-policies`.
- The visible drift included Dagger resources and its StatefulSet,
  cert-manager token-request RBAC, and the
  `enforce-container-resource-limits` ClusterPolicy.
- Failed and completed Buildkite Job pods were present. They are ephemeral CI
  workloads rather than unavailable long-running services, although their
  concurrency is contributing to the control-plane incident.

## Recommended Follow-ups

1. Limit Buildkite job concurrency or apply I/O controls so CI cannot saturate
   the same NVMe device that hosts etcd.
2. Consider separating etcd/Talos ephemeral storage from high-write CI scratch
   storage.
3. Fix generated Prometheus Probe targets to use service-specific health paths
   or explicitly accepted status codes.
4. Review and reconcile the four healthy-but-OutOfSync Argo CD applications.

## Session Log — 2026-07-19

### Done

- Inspected live nodes, pods, workloads, jobs, PVCs, events, resource usage,
  Argo CD application state, Prometheus alerts, and Talos services/logs.
- Traced synchronized controller restarts to etcd timeouts caused by severe
  `nvme0n1` I/O saturation, with Buildkite jobs as the dominant visible writers.
- Distinguished HTTP-404 probe misconfiguration from actual pod unavailability.

### Remaining

- No remediation was requested or applied. Buildkite I/O isolation/throttling,
  probe-path fixes, and Argo CD reconciliation remain available follow-up work.

### Caveats

- This is a live-state snapshot; Buildkite jobs and alert states may change
  quickly.
- The cluster was serving most API requests, but `/readyz` was failing on etcd
  at the end of the inspection.
