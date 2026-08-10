import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import {
  createTimeseriesPanel,
  createStatPanel,
} from "./buildkite-dashboard-panels.ts";

const PVC_FILTER = 'persistentvolumeclaim=~"$volume"';

export function addStorageCapacityPanels(
  builder: dashboard.DashboardBuilder,
): void {
  builder.withRow(new dashboard.RowBuilder("PVC & Pool Capacity"));

  builder.withPanel(
    createTimeseriesPanel({
      title: "PVC Fill",
      targets: [
        {
          query: `kubelet_volume_stats_used_bytes{${PVC_FILTER}} / kubelet_volume_stats_capacity_bytes{${PVC_FILTER}}`,
          legend: "{{namespace}} · {{persistentvolumeclaim}}",
        },
      ],
      gridPos: { x: 0, y: 93, w: 8, h: 8 },
      unit: "percentunit",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "PVC 7d / 30d Growth",
      targets: [
        {
          query: `delta(kubelet_volume_stats_used_bytes{${PVC_FILTER}}[7d])`,
          legend: "{{namespace}} · {{persistentvolumeclaim}} 7d",
        },
        {
          query: `delta(kubelet_volume_stats_used_bytes{${PVC_FILTER}}[30d])`,
          legend: "{{namespace}} · {{persistentvolumeclaim}} 30d",
        },
      ],
      gridPos: { x: 8, y: 93, w: 8, h: 8 },
      unit: "bytes",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "PVC Projected Days to Full",
      targets: [
        {
          query: `(
  kubelet_volume_stats_available_bytes{${PVC_FILTER}}
  / deriv(kubelet_volume_stats_used_bytes{${PVC_FILTER}}[7d])
  / 86400
)
and on (namespace, persistentvolumeclaim)
deriv(kubelet_volume_stats_used_bytes{${PVC_FILTER}}[7d]) > 0
and on (namespace, persistentvolumeclaim)
kubelet_volume_stats_used_bytes{${PVC_FILTER}} offset 7d`,
          legend: "{{namespace}} · {{persistentvolumeclaim}}",
        },
      ],
      gridPos: { x: 16, y: 93, w: 8, h: 8 },
      unit: "d",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "PVC Inode Pressure",
      targets: [
        {
          query: `1 - (kubelet_volume_stats_inodes_free{${PVC_FILTER}} / kubelet_volume_stats_inodes{${PVC_FILTER}})`,
          legend: "{{namespace}} · {{persistentvolumeclaim}}",
        },
      ],
      gridPos: { x: 0, y: 101, w: 8, h: 8 },
      unit: "percentunit",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "ZFS Pool Fragmentation",
      targets: [
        {
          query: "zfs_zpool_fragmentation",
          legend: "{{node}} · {{zpool_name}}",
        },
      ],
      gridPos: { x: 8, y: 101, w: 8, h: 8 },
      unit: "percent",
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "ZFS Pool Free Space",
      query: "zfs_zpool_free_bytes",
      legend: "{{node}} · {{zpool_name}}",
      gridPos: { x: 16, y: 101, w: 8, h: 8 },
      unit: "bytes",
    }),
  );
}
