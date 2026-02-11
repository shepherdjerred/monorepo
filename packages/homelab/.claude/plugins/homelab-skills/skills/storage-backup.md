---
description: >-
  Use when asking about storage classes, Velero backups, backup schedules,
  ZFS volumes, or disaster recovery patterns.
---

# Storage and Backup

## Overview

The homelab uses ZFS-backed storage classes via OpenEBS and Velero for backup to Cloudflare R2
(S3-compatible). Volumes are automatically labeled for backup based on size.

## Storage Classes

> **Note:** K8s storage class names are legacy and don't match actual hardware:
>
> - `zfs-ssd` → backed by NVMe SSDs
> - `zfs-hdd` → backed by SATA SSDs (not HDDs)

### zfs-ssd (NVMe SSD)

For config files, databases, and performance-critical data.

```typescript
import { NVME_STORAGE_CLASS } from "../misc/storage-classes.ts";

// Use via construct
const volume = new ZfsNvmeVolume(chart, "myapp-pvc", {
  storage: Size.gibibytes(8),
});

// Or directly in Helm values
persistence: {
  storageClass: NVME_STORAGE_CLASS,  // "zfs-ssd"
  size: "8Gi",
}
```

**Characteristics:**

- Pool: `zfspv-pool-nvme`
- Provisioner: `zfs.csi.openebs.io`
- Compression: off
- Dedup: off
- Record size: 128k

### zfs-hdd (SATA SSD)

For media files and large downloads. Despite the name, this is backed by SATA SSDs (not HDDs).

```typescript
import { SATA_STORAGE_CLASS } from "../misc/storage-classes.ts";

const mediaVolume = new ZfsSataVolume(chart, "media-pvc", {
  storage: Size.tebibytes(4),
});
```

**Characteristics:**

- Pool: `zfspv-pool-hdd` (legacy name - actually SATA SSDs)
- Same provisioner and settings as NVMe

## Automatic Backup Labeling

The `ZfsNvmeVolume` and `ZfsSataVolume` constructs automatically label PVCs for Velero:

```typescript
// In zfs-nvme-volume.ts / zfs-sata-volume.ts
const shouldBackup = props.storage.toKibibytes() < Size.gibibytes(200).toKibibytes();

metadata: {
  labels: {
    "velero.io/backup": shouldBackup ? "enabled" : "disabled",
    "velero.io/exclude-from-backup": shouldBackup ? "false" : "true",
  },
},
```

| Volume Size | Backup Status | Rationale                                   |
| ----------- | ------------- | ------------------------------------------- |
| < 200 GB    | Enabled       | Config, databases, important data           |
| >= 200 GB   | Disabled      | Large media (too big to backup efficiently) |

## Velero Backup Schedules

Defined in `src/cdk8s/src/resources/velero-schedules.ts`:

| Schedule  | Frequency      | Retention             | Description              |
| --------- | -------------- | --------------------- | ------------------------ |
| 6hourly   | Every 6 hours  | 3 days (12 backups)   | Frequent recovery points |
| 3daily    | Every 3 days   | 216 days (72 backups) | Medium-term retention    |
| weekly    | Monday 3:45 AM | 49 days (7 weeks)     | Weekly snapshots         |
| monthly   | 2nd of month   | 120 days (4 months)   | Monthly archives         |
| quarterly | Every 3 months | 90 days               | Long-term archives       |

### Schedule Configuration

```typescript
export type VeleroScheduleConfig = {
  id: string;
  name: string;
  cronSchedule: string;
  ttl: string;
  backupType: string;
  description: string;
};

const VELERO_SCHEDULE_CONFIGS: VeleroScheduleConfig[] = [
  {
    id: "velero-backup-6hourly",
    name: "6hourly-backup",
    cronSchedule: "15 */6 * * *",
    ttl: "72h",
    backupType: "6hourly",
    description: "Every 6 hours - FULL BACKUPS",
  },
  // ... other schedules
];
```

