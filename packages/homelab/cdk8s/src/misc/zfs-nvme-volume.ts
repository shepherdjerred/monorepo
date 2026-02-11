import { merge } from "lodash";
import {
  PersistentVolumeAccessMode,
  PersistentVolumeClaim,
  PersistentVolumeClaimProps,
  PersistentVolumeMode,
} from "cdk8s-plus-31";
import { Construct } from "constructs";
import { NVME_STORAGE_CLASS } from "./storage-classes.ts";
import type { SetRequired } from "type-fest";
import { Size } from "cdk8s";

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

    // Check if storage is under 200GB for backup labeling
    // Use native CDK8s Size conversion methods for accurate comparison
    const shouldBackup = props.storage.toKibibytes() < Size.gibibytes(200).toKibibytes();

    const baseProps: PersistentVolumeClaimProps = {
      storage: props.storage,
      storageClassName: NVME_STORAGE_CLASS,
      accessModes: [PersistentVolumeAccessMode.READ_WRITE_ONCE],
      volumeMode: PersistentVolumeMode.FILE_SYSTEM,
      metadata: {
        name: id,
        labels: {
          "velero.io/backup": shouldBackup ? "enabled" : "disabled",
          "velero.io/exclude-from-backup": shouldBackup ? "false" : "true",
        },
      },
    };

    this.claim = new PersistentVolumeClaim(scope, `${id}-pvc`, merge({}, baseProps, props));
  }
}
