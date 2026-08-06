---
name: argocd-app-patterns
description: >-
  Use when asking about ArgoCD applications, Helm chart deployment via ArgoCD,
  sync policies, or typed Helm values patterns.
---

# ArgoCD Application Patterns

## Overview

ArgoCD applications manage Helm charts and sync them to the cluster. All apps use typed Helm values via `HelmValuesForChart<"chart-name">` for compile-time safety.

## Standard Application Pattern

### Step 1: Create Application File

Create `src/cdk8s/src/resources/argo-applications/myapp.ts`:

```typescript
import { Chart } from "cdk8s";
import { Application } from "../../generated/imports/argoproj.io.ts";
import versions from "../../versions.ts";
import type { HelmValuesForChart } from "../../misc/typed-helm-parameters.ts";
import { createIngress } from "../../misc/tailscale.ts";

export function createMyAppApp(chart: Chart) {
  // Optional: Create Tailscale ingress
  createIngress(
    chart,
    "myapp-ingress",
    "myapp",
    "myapp-service",
    8080,
    ["myapp"],
    false,
  );

  // Define typed Helm values
  const myAppValues: HelmValuesForChart<"myapp"> = {
    replicaCount: 1,
    service: {
      type: "ClusterIP",
      port: 8080,
    },
    persistence: {
      enabled: true,
      storageClass: "zfs-ssd",
      size: "8Gi",
    },
  };

  // Create ArgoCD Application
  return new Application(chart, "myapp-app", {
    metadata: {
      name: "myapp",
    },
    spec: {
      project: "default",
      source: {
        repoUrl: "https://charts.example.com",
        targetRevision: versions["myapp"],
        chart: "myapp",
        helm: {
          valuesObject: myAppValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "myapp",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
```

### Step 2: Add Version

Edit `src/cdk8s/src/versions.ts`:

```typescript
const versions = {
  // renovate: datasource=helm registryUrl=https://charts.example.com versioning=semver
  myapp: "1.2.3",
};
```

### Step 3: Register in Apps Chart

Edit `src/cdk8s/src/cdk8s-charts/apps.ts`:

```typescript
import { createMyAppApp } from "../resources/argo-applications/myapp.ts";

export async function createAppsChart(app: App) {
  const chart = new Chart(app, "apps", {
    namespace: "argocd",
    disableResourceNameHashes: true,
  });

  // ... existing apps
  createMyAppApp(chart);
}
```

## Sync Policy Options

### Basic Auto-Sync

```typescript
syncPolicy: {
  automated: {},
  syncOptions: ["CreateNamespace=true"],
}
```

### Aggressive Sync (Prune + Self-Heal)

```typescript
syncPolicy: {
  automated: {
    prune: true,      // Delete removed resources
    selfHeal: true,   // Revert manual changes
  },
  syncOptions: ["CreateNamespace=true"],
}
```

### Server-Side Apply (Large Configs)

```typescript
syncPolicy: {
  automated: {},
  syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
}
```

### Mutually-exclusive field changes (probe handler swaps) can wedge a sync

ArgoCD's default sync is a **client-side apply** (`kubectl apply`), which builds a
**three-way strategic-merge patch** from three inputs: the live object, the desired
manifest, and the `last-applied-configuration` annotation (ArgoCD's record of what
it previously applied). When a field ArgoCD manages is dropped from the desired
manifest, that three-way merge normally **deletes** it — so a clean handler swap
usually applies fine. The swap only wedges when the old handler field is **not** in
ArgoCD's tracked prior state — it was set out-of-band, is owned by a different
server-side field manager, or the ownership is otherwise stale — because then the
merge has no record telling it to remove the orphan. This is most visible on a field
whose siblings are **mutually exclusive**, e.g. a **probe handler type**
(`httpGet` ↔ `tcpSocket` ↔ `exec`, or `grpc`):

- Live object has an untracked `livenessProbe.httpGet`; you change the source to
  `Probe.fromTcpSocket(...)`.
- The merge adds `tcpSocket` but, lacking prior ownership of `httpGet`, leaves it
  in place → the object now has two handlers, and the apiserver rejects the patch:
  `Forbidden: may not specify more than 1 handler type`.
- The app is stuck `OutOfSync`/`SyncFailed` even though the **synthesized
  manifest is already correct** — no code change to the manifest heals it, because
  the problem is the stale live-object ownership, not the manifest. (This wedged the
  `media` app in 2026-08; the `shelfbridge-relay` sidecar's probes were switched
  from `httpGet` to `tcpSocket` while an untracked `httpGet` object was already
  live. See the original investigation.)

**Remediate (one time):** force a full replace so the orphaned field is dropped.
**Scope the replace to the one resource** with `--resource` — an app-level
`--replace` also `kubectl replace`s every bound PVC in the app, which harmlessly
fails on immutable fields (`spec is immutable after creation`) but leaves the sync
**operation in a `Failed` state** (verified 2026-08-02 on `media`; the PVCs were
untouched, but the whole sync reported failure).

