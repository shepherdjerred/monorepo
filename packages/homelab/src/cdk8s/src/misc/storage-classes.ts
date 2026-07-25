import type { Chart } from "cdk8s";
import { KubeStorageClass } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  VolumeSnapshotClass,
  VolumeSnapshotClassDeletionPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/snapshot.storage.k8s.io.ts";

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
