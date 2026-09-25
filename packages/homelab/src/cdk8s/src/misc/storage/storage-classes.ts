import type { Chart } from "cdk8s";
import { KubeStorageClass } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  VolumeSnapshotClass,
  VolumeSnapshotClassDeletionPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/snapshot.storage.k8s.io.ts";
import { CI_NODE_HOSTNAME } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";

// Note: K8s storage class names don't match hardware (legacy naming)
// - "zfs-ssd" is backed by NVMe SSDs
// - "zfs-hdd" is backed by SATA SSDs
export const NVME_STORAGE_CLASS = "zfs-ssd";
export const SATA_STORAGE_CLASS = "zfs-hdd";
// NVMe pool with lz4 compression ON. A StorageClass's `parameters` are
// immutable, so compression is chosen per-class at provision time and cannot be
// toggled on the existing `zfs-ssd` class in place. This variant exists for
// rebuildable, compressible CI caches (e.g. the buildkitd build cache) where
// lz4 both cuts NVMe wear and — critically — relocates the CI write storm off
// the Talos xfs `/var` system partition onto the ZFS NVMe pool.
export const NVME_STORAGE_CLASS_LZ4 = "zfs-ssd-lz4";

/**
 * Per-workflow CI workspaces: Woodpecker creates one claim per workflow and
 * deletes it when the workflow ends.
 *
 * Its own class for two properties the cache class must not have:
 *
 * - `reclaimPolicy: Delete`. Under Retain, every deleted workspace would
 *   leave its dataset on the CI pool, and a pool that only grows is the
 *   disk-full failure the July 2026 freezes began with.
 * - Provisioning only on the CI node. The claim binds wherever its first pod
 *   lands (`WaitForFirstConsumer`), so this keeps a misplaced pod from
 *   putting a workspace on the production node's pool.
 */
export const CI_WORKSPACE_STORAGE_CLASS = "ci-workspace";

export function createStorageClasses(chart: Chart) {
  new KubeStorageClass(chart, "host-zfs-ssd", {
    metadata: { name: NVME_STORAGE_CLASS },
    provisioner: "zfs.csi.openebs.io",
    allowVolumeExpansion: true,
    reclaimPolicy: "Retain",
    parameters: {
      fstype: "zfs",
      // "csi.storage.k8s.io/fstype": "zfs",
      poolname: "zfspv-pool-nvme",
      compression: "off",
      dedup: "off",
      recordsize: "128k",
      shared: "yes",
    },
    volumeBindingMode: "WaitForFirstConsumer",
  });

  new KubeStorageClass(chart, "host-zfs-ssd-lz4", {
    metadata: { name: NVME_STORAGE_CLASS_LZ4 },
    provisioner: "zfs.csi.openebs.io",
    allowVolumeExpansion: true,
    reclaimPolicy: "Retain",
    parameters: {
      fstype: "zfs",
      poolname: "zfspv-pool-nvme",
      // The whole point of this class: lz4 compression on. See the
      // NVME_STORAGE_CLASS_LZ4 export comment.
      compression: "lz4",
      dedup: "off",
      recordsize: "128k",
      shared: "yes",
    },
    volumeBindingMode: "WaitForFirstConsumer",
  });

  new KubeStorageClass(chart, "ci-workspace", {
    metadata: { name: CI_WORKSPACE_STORAGE_CLASS },
    provisioner: "zfs.csi.openebs.io",
    allowVolumeExpansion: false,
    reclaimPolicy: "Delete",
    parameters: {
      fstype: "zfs",
      poolname: "zfspv-pool-nvme",
      compression: "lz4",
      dedup: "off",
      recordsize: "128k",
      // A workflow's clone, service, and step pods mount the same claim.
      shared: "yes",
    },
    volumeBindingMode: "WaitForFirstConsumer",
    allowedTopologies: [
      {
        matchLabelExpressions: [
          { key: "kubernetes.io/hostname", values: [CI_NODE_HOSTNAME] },
        ],
      },
    ],
  });

  new KubeStorageClass(chart, "host-zfs-hdd", {
    metadata: { name: SATA_STORAGE_CLASS },
    provisioner: "zfs.csi.openebs.io",
    allowVolumeExpansion: true,
    reclaimPolicy: "Retain",
    parameters: {
      fstype: "zfs",
      // "csi.storage.k8s.io/fstype": "zfs",
      poolname: "zfspv-pool-hdd",
      compression: "off",
      dedup: "off",
      recordsize: "128k",
      shared: "yes",
    },
    volumeBindingMode: "WaitForFirstConsumer",
  });

  new VolumeSnapshotClass(chart, "host-zfs-snapshot", {
    metadata: { name: "host-zfs-snapshot" },
    driver: "zfs.csi.openebs.io",
    deletionPolicy: VolumeSnapshotClassDeletionPolicy.DELETE,
  });
}
