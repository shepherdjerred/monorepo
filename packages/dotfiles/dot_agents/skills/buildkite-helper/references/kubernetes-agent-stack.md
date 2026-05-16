# Kubernetes Agent Stack (agent-stack-k8s)

## Architecture

agent-stack-k8s runs BuildKite agents as Kubernetes pods. A controller watches for jobs and creates pods with the specified configuration. Each job runs in its own pod, which is cleaned up after completion.

Helm chart: `ghcr.io/buildkite/helm/agent-stack-k8s`

## Pod Spec Patching

The `kubernetes` plugin allows full pod spec customization:

```yaml
plugins:
  - kubernetes:
      checkout:
        cloneFlags: "--depth=100"
        fetchFlags: "--depth=100"
      podSpecPatch:
        serviceAccountName: ci-controller
        priorityClassName: batch-low
        containers:
          - name: container-0 # Default container name
            image: "ghcr.io/org/ci-base:latest"
            resources:
              requests:
                cpu: "250m"
                memory: "512Mi"
              limits:
                memory: "1Gi"
            envFrom:
              - secretRef:
                  name: ci-secrets
              - secretRef:
                  name: optional-secrets
                  optional: true
            env:
              - name: CUSTOM_VAR
                value: "hello"
            volumeMounts:
              - name: git-mirrors
                mountPath: /buildkite/git-mirrors
                readOnly: true
        volumes:
          - name: git-mirrors
            persistentVolumeClaim:
              claimName: buildkite-git-mirrors
```

## Checkout Configuration

```yaml
plugins:
  - kubernetes:
      checkout:
        cloneFlags: "--depth=100" # Shallow clone
        fetchFlags: "--depth=100" # Shallow fetch
        skip: true # Skip checkout entirely
      gitMirrors:
        volume:
          name: buildkite-git-mirrors
          persistentVolumeClaim:
            claimName: buildkite-git-mirrors
        lockTimeout: 300 # Seconds to wait for mirror lock
```

Git mirrors provide a shared read-only cache of repositories, significantly speeding up checkouts for large repos.

## Secret Injection

```yaml
# Via environment from Kubernetes secrets
envFrom:
  - secretRef:
      name: ci-secrets # All keys become env vars
  - secretRef:
      name: argocd-token
      optional: true # Don't fail if secret missing

# Via Buildkite Secrets (agent v3.81+)
secrets:
  - GH_TOKEN # Secret name = env var name
  - name: CUSTOM_NAME # Custom env var mapping
    secret: buildkite-secret-name
```

Never write tokens to files or embed in URLs. Use `--token` flags or Dagger `Secret` type.

## Resource Management

### Resource Tiers (this monorepo)

| Tier    | CPU   | Memory | Used For               |
| ------- | ----- | ------ | ---------------------- |
| Heavy   | 1000m | 2Gi    | homelab, scout-for-lol |
| Medium  | 500m  | 1Gi    | birmel                 |
| Default | 250m  | 512Mi  | Everything else        |

### Kueue Integration

This monorepo uses Kueue for admission control:

```yaml
# ClusterQueue
apiVersion: kueue.x-k8s.io/v1beta1
kind: ClusterQueue
spec:
  namespaceSelector: {}
  resourceGroups:
    - flavors:
        - name: default
          resources:
            - name: cpu
              nominalQuota: "16"
            - name: memory
              nominalQuota: "64Gi"
  preemption:
    withinClusterQueue: Never # Running jobs never suspended
  queueingStrategy: StrictFIFO # Suspended jobs unsuspended in order
```

Benefits over ResourceQuota:

- Elastic concurrency (jobs sized by actual resource requests)
- FIFO ordering for suspended jobs
- No etcd event storms from quota admission failures
- Graceful degradation under load

## Helm Values (agent-stack-k8s)

Key values from this monorepo's deployment:

```yaml
agentStackSecret: buildkite-agent-token
config:
  queue: default
  max-in-flight: 20 # Max concurrent pods
  empty-job-grace-period: "5m" # Keep pods alive briefly for reuse
  default-checkout-params:
    gitMirrors:
      volume:
        name: buildkite-git-mirrors
        persistentVolumeClaim:
          claimName: buildkite-git-mirrors
      lockTimeout: 300
  pod-spec-patch:
    priorityClassName: batch-low
    serviceAccountName: buildkite-agent-stack-k8s-controller
```

## Container Build Strategies

agent-stack-k8s supports multiple container build approaches:

- **BuildKit** (recommended) — rootless, efficient layer caching
- **Kaniko** — in-cluster builds without Docker daemon
- **Buildah** — OCI-compliant, daemonless
- **Docker-in-Docker** — full Docker daemon in sidecar
- **Depot** — managed remote builders
- **Namespace** — remote builder service

## Sidecar Containers

```yaml
plugins:
  - kubernetes:
      podSpecPatch:
        containers:
          - name: container-0
            image: "ci-base:latest"
          - name: database
            image: "postgres:16"
            env:
              - name: POSTGRES_PASSWORD
                value: "test"
            ports:
              - containerPort: 5432
```

## Observability

This monorepo has a Grafana dashboard tracking:

- Kueue admitted/pending workloads
- Quota usage (CPU/memory)
- Actual vs requested resources per pod
- Running pods, suspended jobs, admission rate

Prometheus metrics: `kueue_admitted_active_workloads`, `kueue_pending_workloads`, `kueue_cluster_queue_resource_usage`, `kueue_cluster_queue_nominal_quota`.
