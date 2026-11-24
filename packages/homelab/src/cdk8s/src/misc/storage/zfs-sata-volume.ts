import type { Construct } from "constructs";
import { SATA_STORAGE_CLASS } from "./storage-classes.ts";
import { ZfsVolume, type ZfsVolumeProps } from "./zfs-volume.ts";

/** A claim on the SATA HDD ZFS pool. */
export class ZfsSataVolume extends ZfsVolume {
  constructor(scope: Construct, id: string, props: ZfsVolumeProps) {
    super(scope, id, props, () => SATA_STORAGE_CLASS);
  }
}