```bash
argocd app sync <app> --replace --resource apps:Deployment:<name>   # replaces only that Deployment
# fallback (selfHeal:false → must resync): kubectl -n <ns> delete deploy <name> && argocd app sync <app>
```

After the replace, run a normal `argocd app sync <app>` (no `--replace`) to confirm
the app returns to `Synced`/`Healthy` under the default strategy — that is exactly
what the CI reconcile script (`packages/homelab/scripts/argocd.ts sync`) does, and
it does **not** pass `--replace`, so it cannot heal the wedge itself.

**Prevent recurrence (only for a resource that changes handlers often):** a
**per-resource** annotation on that one manifest —

```typescript
metadata: {
  annotations: { "argocd.argoproj.io/sync-options": "Replace=true" },
}
```

Scope it to the single resource, not the whole app. An app-level `Replace=true`
applies `kubectl replace` to **every** resource in the app, full-replacing bound
PVCs and other immutable resources, which fails on immutable fields (see
the original investigation). `ServerSideApply=true` is
**not** a replace — it runs `kubectl apply --server-side`, a field-manager merge, so
it does not full-replace PVCs; but at app scope it can still surface field-ownership
conflicts and is overkill for healing one resource. Either way, scope the
sync-option to the single manifest that needs it.

## Namespace with Pod Security

```typescript
import { Namespace } from "cdk8s-plus-31";

new Namespace(chart, "myapp-namespace", {
  metadata: {
    name: "myapp",
    labels: {
      "pod-security.kubernetes.io/enforce": "restricted",
      "pod-security.kubernetes.io/audit": "restricted",
      "pod-security.kubernetes.io/warn": "restricted",
    },
  },
});
```

## Ignore Differences (CRD Status)

```typescript
return new Application(chart, "myapp-app", {
  spec: {
    // ... source, destination, syncPolicy
    ignoreDifferences: [
      {
        group: "apiextensions.k8s.io",
        kind: "CustomResourceDefinition",
        jsonPointers: ["/status"],
      },
    ],
  },
});
```

## External Database Pattern

```typescript
import { createMyAppPostgreSQLDatabase } from "./myapp-postgres.ts";

export function createMyAppApp(chart: Chart) {
  // Create PostgreSQL via postgres-operator
  createMyAppPostgreSQLDatabase(chart);

  const values: HelmValuesForChart<"myapp"> = {
    postgresql: {
      install: false, // Use external DB
    },
    global: {
      psql: {
        password: {
          secret: "myapp.myapp-postgresql.credentials.postgresql.acid.zalan.do",
          key: "password",
        },
        main: {
          host: "myapp-postgresql",
          port: 5432,
          database: "myapp",
          username: "myapp",
        },
      },
    },
  };
  // ... create Application
}
```

## Complex Example: Prometheus Stack

```typescript
export async function createPrometheusApp(chart: Chart) {
  const prometheusValues: HelmValuesForChart<"kube-prometheus-stack"> = {
    // Disable unavailable components
    kubeProxy: { enabled: false },
    kubeScheduler: { enabled: false },

    // Grafana with external PostgreSQL
    grafana: {
      "grafana.ini": {
        database: {
          type: "postgres",
          host: "grafana-postgresql:5432",
        },
      },
      persistence: {
        enabled: true,
        storageClassName: "zfs-ssd",
      },
    },

    // Prometheus with long retention
    prometheus: {
      prometheusSpec: {
        retention: "180d",
        storageSpec: {
          volumeClaimTemplate: {
            spec: {
              storageClassName: "zfs-ssd",
              resources: {
                requests: { storage: "128Gi" },
              },
            },
          },
        },
      },
    },

    // Alertmanager with PagerDuty
    alertmanager: {
      config: {
        receivers: [
          {
            name: "pagerduty",
            pagerduty_configs: [{ routing_key_file: "/path/to/key" }],
          },
        ],
      },
    },
  };

  return new Application(chart, "prometheus-app", {
    metadata: { name: "prometheus" },
    spec: {
      source: {
        repoUrl: "https://prometheus-community.github.io/helm-charts",
        chart: "kube-prometheus-stack",
        targetRevision: versions["kube-prometheus-stack"],
        helm: { valuesObject: prometheusValues },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "prometheus",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
      },
    },
  });
}
```

## Key Files

- `src/cdk8s/src/resources/argo-applications/argocd.ts` - ArgoCD self-management
- `src/cdk8s/src/resources/argo-applications/prometheus.ts` - Complex example
- `src/cdk8s/src/resources/argo-applications/velero.ts` - Backup system
- `src/cdk8s/src/resources/argo-applications/gitlab.ts` - External DB example
- `src/cdk8s/src/cdk8s-charts/apps.ts` - Apps orchestration
