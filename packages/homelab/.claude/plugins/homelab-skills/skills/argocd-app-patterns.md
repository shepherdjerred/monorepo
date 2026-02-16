---
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
  createIngress(chart, "myapp-ingress", "myapp", "myapp-service", 8080, ["myapp"], false);

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
