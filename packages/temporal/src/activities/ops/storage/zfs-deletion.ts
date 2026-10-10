import type { DeletingZfsVolume } from "@shepherdjerred/ops-clients/kubernetes-storage.ts";
import type { PrometheusSample } from "@shepherdjerred/ops-clients/prometheus.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { Gauge } from "prom-client";
import { register } from "#observability/metrics.ts";
import { logsLink } from "#activities/ops/ops-links.ts";

const deleting = new Gauge({
  name: "zfs_deleting_volume_timestamp_seconds",
  help: "Deletion start time of a ZFSVolume still present in the API",
  labelNames: ["node", "dataset_name"] as const,
  registers: [register],
});
const observed = new Gauge({
  name: "zfs_deletion_inventory_timestamp_seconds",
  help: "Last complete ZFSVolume inventory read",
  labelNames: ["collector"] as const,
  registers: [register],
});
export const ZFS_DELETION_BYTES_QUERY =
  "max by (node,dataset_name) (zfs_dataset_referenced_bytes)";

export function zfsDeletionSignals(
  volumes: readonly DeletingZfsVolume[],
  bytes: readonly PrometheusSample[],
  now: Date,
): SignalInput[] {
  deleting.reset();
  const signals: SignalInput[] = [];
  for (const volume of volumes) {
    deleting.set(
      { node: volume.node, dataset_name: volume.dataset },
      Date.parse(volume.deletedAt) / 1000,
    );
    if (now.getTime() - Date.parse(volume.deletedAt) <= 3_600_000) continue;
    const sample = bytes.find(
      (item) =>
        item.metric["node"] === volume.node &&
        item.metric["dataset_name"] === volume.dataset,
    );
    if (sample === undefined) continue; // A stale CR alone does not prove a retained dataset.
    signals.push({
      id: `maintenance:zfs-deletion:${volume.node}:${volume.name}`,
      source: "maintenance",
      section: "maintenance",
      kind: "storage-deletion",
      severity: "warning",
      needsMe: true,
      title: `ZFS dataset deletion stuck on ${volume.node}`,
      detail: `${volume.dataset} has remained deleting for over an hour and still references ${sample.value.toString()} bytes. Capture mount, file-descriptor and container holder evidence before recovery.`,
      since: volume.deletedAt,
      attributes: {
        node: volume.node,
        dataset: volume.dataset,
        referencedBytes: sample.value,
      },
      links: [logsLink("openebs")],
    });
  }
  observed.set({ collector: "infra" }, now.getTime() / 1000);
  return signals;
}
