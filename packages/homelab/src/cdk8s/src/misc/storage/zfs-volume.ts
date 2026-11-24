import { Chart } from "cdk8s";
import { merge } from "lodash";
import type { PersistentVolumeClaimProps } from "cdk8s-plus-31";
import {
  PersistentVolumeAccessMode,
  PersistentVolumeClaim,
  PersistentVolumeMode,
} from "cdk8s-plus-31";
import { Construct } from "constructs";
import type { SetRequired } from "type-fest";
import {
  getPvcBackupLabels,
  getPvcBackupPolicy,
} from "@shepherdjerred/homelab/cdk8s/src/backup-policy/pvc-backup-policy.ts";

/** What a caller may set on a ZFS claim; the pool fixes the rest. */
export type ZfsVolumeProps = Omit<
  SetRequired<PersistentVolumeClaimProps, "storage">,
  "storageClassName" | "accessModes" | "volumeMode" | "metadata"
>;

/**
 * A single-node ReadWriteOnce filesystem claim on a ZFS pool, named `id` and
 * labelled with its backup policy. The claim is created in `scope` as
 * `${id}-pvc`, so a claim's construct path and name never depend on which
 * pool subclass declares it.
 */
export abstract class ZfsVolume extends Construct {
  public readonly claim: PersistentVolumeClaim;
  protected constructor(
    scope: Construct,
    id: string,
    props: ZfsVolumeProps,
    storageClassName: (namespace: string) => string,
  ) {
    super(scope, id);

    const namespace = Chart.of(scope).namespace;
    if (namespace === undefined) {
      throw new Error(`ZFS PVC ${id} must belong to a namespaced chart`);
    }
    const backupLabels = getPvcBackupLabels(getPvcBackupPolicy(namespace, id));

    const baseProps: PersistentVolumeClaimProps = {
      storage: props.storage,
      storageClassName: storageClassName(namespace),
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
