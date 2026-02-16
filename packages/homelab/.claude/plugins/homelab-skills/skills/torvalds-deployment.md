---
description: >-
  Use when asking about adding services, createXxxDeployment patterns,
  or homelab deployment conventions. Services use per-namespace charts.
---

# Homelab Service Deployment

## Overview

Services are deployed across multiple namespaces using an app-of-apps pattern. Each service
category has its own namespace and Helm chart (e.g., `media`, `home`, `postal`). Services follow
a consistent `createXxxDeployment()` pattern.

## Namespace Structure

| Namespace   | Services                                     | Chart File     |
| ----------- | -------------------------------------------- | -------------- |
| `media`     | Plex, Radarr, Sonarr, Bazarr, Prowlarr, etc. | `media.ts`     |
| `home`      | Home Assistant, HA automations               | `home.ts`      |
| `postal`    | Postal mail server, MariaDB                  | `postal.ts`    |
| `syncthing` | Syncthing                                    | `syncthing.ts` |
| `golink`    | GoLink                                       | `golink.ts`    |
| `freshrss`  | FreshRSS                                     | `freshrss.ts`  |
| `pokemon`   | Pokemon bots                                 | `pokemon.ts`   |
| `gickup`    | Gickup                                       | `gickup.ts`    |

## Standard Deployment Pattern

### Step 1: Create Deployment File

Create `src/cdk8s/src/resources/{category}/yourservice.ts`:

```typescript
import { Chart, Size } from "cdk8s";
import { Cpu, Deployment, DeploymentStrategy, type PersistentVolumeClaim, Service, Volume } from "cdk8s-plus-31";
import { LINUXSERVER_GID, withCommonLinuxServerProps } from "../../misc/linux-server.ts";
import { ZfsNvmeVolume } from "../../misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "../../misc/tailscale.ts";
import versions from "../../versions.ts";

export function createYourServiceDeployment(
  chart: Chart,
  claims?: {
    downloads?: PersistentVolumeClaim;
    media?: PersistentVolumeClaim;
  },
) {
  // 1. Create Deployment
  const deployment = new Deployment(chart, "yourservice", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: LINUXSERVER_GID,
    },
  });

  // 2. Create config volume (SSD for performance)
  const configVolume = new ZfsNvmeVolume(chart, "yourservice-pvc", {
    storage: Size.gibibytes(8),
  });

  // 3. Add container
  deployment.addContainer(
    withCommonLinuxServerProps({
      image: `ghcr.io/linuxserver/yourservice:${versions["linuxserver/yourservice"]}`,
      portNumber: 8080,
      volumeMounts: [
        {
          path: "/config",
          volume: Volume.fromPersistentVolumeClaim(chart, "yourservice-config-volume", configVolume.claim),
        },
        // Add shared volumes if needed
        ...(claims?.downloads
          ? [
              {
                path: "/downloads",
                volume: Volume.fromPersistentVolumeClaim(chart, "yourservice-downloads-volume", claims.downloads),
              },
            ]
          : []),
      ],
      resources: {
        cpu: {
          request: Cpu.millis(100),
          limit: Cpu.millis(1000),
        },
        memory: {
          request: Size.mebibytes(256),
          limit: Size.mebibytes(512),
        },
      },
    }),
  );

  // 4. Create Service
  const service = new Service(chart, "yourservice-service", {
    selector: deployment,
    ports: [{ port: 8080 }],
  });

  // 5. Create Tailscale Ingress
  new TailscaleIngress(chart, "yourservice-ingress", {
    service,
    host: "yourservice",
  });
}
```

### Step 2: Add Version

Edit `src/cdk8s/src/versions.ts`:

```typescript
const versions = {
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "linuxserver/yourservice": "1.0.0@sha256:abc123...",
  // ... other versions
};
```

### Step 3: Register in Appropriate Chart

For media services, edit `src/cdk8s/src/cdk8s-charts/media.ts`:

