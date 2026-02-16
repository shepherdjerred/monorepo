---
description: >-
  Use when asking about linuxserver.io containers, PUID/PGID configuration,
  media app deployment, or withCommonLinuxServerProps.
---

# LinuxServer.io Containers

## Overview

LinuxServer.io provides Docker images for many popular self-hosted applications (Sonarr, Radarr,
Plex alternatives, etc.). These images have specific requirements for user/group IDs and security
contexts.

## withCommonLinuxServerProps Helper

Always use this helper for linuxserver.io containers:

```typescript
import { withCommonLinuxServerProps, LINUXSERVER_GID } from "../misc/linux-server.ts";
import { Deployment, DeploymentStrategy } from "cdk8s-plus-31";

const deployment = new Deployment(chart, "myapp", {
  replicas: 1,
  strategy: DeploymentStrategy.recreate(),
  securityContext: {
    fsGroup: LINUXSERVER_GID,  // Critical for volume permissions
  },
});

deployment.addContainer(
  withCommonLinuxServerProps({
    image: `ghcr.io/linuxserver/myapp:${versions["linuxserver/myapp"]}`,
    portNumber: 8080,
    volumeMounts: [...],
    resources: {...},
  }),
);
```

## What withCommonLinuxServerProps Configures

```typescript
// From src/cdk8s/src/misc/linux-server.ts
const commonLinuxServerProps: Partial<ContainerProps> = {
  ...commonProps, // TZ: America/Los_Angeles
  envVariables: {
    ...commonProps.envVariables,
    PUID: EnvValue.fromValue("1000"),
    PGID: EnvValue.fromValue("1000"),
  },
  securityContext: {
    ensureNonRoot: false,
    readOnlyRootFilesystem: false,
    user: 0, // Run as root
    group: 0, // Root group
  },
};
```

### Environment Variables

| Variable | Value               | Purpose                     |
| -------- | ------------------- | --------------------------- |
| `PUID`   | 1000                | User ID for file ownership  |
| `PGID`   | 1000                | Group ID for file ownership |
| `TZ`     | America/Los_Angeles | Timezone                    |

### Security Context

LinuxServer.io containers run as root initially to fix file permissions, then drop privileges:

```typescript
securityContext: {
  ensureNonRoot: false,        // Allow root
  readOnlyRootFilesystem: false,  // Writable filesystem
  user: 0,                     // UID 0 (root)
  group: 0,                    // GID 0 (root)
}
```

## Deployment Security Context

**Critical:** Set `fsGroup` on the deployment for volume permissions:

```typescript
const deployment = new Deployment(chart, "myapp", {
  securityContext: {
    fsGroup: LINUXSERVER_GID, // 1000
  },
});
```

This ensures files created in mounted volumes have the correct group ownership.

## Standard Volume Pattern

LinuxServer.io apps typically need:

1. **Config volume (SSD):** Application configuration, databases
2. **Data volumes (HDD):** Media files, downloads

```typescript
import { ZfsNvmeVolume } from "../misc/zfs-nvme-volume.ts";
import { ZfsSataVolume } from "../misc/zfs-sata-volume.ts";

// Config on fast storage
const configVolume = new ZfsNvmeVolume(chart, "myapp-config-pvc", {
  storage: Size.gibibytes(8),
});

// Media on large storage
const mediaVolume = new ZfsSataVolume(chart, "media-hdd-pvc", {
  storage: Size.tebibytes(4),
});

volumeMounts: [
  {
    path: "/config",
    volume: Volume.fromPersistentVolumeClaim(chart, "config-vol", configVolume.claim),
  },
  {
    path: "/media",
    volume: Volume.fromPersistentVolumeClaim(chart, "media-vol", mediaVolume.claim),
  },
],
```

## Complete Example: Sonarr

```typescript
import { Chart, Size } from "cdk8s";
import { Cpu, Deployment, DeploymentStrategy, type PersistentVolumeClaim, Service, Volume } from "cdk8s-plus-31";
import { LINUXSERVER_GID, withCommonLinuxServerProps } from "../../misc/linux-server.ts";
import { ZfsNvmeVolume } from "../../misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "../../misc/tailscale.ts";
import versions from "../../versions.ts";

export function createSonarrDeployment(
  chart: Chart,
  claims: {
    tv: PersistentVolumeClaim;
    downloads: PersistentVolumeClaim;
  },
) {
  const deployment = new Deployment(chart, "sonarr", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: LINUXSERVER_GID,
    },
  });

  const localPathVolume = new ZfsNvmeVolume(chart, "sonarr-pvc", {
    storage: Size.gibibytes(8),
  });

  deployment.addContainer(
    withCommonLinuxServerProps({
      image: `ghcr.io/linuxserver/sonarr:${versions["linuxserver/sonarr"]}`,
      portNumber: 8989,
      volumeMounts: [
        {
          path: "/config",
          volume: Volume.fromPersistentVolumeClaim(chart, "sonarr-volume", localPathVolume.claim),
        },
        {
          path: "/downloads",
          volume: Volume.fromPersistentVolumeClaim(chart, "sonarr-downloads-volume", claims.downloads),
        },
        {
          path: "/tv",
          volume: Volume.fromPersistentVolumeClaim(chart, "sonarr-tv-volume", claims.tv),
        },
      ],
      resources: {
        cpu: {
          request: Cpu.millis(50),
          limit: Cpu.millis(1000),
        },
        memory: {
          request: Size.mebibytes(256),
          limit: Size.mebibytes(768),
        },
      },
    }),
  );

  const service = new Service(chart, "sonarr-service", {
    selector: deployment,
    ports: [{ port: 8989 }],
  });

  new TailscaleIngress(chart, "sonarr-ingress", {
    service,
    host: "sonarr",
  });
}
```

## Version Management

Add versions with SHA256 digests:

```typescript
// In src/cdk8s/src/versions.ts
// renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
"linuxserver/sonarr": "4.0.16@sha256:8b9f2138ec50fc9e521960868f79d2ad0d529bc610aef19031ea8ff80b54c5e0",
```

## Deployment Strategy

Always use `recreate` strategy for linuxserver.io apps:

```typescript
strategy: DeploymentStrategy.recreate(),
```

**Reason:** These apps often have SQLite databases that don't support multiple writers.

## Resource Recommendations

| App Type            | CPU Request | CPU Limit | Memory Request | Memory Limit |
| ------------------- | ----------- | --------- | -------------- | ------------ |
| Light (Bazarr)      | 50m         | 500m      | 128Mi          | 256Mi        |
| Medium (Sonarr)     | 50m         | 1000m     | 256Mi          | 768Mi        |
| Heavy (qBittorrent) | 100m        | 2000m     | 1Gi            | 4Gi          |

## Common LinuxServer.io Apps

| App         | Port | Purpose              |
| ----------- | ---- | -------------------- |
| sonarr      | 8989 | TV series management |
| radarr      | 7878 | Movie management     |
| bazarr      | 6767 | Subtitle management  |
| prowlarr    | 9696 | Indexer management   |
| qbittorrent | 8080 | Torrent client       |
| overseerr   | 5055 | Media requests       |
| tautulli    | 8181 | Plex monitoring      |

## Key Files

- `src/cdk8s/src/misc/linux-server.ts` - LinuxServer props helper
- `src/cdk8s/src/misc/common.ts` - Base container props
- `src/cdk8s/src/resources/torrents/sonarr.ts` - Reference implementation
- `src/cdk8s/src/resources/torrents/radarr.ts` - Similar pattern
- `src/cdk8s/src/resources/torrents/qbittorrent.ts` - Complex example with VPN
