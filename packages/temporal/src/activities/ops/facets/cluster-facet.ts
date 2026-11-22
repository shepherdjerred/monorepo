import type {
  ArgoApplication,
  KubernetesClient,
  NodeStatus,
  PodStatus,
  VeleroBackupStatus,
  VeleroScheduleStatus,
} from "@shepherdjerred/ops-clients/kubernetes.ts";
import type {
  PrometheusClient,
  PrometheusSample,
} from "@shepherdjerred/ops-clients/prometheus.ts";
import type { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import type { ClusterFacet } from "@shepherdjerred/ops-model/facets.ts";
import {
  buildDatabases,
  buildNvmeDrives,
  buildZpools,
  resolveNodeName,
} from "./cluster-storage-helpers.ts";
import { buildWorkloads } from "./cluster-workload-helpers.ts";

export const CLUSTER_PROM_QUERIES = {
  cpuCores: 'count by (node, instance) (node_cpu_seconds_total{mode="idle"})',
  cpuRatio:
    '1 - avg by (node, instance) (rate(node_cpu_seconds_total{mode="idle"}[5m]))',
  memTotal: "max by (node, instance) (node_memory_MemTotal_bytes)",
  memRatio:
    "1 - max by (node, instance) (node_memory_MemAvailable_bytes) / max by (node, instance) (node_memory_MemTotal_bytes)",
  zfsArc: "max by (node, instance) (node_zfs_arc_size or zfs_arc_size)",
  nodeTemp: "max by (node, instance) (node_hwmon_temp_celsius)",
  nodeUname: "node_uname_info",
  zpoolSize: "max by (node, instance, zpool_name) (zfs_zpool_size_bytes)",
  zpoolFree: "max by (node, instance, zpool_name) (zfs_zpool_free_bytes)",
  zpoolFrag: "max by (node, instance, zpool_name) (zfs_zpool_fragmentation)",
  zpoolHealth: "max by (node, instance, zpool_name, health) (zfs_zpool == 1)",
  nvmeWritten24h:
    "(increase(nvme_data_units_written_total[24h]) * 512000) * on(device, instance) group_left(serial, model) nvme_device_info",
  nvmeBudget: "nvme_drive:write_budget_bytes_per_day:5y",
  nvmeSize:
    "nvme_physical_size_bytes * on(device, instance) group_left(serial, model) nvme_device_info",
  nvmeWear:
    "(nvme_percentage_used_ratio * 100) * on(device, instance) group_left(serial, model) nvme_device_info",
  nvmeTemp:
    "nvme_temperature_celsius * on(device, instance) group_left(serial, model) nvme_device_info",
  swVolumes: "sum(SeaweedFS_volumeServer_volumes)",
  swMaxVolumes: "sum(SeaweedFS_volumeServer_max_volumes)",
  swBackupLag:
    'clamp_min((max(SeaweedFS_filer_last_send_timestamp_of_subscribe{clientName=~"filer:.*"}) - max(SeaweedFS_filer_last_send_timestamp_of_subscribe{clientName="backup_s3"})) / 1e9, 0)',
  swBuckets: "count(count by (bucket) (SeaweedFS_s3_bucket_size_bytes))",
  pvcUsed:
    "max by (namespace, persistentvolumeclaim) (kubelet_volume_stats_used_bytes)",
  pvcCap:
    "max by (namespace, persistentvolumeclaim) (kubelet_volume_stats_capacity_bytes)",
  podPvcs:
    "max by (namespace, pod, persistentvolumeclaim) (kube_pod_spec_volumes_persistentvolumeclaims_info)",
  backedUpPvcs:
    'max by (namespace, persistentvolumeclaim) (kube_persistentvolumeclaim_labels{label_velero_io_backup="enabled"})',
  veleroLastStatus:
    'max by (schedule) (velero_backup_last_status{schedule!=""})',
  restarts24h:
    "sum by (namespace, pod) (increase(kube_pod_container_status_restarts_total[24h]))",
  oomKills24h:
    'sum by (namespace, pod) (increase(kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}[24h]))',
  deploySpec: "max by (namespace, deployment) (kube_deployment_spec_replicas)",
  deployReady:
    "max by (namespace, deployment) (kube_deployment_status_replicas_ready)",
  stsSpec: "max by (namespace, statefulset) (kube_statefulset_replicas)",
  stsReady:
    "max by (namespace, statefulset) (kube_statefulset_status_replicas_ready)",
  dsSpec:
    "max by (namespace, daemonset) (kube_daemonset_status_desired_number_scheduled)",
  dsReady: "max by (namespace, daemonset) (kube_daemonset_status_number_ready)",
  podImages: "max by (namespace, pod, image) (kube_pod_container_info)",
} as const;

type ClusterPromKey = keyof typeof CLUSTER_PROM_QUERIES;
type ClusterPromMap = Record<ClusterPromKey, PrometheusSample[]>;

const CLUSTER_PROM_KEYS = [
  "cpuCores",
  "cpuRatio",
  "memTotal",
  "memRatio",
  "zfsArc",
  "nodeTemp",
  "nodeUname",
  "zpoolSize",
  "zpoolFree",
  "zpoolFrag",
  "zpoolHealth",
  "nvmeWritten24h",
  "nvmeBudget",
  "nvmeSize",
  "nvmeWear",
  "nvmeTemp",
  "swVolumes",
  "swMaxVolumes",
  "swBackupLag",
  "swBuckets",
  "pvcUsed",
  "pvcCap",
  "podPvcs",
  "backedUpPvcs",
  "veleroLastStatus",
  "restarts24h",
  "oomKills24h",
  "deploySpec",
  "deployReady",
  "stsSpec",
  "stsReady",
  "dsSpec",
  "dsReady",
  "podImages",
] as const satisfies readonly ClusterPromKey[];

function emptyPromMap(): ClusterPromMap {
  return {
    cpuCores: [],
    cpuRatio: [],
    memTotal: [],
    memRatio: [],
    zfsArc: [],
    nodeTemp: [],
    nodeUname: [],
    zpoolSize: [],
    zpoolFree: [],
    zpoolFrag: [],
    zpoolHealth: [],
    nvmeWritten24h: [],
    nvmeBudget: [],
    nvmeSize: [],
    nvmeWear: [],
    nvmeTemp: [],
    swVolumes: [],
    swMaxVolumes: [],
    swBackupLag: [],
    swBuckets: [],
    pvcUsed: [],
    pvcCap: [],
    podPvcs: [],
    backedUpPvcs: [],
    veleroLastStatus: [],
    restarts24h: [],
    oomKills24h: [],
    deploySpec: [],
    deployReady: [],
    stsSpec: [],
    stsReady: [],
    dsSpec: [],
    dsReady: [],
    podImages: [],
  };
}

function nodeMetricLookup(
  samples: readonly PrometheusSample[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of samples) {
    const name = resolveNodeName(s.metric);
    if (name !== "" && Number.isFinite(s.value)) {
      map.set(name, s.value);
    }
  }
  return map;
}

function firstScalar(samples: readonly PrometheusSample[]): number | null {
  const val = samples[0]?.value;
  return val !== undefined && Number.isFinite(val) ? val : null;
}

function parseTalosVersion(osImage: string): string | null {
  const match = /\((v[^)]+)\)/u.exec(osImage);
  return match?.[1] ?? null;
}

