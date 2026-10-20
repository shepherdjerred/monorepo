import { Size, type Chart } from "cdk8s";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";

/** Storage-only recovery anchor; old bookmarks redirect through Arcade's edge. */
export function createPokemonResources(chart: Chart) {
  new ZfsNvmeVolume(chart, "pokemon-volume", { storage: Size.gibibytes(8) });
}
