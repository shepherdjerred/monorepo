import type { Construct } from "constructs";
import {
  NVME_STORAGE_CLASS,
  NVME_STORAGE_CLASS_LZ4,
} from "./storage-classes.ts";
import { ZFS_NVME_UNCOMPRESSED_CLAIMS } from "./zfs-nvme-uncompressed-claims.ts";
import { ZfsVolume, type ZfsVolumeProps } from "./zfs-volume.ts";
import { pvcBackupPolicyKey } from "@shepherdjerred/homelab/cdk8s/src/backup-policy/pvc-backup-policy.ts";

/**
 * The storage class a `ZfsNvmeVolume` claim renders with. New claims get lz4:
 * it costs little CPU, aborts early on incompressible data, and cuts the
 * bytes written to the NVMe pool. Claims provisioned before lz4 became the
 * default keep `zfs-ssd`, because a PVC's class is immutable.
 */
export function zfsNvmeStorageClass(namespace: string, name: string): string {
  return ZFS_NVME_UNCOMPRESSED_CLAIMS.has(pvcBackupPolicyKey(namespace, name))
    ? NVME_STORAGE_CLASS
    : NVME_STORAGE_CLASS_LZ4;
}

/** A claim on the production NVMe ZFS pool, lz4-compressed by default. */
export class ZfsNvmeVolume extends ZfsVolume {
  constructor(scope: Construct, id: string, props: ZfsVolumeProps) {
    super(scope, id, props, (namespace) => zfsNvmeStorageClass(namespace, id));
  }
}