function buildNodes(
  nodes: readonly NodeStatus[],
  prom: ClusterPromMap,
): ClusterFacet["nodes"] {
  const cores = nodeMetricLookup(prom.cpuCores);
  const cpuRatio = nodeMetricLookup(prom.cpuRatio);
  const memTotal = nodeMetricLookup(prom.memTotal);
  const memRatio = nodeMetricLookup(prom.memRatio);
  const zfsArc = nodeMetricLookup(prom.zfsArc);
  const temp = nodeMetricLookup(prom.nodeTemp);
  const kernelByNode = new Map<string, string>();
  for (const s of prom.nodeUname) {
    const name = resolveNodeName(s.metric);
    const release = s.metric["release"];
    if (name !== "" && release !== undefined && release !== "") {
      kernelByNode.set(name, release);
    }
  }

  return nodes
    .map((node) => {
      const cr = cpuRatio.get(node.name);
      const mr = memRatio.get(node.name);
      const arc = zfsArc.get(node.name);
      const t = temp.get(node.name);
      return {
        name: node.name,
        ready: node.ready,
        cpuCores: Math.round(cores.get(node.name) ?? 0),
        cpuRatio: cr === undefined ? null : Math.round(cr * 1000) / 1000,
        memoryBytes: Math.round(memTotal.get(node.name) ?? 0),
        memoryRatio: mr === undefined ? null : Math.round(mr * 1000) / 1000,
        zfsArcBytes: arc === undefined ? null : Math.round(arc),
        tempCelsius: t === undefined ? null : Math.round(t * 10) / 10,
        kubeletVersion: node.kubeletVersion,
        talosVersion: parseTalosVersion(node.osImage),
        kernelVersion: kernelByNode.get(node.name) ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function queryPromSafe(
  prometheus: PrometheusClient | undefined,
): Promise<ClusterPromMap> {
  const result = emptyPromMap();
  if (prometheus === undefined) {
    return result;
  }
  const settled = await Promise.allSettled(
    CLUSTER_PROM_KEYS.map((key) =>
      prometheus.query(CLUSTER_PROM_QUERIES[key], AbortSignal.timeout(8000)),
    ),
  );
  for (const [idx, key] of CLUSTER_PROM_KEYS.entries()) {
    const entry = settled[idx];
    if (entry?.status === "fulfilled") {
      result[key] = entry.value;
    }
  }
  return result;
}

type ClusterKubernetesInput = Pick<
  KubernetesClient,
  | "listNodes"
  | "listPods"
  | "listArgoApplications"
  | "listVeleroBackups"
  | "listVeleroSchedules"
>;

async function safeList<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch {
    return [];
  }
}

async function fetchKubernetesLists(
  k8s: ClusterKubernetesInput | undefined,
): Promise<{
  nodes: NodeStatus[];
  pods: PodStatus[];
  argoApps: ArgoApplication[];
  backups: VeleroBackupStatus[];
  schedules: VeleroScheduleStatus[];
}> {
  if (k8s === undefined) {
    return {
      nodes: [],
      pods: [],
      argoApps: [],
      backups: [],
      schedules: [],
    };
  }
  const [nodes, pods, argoApps, backups, schedules] = await Promise.all([
    safeList(() => k8s.listNodes()),
    safeList(() => k8s.listPods()),
    safeList(() => k8s.listArgoApplications()),
    safeList(() => k8s.listVeleroBackups()),
    safeList(() => k8s.listVeleroSchedules()),
  ]);
  return { nodes, pods, argoApps, backups, schedules };
}

function buildSeaweedfs(prom: ClusterPromMap): ClusterFacet["seaweedfs"] {
  const lagRaw = firstScalar(prom.swBackupLag);
  return {
    volumeCount: Math.round(firstScalar(prom.swVolumes) ?? 0),
    maxVolumes: Math.round(firstScalar(prom.swMaxVolumes) ?? 0),
    backupLagSeconds: lagRaw === null ? null : Math.max(0, Math.round(lagRaw)),
    bucketsCount: Math.round(firstScalar(prom.swBuckets) ?? 0),
  };
}

function buildArgoApps(
  apps: readonly ArgoApplication[],
): ClusterFacet["argoApps"] {
  return apps
    .map((app) => ({
      name: app.name,
      namespace: "argocd",
      syncStatus: app.sync,
      healthStatus: app.health,
      revision: (app.revision ?? "").slice(0, 12),
      autoSync: app.name !== "apps" && app.name !== "argocd",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function collectClusterFacet(input: {
  services: ServiceIndex;
  kubernetes?: ClusterKubernetesInput;
  prometheus?: PrometheusClient;
}): Promise<ClusterFacet> {
  const [k8sLists, prom] = await Promise.all([
    fetchKubernetesLists(input.kubernetes),
    queryPromSafe(input.prometheus),
  ]);

  const { workloadSummary, workloads } = buildWorkloads({
    pods: k8sLists.pods,
    argoApps: k8sLists.argoApps,
    prom,
    services: input.services,
  });

  return {
    nodes: buildNodes(k8sLists.nodes, prom),
    workloadSummary,
    workloads,
    databases: buildDatabases({
      pods: k8sLists.pods,
      pvcUsed: prom.pvcUsed,
      pvcCap: prom.pvcCap,
      podPvcs: prom.podPvcs,
      backedUpPvcs: prom.backedUpPvcs,
      veleroLastStatus: prom.veleroLastStatus,
      veleroBackups: k8sLists.backups,
      veleroSchedules: k8sLists.schedules,
    }),
    zpools: buildZpools({
      size: prom.zpoolSize,
      free: prom.zpoolFree,
      frag: prom.zpoolFrag,
      health: prom.zpoolHealth,
    }),
    nvmeDrives: buildNvmeDrives({
      written24h: prom.nvmeWritten24h,
      budget: prom.nvmeBudget,
      size: prom.nvmeSize,
      wear: prom.nvmeWear,
      temp: prom.nvmeTemp,
    }),
    seaweedfs: buildSeaweedfs(prom),
    argoApps: buildArgoApps(k8sLists.argoApps),
  };
}
