import { Chart } from "cdk8s";
import { merge } from "lodash";
import type { PersistentVolumeClaimProps } from "cdk8s-plus-31";
import {
  PersistentVolumeAccessMode,
  PersistentVolumeClaim,
  PersistentVolumeMode,
} from "cdk8s-plus-31";
import { Construct } from "constructs";
import {
  NVME_STORAGE_CLASS,
  NVME_STORAGE_CLASS_LZ4,
} from "./storage-classes.ts";
import { ZFS_NVME_UNCOMPRESSED_CLAIMS } from "./zfs-nvme-uncompressed-claims.ts";
import type { SetRequired } from "type-fest";
import {
  getPvcBackupLabels,
  getPvcBackupPolicy,
  pvcBackupPolicyKey,
} from "@shepherdjerred/homelab/cdk8s/src/backup-policy/pvc-backup-policy.ts";

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
export class ZfsNvmeVolume extends Construct {
  public readonly claim: PersistentVolumeClaim;
  constructor(
    scope: Construct,
    id: string,
    props: Omit<
      SetRequired<PersistentVolumeClaimProps, "storage">,
      "storageClassName" | "accessModes" | "volumeMode" | "metadata"
    >,
  ) {
    super(scope, id);

    const namespace = Chart.of(scope).namespace;
    if (namespace === undefined) {
      throw new Error(`ZFS PVC ${id} must belong to a namespaced chart`);
    }
    const backupLabels = getPvcBackupLabels(getPvcBackupPolicy(namespace, id));

    const baseProps: PersistentVolumeClaimProps = {
      storage: props.storage,
      storageClassName: zfsNvmeStorageClass(namespace, id),
      accessModes: [PersistentVolumeAccessMode.READ_WRITE_ONCE],
      volumeMode: PersistentVolumeMode.FILE_SYSTEM,
      metadata: {
        name: id,
        labels: backupLabels,
      },
    };

    this.claim = new PersistentVolumeClaim(
      scope,
      `${id}-pvc`,
      merge({}, baseProps, props),
    );
  }
}
