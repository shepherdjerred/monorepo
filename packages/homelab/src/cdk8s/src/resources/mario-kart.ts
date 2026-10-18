import { Size, type Chart } from "cdk8s";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";

/** Storage-only recovery anchor; active services belong to Arcade. */
export function createMarioKartResources(chart: Chart) {
  new ZfsNvmeVolume(chart, "mario-kart-volume", { storage: Size.gibibytes(8) });
  new ZfsNvmeVolume(chart, "mario-kart-rom-volume", {
    storage: Size.gibibytes(1),
  });
  new ZfsNvmeVolume(chart, "mario-kart-data-volume", {
    storage: Size.gibibytes(1),
  });

  new ZfsNvmeVolume(chart, "mario-kart-edge-data", {
    storage: Size.gibibytes(1),
  });
}
