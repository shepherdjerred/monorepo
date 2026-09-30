import { Chart } from "cdk8s";
import { merge } from "lodash";
import type { PersistentVolumeClaimProps } from "cdk8s-plus-31";
import {
  PersistentVolumeAccessMode,
  PersistentVolumeClaim,
  PersistentVolumeMode,
} from "cdk8s-plus-31";
import { Construct } from "constructs";
import { NVME_STORAGE_CLASS } from "./storage-classes.ts";
import type { SetRequired } from "type-fest";
import {
  getPvcBackupLabels,
  getPvcBackupPolicy,
} from "@shepherdjerred/homelab/cdk8s/src/backup-policy/pvc-backup-policy.ts";

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
      storageClassName: NVME_STORAGE_CLASS,
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
