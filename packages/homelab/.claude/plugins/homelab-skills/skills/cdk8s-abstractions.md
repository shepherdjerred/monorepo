---
description: >-
  Use when asking about ZFS volumes, TailscaleIngress, container props,
  Redis construct, or other reusable CDK8s abstractions.
---

# CDK8s Abstractions

## Overview

This project provides reusable CDK8s constructs for common patterns: storage volumes with backup
labeling, Tailscale networking, container property composition, and database services.

## Storage Constructs

### ZfsNvmeVolume

Creates a PVC on NVMe storage with automatic Velero backup labeling.

```typescript
import { ZfsNvmeVolume } from "../misc/zfs-nvme-volume.ts";
import { Size } from "cdk8s";

const configVolume = new ZfsNvmeVolume(chart, "myapp-config-pvc", {
  storage: Size.gibibytes(8),
});

// Use in deployment
volumeMounts: [
  {
    path: "/config",
    volume: Volume.fromPersistentVolumeClaim(
      chart,
      "myapp-config-volume",
      configVolume.claim,  // Access the PVC
    ),
  },
],
```

### ZfsSataVolume

Creates a PVC on SATA SSD storage for large data (uses K8s storage class `zfs-hdd` for legacy reasons).

```typescript
import { ZfsSataVolume } from "../misc/zfs-sata-volume.ts";
import { Size } from "cdk8s";

const mediaVolume = new ZfsSataVolume(chart, "media-hdd-pvc", {
  storage: Size.tebibytes(4),
});
```

### Automatic Backup Labeling

Both constructs auto-label PVCs for Velero:

| Volume Size | Backup Status                |
| ----------- | ---------------------------- |
| < 200 GB    | `velero.io/backup: enabled`  |
| >= 200 GB   | `velero.io/backup: disabled` |

```typescript
// Implementation detail
const shouldBackup = props.storage.toKibibytes() < Size.gibibytes(200).toKibibytes();
metadata: {
  labels: {
    "velero.io/backup": shouldBackup ? "enabled" : "disabled",
    "velero.io/exclude-from-backup": shouldBackup ? "false" : "true",
  },
},
```

## Networking Constructs

### TailscaleIngress

Creates an Ingress with the Tailscale ingress class.

```typescript
import { TailscaleIngress } from "../misc/tailscale.ts";

// Basic usage (private Tailscale access)
new TailscaleIngress(chart, "myapp-ingress", {
  service,
  host: "myapp", // Accessible at myapp.tailnet-1a49.ts.net
});

// Public internet access via Funnel
new TailscaleIngress(chart, "myapp-ingress", {
  service,
  host: "myapp",
  funnel: true,
});
```

### createIngress Function

Alternative function-based API for more control:

```typescript
import { createIngress } from "../misc/tailscale.ts";

createIngress(
  chart,
  "myapp-ingress", // Ingress name
  "myapp", // Namespace
  "myapp-service", // Service name
  8080, // Port
  ["myapp"], // Hosts
  false, // Funnel enabled
);
```

## Container Property Composition

### withCommonProps

Applies base properties to all containers:

```typescript
import { withCommonProps } from "../misc/common.ts";

deployment.addContainer(
  withCommonProps({
    image: "myimage:latest",
    portNumber: 8080,
    // ... other props
  }),
);
```

**What it adds:**

- `TZ: America/Los_Angeles` environment variable
- Empty resources object (ready for limits)

### withCommonLinuxServerProps

Extends `withCommonProps` for linuxserver.io images:

```typescript
import { withCommonLinuxServerProps, LINUXSERVER_GID } from "../misc/linux-server.ts";

const deployment = new Deployment(chart, "myapp", {
  replicas: 1,
  strategy: DeploymentStrategy.recreate(),
  securityContext: {
    fsGroup: LINUXSERVER_GID,  // Important!
  },
});

deployment.addContainer(
  withCommonLinuxServerProps({
    image: `ghcr.io/linuxserver/myapp:${versions["linuxserver/myapp"]}`,
    portNumber: 8080,
    volumeMounts: [...],
  }),
);
```

