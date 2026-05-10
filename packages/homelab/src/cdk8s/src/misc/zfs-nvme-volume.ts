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
import { Size } from "cdk8s";

type ZfsNvmeVolumeProps = Omit<
  SetRequired<PersistentVolumeClaimProps, "storage">,
  "storageClassName" | "accessModes" | "volumeMode" | "metadata"
> & {
  backupEnabled?: boolean;
};

export class ZfsNvmeVolume extends Construct {
  public readonly claim: PersistentVolumeClaim;
  constructor(scope: Construct, id: string, props: ZfsNvmeVolumeProps) {
    super(scope, id);

    // Check if storage is under 200GB for backup labeling
    // Use native CDK8s Size conversion methods for accurate comparison
    const shouldBackup =
      props.backupEnabled ??
      props.storage.toKibibytes() < Size.gibibytes(200).toKibibytes();

    const { backupEnabled: _backupEnabled, ...claimProps } = props;

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

    this.claim = new PersistentVolumeClaim(
      scope,
      `${id}-pvc`,
      merge({}, baseProps, claimProps),
    );
  }
}
