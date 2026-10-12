import { Size, type Chart } from "cdk8s";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";

export function createForumStorage(
  chart: Chart,
  stage: "beta" | "prod",
  slot: "primary" | "recovery",
) {
  const primary = {
    files: new ZfsNvmeVolume(chart, "storm-forum-files", {
      storage: Size.gibibytes(32),
    }),
    database: new ZfsNvmeVolume(chart, "storm-forum-database", {
      storage: Size.gibibytes(32),
    }),
  };
  if (stage === "prod") return primary;
  // Keep both pairs declared: switching beta to recovery must never prune its
  // existing database or attachments. Restore refuses an occupied recovery pair.
  const recovery = {
    files: new ZfsNvmeVolume(chart, "storm-forum-recovery-files", {
      storage: Size.gibibytes(32),
    }),
    database: new ZfsNvmeVolume(chart, "storm-forum-recovery-database", {
      storage: Size.gibibytes(32),
    }),
  };
  return slot === "recovery" ? recovery : primary;
}