```typescript
import { createYourServiceDeployment } from "../resources/media/yourservice.ts";

export function createMediaChart(app: App) {
  const chart = new Chart(app, "media", {
    namespace: "media",
    disableResourceNameHashes: true,
  });

  // Shared volumes
  const downloadsVolume = new ZfsSataVolume(chart, "downloads-hdd-pvc", {
    storage: Size.tebibytes(1),
  });

  // Add your service
  createYourServiceDeployment(chart, {
    downloads: downloadsVolume.claim,
  });

  // ... rest of chart
}
```

### Step 4: Create ArgoCD Application (if new namespace)

If creating a new namespace, add ArgoCD app in `src/cdk8s/src/resources/argo-applications/yournamespace.ts`:

```typescript
import { Chart } from "cdk8s";
import { Application } from "../../generated/imports/argoproj.io.ts";
import { createArgoApplication } from "./common.ts";

export function createYourNamespaceApplication(chart: Chart) {
  return createArgoApplication(chart, "yournamespace", {
    chart: {
      repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
      chartName: "yournamespace",
    },
    destination: {
      namespace: "yournamespace",
    },
  });
}
```

Then register in `src/cdk8s/src/cdk8s-charts/apps.ts` and add to `HELM_CHARTS` in `.dagger/src/helm.ts`.

## Advanced Patterns

### Multiple Containers (Sidecar Pattern)

```typescript
// Main container
deployment.addContainer(
  withCommonLinuxServerProps({
    image: `...`,
    portNumber: 8080,
  }),
);

// Metrics sidecar
deployment.addContainer(
  withCommonProps({
    name: "exporter",
    image: `...`,
    ports: [{ number: 9090, name: "metrics" }],
    securityContext: {
      ensureNonRoot: true,
      readOnlyRootFilesystem: true,
      user: 65534,
      group: 65534,
    },
  }),
);
```

### Prometheus ServiceMonitor

```typescript
import { ServiceMonitor } from "../../generated/imports/monitoring.coreos.com.ts";

new ServiceMonitor(chart, "yourservice-monitor", {
  metadata: {
    name: "yourservice-monitor",
    labels: { release: "prometheus" },
  },
  spec: {
    endpoints: [{ port: "metrics", interval: "60s", path: "/metrics" }],
    selector: { matchLabels: { app: "yourservice" } },
  },
});
```

### 1Password Secrets

```typescript
import { OnePasswordItem } from "../../generated/imports/onepassword.com.ts";

const secrets = new OnePasswordItem(chart, "yourservice-secrets", {
  spec: {
    itemPath: "vaults/xxx/items/yyy",
  },
});

// Use in container
envVariables: {
  API_KEY: EnvValue.fromSecretValue({
    secret: Secret.fromSecretName(chart, "api-key", secrets.name),
    key: "password",
  }),
},
```

### Public Access via Funnel

```typescript
new TailscaleIngress(chart, "yourservice-ingress", {
  service,
  host: "yourservice",
  funnel: true, // Accessible from public internet
});
```

## Directory Structure

```text
src/cdk8s/src/
├── cdk8s-charts/
│   ├── media.ts        # Media namespace chart
│   ├── home.ts         # Home namespace chart
│   ├── postal.ts       # Postal namespace chart
│   └── ...             # Other namespace charts
├── resources/
│   ├── torrents/       # Sonarr, Radarr, qBittorrent
│   ├── media/          # Plex, Tautulli, etc.
│   ├── home/           # Home Assistant
│   ├── mail/           # Postal mail server
│   └── argo-applications/  # ArgoCD app definitions
└── helm/
    ├── media/          # Media Helm chart
    ├── home/           # Home Helm chart
    └── ...             # Other Helm charts
```

## Key Files

- `src/cdk8s/src/cdk8s-charts/media.ts` - Media namespace chart
- `src/cdk8s/src/cdk8s-charts/home.ts` - Home namespace chart
- `src/cdk8s/src/resources/torrents/sonarr.ts` - Reference example
- `src/cdk8s/src/resources/media/plex.ts` - Complex example with sidecars
- `.dagger/src/helm.ts` - HELM_CHARTS list of all charts
