# Kueue for Buildkite CI Resource Management

Date: 2026-03-18

## Problem

Buildkite agent-stack-k8s creates Kubernetes Jobs for each CI step (up to `max-in-flight: 20`). A `ResourceQuota` capped the buildkite namespace at 16 CPU / 32Gi memory. When more Jobs were created than the quota could fit, the Kubernetes Job controller retried pod creation every ~30s, generating thousands of `FailedCreate` events. This overwhelmed etcd with event range queries (200-470ms each, back-to-back), making the API server unresponsive and crash-looping kube-scheduler and kube-controller-manager.

The root cause: `ResourceQuota` rejects pod **creation** at the API level. The Job controller then retries indefinitely, creating an event storm. This is fundamentally different from pods going **Pending** (scheduler can't place them), which is quiet.

## Alternatives Considered

| Approach                                      | Why rejected                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Lower `max-in-flight`**                     | Count-based, not resource-aware. Fixed concurrency wastes capacity — LIGHT jobs (500m CPU) hold slots a HEAVY job (2 CPU) could use. |
| **Remove ResourceQuota + max-in-flight only** | No hard namespace resource cap. Approximate at best.                                                                                 |
| **ElasticQuota (scheduler-plugins)**          | Requires custom scheduler. No release for K8s 1.35. Alpha API. Pods need `schedulerName` field.                                      |
| **Kyverno / OPA / admission webhook**         | Rejects at admission level — same retry storm as ResourceQuota.                                                                      |
| **Volcano / YuniKorn**                        | Replace/augment default scheduler. Overkill for single-node.                                                                         |
| **VPA**                                       | Doesn't support standalone Jobs (only Deployments/StatefulSets).                                                                     |
| **Per-pod resource requests tuning**          | Leaves performance on the table — a LIGHT job reserves CPU it doesn't use, blocking a HEAVY job that needs it.                       |

## Solution: Kueue

[Kueue](https://kueue.sigs.k8s.io/) (kubernetes-sigs) manages Job admission by **suspending** them (`spec.suspend: true`) via a mutating webhook. No pods are created for suspended Jobs — zero retry storms, zero events. When resources free up, Kueue unsuspends the Job and pods are created normally.

### How it works

1. Buildkite operator creates a K8s Job (with `suspend: false`)
2. Kueue's webhook intercepts it, sets `suspend: true`
3. Kueue checks the ClusterQueue budget (16 CPU / 64Gi)
4. If budget has room → unsuspend → pod created → runs
5. If budget full → Job stays suspended → no pod → no events
6. When a running Job completes → Kueue unsuspends the next queued Job

### Key properties

- **Hard namespace cap**: 16 CPU / 64Gi (50% of 32c/128Gi node) via ClusterQueue `nominalQuota`
- **Elastic concurrency**: no fixed job count. LIGHT jobs pack more; HEAVY jobs pack fewer. Kueue counts actual resource requests.
- **No wasted reservations**: budget is shared dynamically across all job sizes
- **No preemption**: running Jobs are never re-suspended (`withinClusterQueue: Never`)
- **Transparent to Buildkite**: no changes to agent-stack-k8s or pipeline config
- **Fail-closed**: if Kueue is down, Job creation blocks. Kueue has `infrastructure-critical` PriorityClass.
- **FIFO ordering**: suspended Jobs unsuspended in creation order

### Configuration

**ClusterQueue** (`buildkite`): 16 CPU / 64Gi nominalQuota, no preemption, `namespaceSelector` matching `kueue.x-k8s.io/managed-namespace: "true"`.

**Kueue controller config**: `manageJobsWithoutQueueName: true` with `managedJobsNamespaceSelector` targeting labeled namespaces. Config must be set via `managerConfig.controllerManagerConfigYaml` in Helm values (the chart uses a single YAML string, not individual values).

**LimitRange** kept in buildkite namespace — gives sidecar containers (agent, checkout) default resource requests (100m CPU / 128Mi) so Kueue can account for their overhead.

## Risks

| Risk                                                 | Mitigation                                                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Zero prior art for Kueue + Buildkite                 | Verified both codebases: agent-stack-k8s doesn't force-fail suspended Jobs; ActiveDeadlineSeconds counts from pod start |
| Kueue webhook down → all Job creation blocked        | `infrastructure-critical` PriorityClass; single-node so no scheduling concern                                           |
| `empty-job-grace-period: 5m` might GC suspended Jobs | Monitor; increase grace period if needed                                                                                |
| Memory undercount — pods burst beyond requests       | Grafana dashboard shows actual vs requested; adjust pipeline tiers                                                      |

## Observability

Grafana dashboard (`buildkite-dashboard`) with three sections:

1. **Kueue Queue Health**: admitted/pending workloads, CPU/memory quota usage over time
2. **Resource Sizing**: actual CPU/memory vs requested per pod — detects wrong-sized job tiers
3. **Concurrency & Throughput**: running pods, suspended jobs, admission rate

Kueue exposes Prometheus metrics via `enableClusterQueueResources: true`.

## Files

| File                                                                      | Purpose                                              |
| ------------------------------------------------------------------------- | ---------------------------------------------------- |
| `packages/homelab/src/cdk8s/src/resources/argo-applications/kueue.ts`     | ArgoCD Application (Helm chart, sync-wave 1)         |
| `packages/homelab/src/cdk8s/src/resources/kueue-config.ts`                | ClusterQueue, LocalQueue, ResourceFlavor (ApiObject) |
| `packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts` | Removed ResourceQuota, added namespace label         |
| `packages/homelab/src/cdk8s/grafana/buildkite-dashboard.ts`               | Grafana dashboard                                    |
| `packages/homelab/src/cdk8s/src/versions.ts`                              | Kueue version (0.16.3)                               |

## Gotchas

- The Kueue Helm chart passes the entire controller config as a single YAML string via `managerConfig.controllerManagerConfigYaml`. Individual top-level Helm values like `manageJobsWithoutQueueName` are silently ignored.
- The ClusterQueue needs a `namespaceSelector` — without it, workloads get "namespace doesn't match ClusterQueue selector" even if a LocalQueue exists.
- The old ResourceQuota must be deleted before or at the same time as Kueue goes live — otherwise Kueue admits workloads but the quota blocks pod creation, causing the same FailedCreate storm.