**What it adds:**

- `PUID: 1000` and `PGID: 1000` environment variables
- `TZ: America/Los_Angeles`
- Security context allowing root (for permission fixing)

## Database Constructs

### Redis

Deploys Redis via ArgoCD with Bitnami Helm chart:

```typescript
import { Redis } from "../resources/common/redis.ts";

const redis = new Redis(chart, "myapp-redis", {
  namespace: "media",  // Use the appropriate service namespace
});

// Use in deployment
envVariables: {
  REDIS_HOST: EnvValue.fromValue(redis.serviceName),  // "myapp-redis-master"
  REDIS_PORT: EnvValue.fromValue("6379"),
},
```

**Features:**

- Standalone architecture (no replication)
- No authentication (internal use)
- No persistence (in-memory only)
- Auto-creates ArgoCD Application

### PostalMariaDB

Specialized MariaDB for Postal mail server:

```typescript
import { PostalMariaDB } from "../resources/postgres/postal-mariadb.ts";

const mariadb = new PostalMariaDB(chart, "postal-mariadb", {
  namespace: "postal",
  storageClass: "zfs-ssd",
  storageSize: "32Gi",
});

// Access properties
mariadb.serviceName; // "postal-mariadb"
mariadb.databaseName; // "postal"
mariadb.username; // "postal"
mariadb.secretItem; // OnePasswordItem for credentials
```

## Utility Patterns

### JsonPatch for Unsupported Fields

Add fields CDK8s doesn't expose:

```typescript
import { ApiObject, JsonPatch } from "cdk8s";

// Add GPU resource limits
ApiObject.of(deployment).addJsonPatch(
  JsonPatch.add("/spec/template/spec/containers/0/resources", {
    limits: {
      "gpu.intel.com/i915": 1,
    },
  }),
);

// Enable host networking
ApiObject.of(deployment).addJsonPatch(JsonPatch.add("/spec/template/spec/hostNetwork", true));
```

### OnePasswordItem for Secrets

```typescript
import { OnePasswordItem } from "../generated/imports/onepassword.com.ts";

const secrets = new OnePasswordItem(chart, "myapp-secrets", {
  spec: {
    itemPath: "vaults/xxx/items/yyy",
  },
});

// Reference in container
envVariables: {
  API_KEY: EnvValue.fromSecretValue({
    secret: Secret.fromSecretName(chart, "api-key-ref", secrets.name),
    key: "password",
  }),
},
```

### ConfigMap from Directory

```typescript
import { ConfigMap, Volume } from "cdk8s-plus-31";

const config = new ConfigMap(chart, "myapp-config");
config.addDirectory(`${import.meta.dir}/../../../config/myapp`);

const configVolume = Volume.fromConfigMap(chart, "myapp-config-volume", config);

// Mount individual files
volumeMounts: files.map((file) => ({
  path: `/config/${file}`,
  subPath: file,
  volume: configVolume,
})),
```

## Constants

```typescript
// Storage classes
export const NVME_STORAGE_CLASS = "zfs-ssd";
export const SATA_STORAGE_CLASS = "zfs-hdd";

// User/Group IDs
export const ROOT_UID = 0;
export const ROOT_GID = 0;
export const LINUXSERVER_UID = 1000;
export const LINUXSERVER_GID = 1000;
```

## Key Files

- `src/cdk8s/src/misc/zfs-nvme-volume.ts` - SSD volume construct
- `src/cdk8s/src/misc/zfs-sata-volume.ts` - HDD volume construct
- `src/cdk8s/src/misc/tailscale.ts` - Tailscale ingress construct
- `src/cdk8s/src/misc/common.ts` - Base container props
- `src/cdk8s/src/misc/linux-server.ts` - LinuxServer.io props
- `src/cdk8s/src/misc/storage-classes.ts` - Storage class constants
- `src/cdk8s/src/resources/common/redis.ts` - Redis construct
- `src/cdk8s/src/resources/postgres/postal-mariadb.ts` - MariaDB construct