## Backup Storage Configuration

### Cloudflare R2 (Primary)

```typescript
configuration: {
  backupStorageLocation: [
    {
      name: "default",
      bucket: "homelab",
      provider: "aws",
      prefix: "torvalds/backups/",
      config: {
        region: "auto",
        s3Url: "https://xxx.r2.cloudflarestorage.com",
      },
    },
  ],
}
```

### ZFS Volume Snapshots

```typescript
volumeSnapshotLocation: [
  {
    name: "zfspv-incr",
    provider: "openebs.io/zfspv-blockstore",
    config: {
      bucket: "homelab",
      incrBackupCount: "15",
      fullBackupPrefix: "zfspv-full",
      backupPathPrefix: "zfspv-incr",
      prefix: "torvalds/zfs/",
      region: "auto",
      s3Url: "https://xxx.r2.cloudflarestorage.com",
    },
  },
],
```

## Manual Backup Operations

### Create On-Demand Backup

```bash
velero backup create manual-backup-$(date +%Y%m%d) \
  --selector velero.io/backup=enabled \
  --snapshot-volumes
```

### Restore from Backup

```bash
# List backups
velero backup get

# Restore specific backup
velero restore create --from-backup 6hourly-backup-20240115120000
```

### Check Backup Status

```bash
velero backup describe 6hourly-backup-20240115120000
velero backup logs 6hourly-backup-20240115120000
```

## Excluding Large Volumes

For volumes >= 200GB that shouldn't be backed up:

```typescript
// Automatic via construct
const mediaVolume = new ZfsSataVolume(chart, "media-pvc", {
  storage: Size.tebibytes(4),  // >= 200GB, auto-excluded
});

// Manual exclusion
metadata: {
  labels: {
    "velero.io/backup": "disabled",
    "velero.io/exclude-from-backup": "true",
  },
},
```

## Storage Class Definitions

From `src/cdk8s/src/misc/storage-classes.ts`:

```typescript
new KubeStorageClass(chart, "host-zfs-ssd", {
  metadata: { name: "zfs-ssd" },
  provisioner: "zfs.csi.openebs.io",
  allowVolumeExpansion: true,
  reclaimPolicy: "Retain",
  parameters: {
    fstype: "zfs",
    poolname: "zfspv-pool-nvme",
    compression: "off",
    dedup: "off",
    recordsize: "128k",
    shared: "yes",
  },
  volumeBindingMode: "WaitForFirstConsumer",
});
```

## Velero Helm Values

From `src/cdk8s/src/resources/argo-applications/velero.ts`:

```typescript
const veleroValues: HelmValuesForChart<"velero"> = {
  metrics: {
    serviceMonitor: { enabled: true },
  },
  initContainers: [
    {
      name: "velero-plugin-for-aws",
      image: `velero/velero-plugin-for-aws:${versions["velero/velero-plugin-for-aws"]}`,
      volumeMounts: [{ mountPath: "/target", name: "plugins" }],
    },
    {
      name: "velero-plugin-openebs",
      image: `openebs/velero-plugin:${versions["openebs/velero-plugin"]}`,
      volumeMounts: [{ mountPath: "/target", name: "plugins" }],
    },
  ],
  configuration: {
    backupStorageLocation: [...],
    volumeSnapshotLocation: [...],
  },
};
```

## Key Files

- `src/cdk8s/src/misc/storage-classes.ts` - Storage class definitions
- `src/cdk8s/src/misc/zfs-nvme-volume.ts` - SSD volume construct
- `src/cdk8s/src/misc/zfs-sata-volume.ts` - HDD volume construct
- `src/cdk8s/src/resources/velero-schedules.ts` - Backup schedule config
- `src/cdk8s/src/resources/argo-applications/velero.ts` - Velero deployment
- `src/cdk8s/src/resources/argo-applications/openebs.ts` - OpenEBS CSI driver
