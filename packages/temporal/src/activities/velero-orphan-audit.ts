import { Context } from "@temporalio/activity";
import * as k8s from "@kubernetes/client-node";
import { z } from "zod";
import {
  veleroLiveBackupCount,
  veleroOrphanAuditDurationSeconds,
  veleroOrphanAuditRunsTotal,
  veleroOrphanLocalBytes,
  veleroOrphanLocalBytesTotal,
  veleroOrphanLocalSnapshots,
  veleroOrphanLocalSnapshotsTotal,
  zfsDatasetSnapshotCount,
} from "#observability/metrics.ts";

// The audit detects ZFS snapshots on PVC datasets whose name does not match
// any live `velero.io/v1/Backup` CR. Such snapshots are orphans from a prior
// Velero deployment whose deletion path failed to run during teardown.
//
// R2 detection is intentionally NOT included here because the worker's S3
// credentials are scoped to SeaweedFS, not R2. The remediation runbook
// (packages/docs/guides/2026-05-05_velero-orphan-snapshot-remediation.md)
// covers the manual R2 check using extracted Velero credentials.
//
// See: packages/docs/decisions/2026-05-05_velero-orphan-snapshot-prevention.md

const NAMESPACE_OPENEBS = "openebs";
const ZFS_NODE_LABEL = "role=openebs-zfs,app=openebs-zfs-node";
const ZFS_NODE_CONTAINER = "openebs-zfs-plugin";
const VELERO_API_GROUP = "velero.io";
const VELERO_API_VERSION = "v1";
const VELERO_NAMESPACE = "velero";

export type VeleroOrphanDataset = {
  node: string;
  pool: string;
  dataset: string;
  orphanCount: number;
  orphanBytes: number;
  liveCount: number;
};

type ZfsNodePod = {
  node: string;
  pod: string;
};

type ZfsNodePodCandidate = {
  metadata?: {
    name?: string;
  };
  spec?: {
    nodeName?: string;
  };
  status?: {
    phase?: string;
    conditions?: {
      type: string;
      status: string;
    }[];
  };
};

export type VeleroOrphanAuditResult = {
  liveBackupCount: number;
  totalSnapshotCount: number;
  totalOrphanCount: number;
  totalOrphanBytes: number;
  datasets: VeleroOrphanDataset[];
  workflowDurationSeconds: number;
};

export type VeleroOrphanAuditActivities = typeof veleroOrphanAuditActivities;

export const veleroOrphanAuditActivities = {
  async runVeleroOrphanAudit(): Promise<VeleroOrphanAuditResult> {
    const startedAt = Date.now();
    let outcome: "success" | "failure" = "failure";
    try {
      Context.current().heartbeat({ phase: "list-velero-backups" });
      const liveBackups = await listLiveVeleroBackups();

      Context.current().heartbeat({ phase: "find-zfs-node-pods" });
      const nodePods = await findZfsNodePods();

      Context.current().heartbeat({ phase: "list-zfs-orphans" });
      const datasets = await listZfsOrphanSnapshots(nodePods, liveBackups);

      const totalOrphanCount = datasets.reduce(
        (sum, d) => sum + d.orphanCount,
        0,
      );
      const totalOrphanBytes = datasets.reduce(
        (sum, d) => sum + d.orphanBytes,
        0,
      );
      const totalSnapshotCount = datasets.reduce(
        (sum, d) => sum + d.orphanCount + d.liveCount,
        0,
      );

      // Reset per-dataset gauges before re-populating; otherwise stale labels
      // from removed datasets persist forever.
      veleroOrphanLocalSnapshots.reset();
      veleroOrphanLocalBytes.reset();
      zfsDatasetSnapshotCount.reset();
      for (const d of datasets) {
        veleroOrphanLocalSnapshots.set(
          { node: d.node, pool: d.pool, dataset: d.dataset },
          d.orphanCount,
        );
        veleroOrphanLocalBytes.set(
          { node: d.node, pool: d.pool, dataset: d.dataset },
          d.orphanBytes,
        );
        zfsDatasetSnapshotCount.set(
          { node: d.node, pool: d.pool, dataset: d.dataset },
          d.orphanCount + d.liveCount,
        );
      }
      veleroOrphanLocalSnapshotsTotal.set(totalOrphanCount);
      veleroOrphanLocalBytesTotal.set(totalOrphanBytes);
      veleroLiveBackupCount.set(liveBackups.length);

      outcome = "success";
      return {
        liveBackupCount: liveBackups.length,
        totalSnapshotCount,
        totalOrphanCount,
        totalOrphanBytes,
        datasets,
        workflowDurationSeconds: (Date.now() - startedAt) / 1000,
      };
    } finally {
      veleroOrphanAuditRunsTotal.inc({ outcome });
      veleroOrphanAuditDurationSeconds.observe((Date.now() - startedAt) / 1000);
    }
  },
};

function loadCustomObjectsApi(): k8s.CustomObjectsApi {
  const kc = new k8s.KubeConfig();
  kc.loadFromCluster();
  return kc.makeApiClient(k8s.CustomObjectsApi);
}

function loadCoreApi(): k8s.CoreV1Api {
  const kc = new k8s.KubeConfig();
  kc.loadFromCluster();
  return kc.makeApiClient(k8s.CoreV1Api);
}

const BackupListSchema = z.object({
  items: z
    .array(
      z.object({
        metadata: z
          .object({
            name: z.string().min(1).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

async function listLiveVeleroBackups(): Promise<string[]> {
  const api = loadCustomObjectsApi();
  const response: unknown = await api.listNamespacedCustomObject({
    group: VELERO_API_GROUP,
    version: VELERO_API_VERSION,
    namespace: VELERO_NAMESPACE,
    plural: "backups",
  });
  const parsed = BackupListSchema.parse(response);
  const names: string[] = [];
  for (const item of parsed.items ?? []) {
    const name = item.metadata?.name;
    if (typeof name === "string" && name.length > 0) {
      names.push(name);
    }
  }
  return names.toSorted();
}

async function findZfsNodePods(): Promise<ZfsNodePod[]> {
  const pods = await loadCoreApi().listNamespacedPod({
    namespace: NAMESPACE_OPENEBS,
    labelSelector: ZFS_NODE_LABEL,
  });
  return selectZfsNodePods(pods.items);
}

export function selectZfsNodePods(
  pods: readonly ZfsNodePodCandidate[],
): ZfsNodePod[] {
  const nodePods = new Map<string, string>();
  for (const pod of pods) {
    const isReady = pod.status?.conditions?.some(
      (condition) => condition.type === "Ready" && condition.status === "True",
    );
    if (pod.status?.phase !== "Running" || isReady !== true) {
      continue;
    }
    const name = pod.metadata?.name;
    const node = pod.spec?.nodeName;
    if (name === undefined || node === undefined) {
      throw new Error(
        "Running and Ready openebs-zfs-localpv-node pod is missing metadata.name or spec.nodeName",
      );
    }
    const existingPod = nodePods.get(node);
    if (existingPod !== undefined) {
      throw new Error(
        `Multiple Running and Ready openebs-zfs-localpv-node pods found for node ${node}: ${existingPod}, ${name}`,
      );
    }
    nodePods.set(node, name);
  }
  if (nodePods.size === 0) {
    throw new Error(
      `No Running and Ready openebs-zfs-localpv-node pods found in ${NAMESPACE_OPENEBS} (label selector: ${ZFS_NODE_LABEL})`,
    );
  }
  return [...nodePods.entries()]
    .map(([node, pod]) => ({ node, pod }))
    .toSorted((left, right) => left.node.localeCompare(right.node));
}

async function listZfsOrphanSnapshots(
  nodePods: readonly ZfsNodePod[],
  liveBackups: readonly string[],
): Promise<VeleroOrphanDataset[]> {
  const datasets: VeleroOrphanDataset[] = [];
  for (const nodePod of nodePods) {
    Context.current().heartbeat({
      phase: "list-node-zfs",
      node: nodePod.node,
      pod: nodePod.pod,
    });
    const inventory = await execInPod(
      nodePod.pod,
      "PATH=$PATH:/usr/local/sbin:/usr/sbin:/sbin zfs list -H -p -t filesystem,volume,snapshot -o name,type,used",
    );
    datasets.push(...parseZfsInventory(nodePod.node, inventory, liveBackups));
  }
  return datasets.toSorted(
    (left, right) =>
      left.node.localeCompare(right.node) ||
      left.dataset.localeCompare(right.dataset),
  );
}

type MutableDatasetSummary = {
  node: string;
  pool: string;
  dataset: string;
  orphanCount: number;
  orphanBytes: number;
  liveCount: number;
};

type ZfsInventoryRow = {
  name: string;
  type: "filesystem" | "snapshot" | "volume";
  used: number;
};

function parseZfsInventoryRow(
  node: string,
  rowNumber: number,
  line: string,
): ZfsInventoryRow {
  const fields = line.split("\t");
  if (fields.length !== 3) {
    throw new TypeError(
      `Malformed zfs list row ${String(rowNumber)} on ${node}: expected 3 tab-separated fields`,
    );
  }
  const [name, type, usedString] = fields;
  if (name === undefined || type === undefined || usedString === undefined) {
    throw new TypeError(
      `Malformed zfs list row ${String(rowNumber)} on ${node}: missing field`,
    );
  }
  if (type !== "filesystem" && type !== "snapshot" && type !== "volume") {
    throw new TypeError(`Unexpected ZFS object type on ${node}: ${type}`);
  }
  if (!/^\d+$/.test(usedString)) {
    throw new TypeError(
      `Malformed zfs list row ${String(rowNumber)} on ${node}: used bytes is not an integer`,
    );
  }
  const used = Number.parseInt(usedString, 10);
  if (!Number.isSafeInteger(used)) {
    throw new TypeError(
      `Malformed zfs list row ${String(rowNumber)} on ${node}: used bytes exceeds safe integer range`,
    );
  }
  return { name, type, used };
}

export function parseZfsInventory(
  node: string,
  inventory: string,
  liveBackups: readonly string[],
): VeleroOrphanDataset[] {
  const liveSet = new Set(liveBackups);
  const datasets = new Map<string, MutableDatasetSummary>();
  const snapshots: { dataset: string; snapshot: string; used: number }[] = [];

  for (const [index, line] of inventory.split("\n").entries()) {
    if (line.trim().length === 0) {
      continue;
    }
    const row = parseZfsInventoryRow(node, index + 1, line);

    if (row.type === "snapshot") {
      const separator = row.name.indexOf("@");
      if (separator <= 0 || separator === row.name.length - 1) {
        throw new TypeError(
          `Malformed ZFS snapshot name on ${node}: ${row.name}`,
        );
      }
      const dataset = row.name.slice(0, separator);
      if (dataset.includes("/pvc-")) {
        snapshots.push({
          dataset,
          snapshot: row.name.slice(separator + 1),
          used: row.used,
        });
      }
      continue;
    }
    if (!row.name.includes("/pvc-")) {
      continue;
    }
    const slash = row.name.indexOf("/");
    if (slash <= 0) {
      throw new TypeError(`Malformed PVC dataset name on ${node}: ${row.name}`);
    }
    if (datasets.has(row.name)) {
      throw new TypeError(`Duplicate PVC dataset row on ${node}: ${row.name}`);
    }
    datasets.set(row.name, {
      node,
      pool: row.name.slice(0, slash),
      dataset: row.name,
      orphanCount: 0,
      orphanBytes: 0,
      liveCount: 0,
    });
  }

  for (const snapshot of snapshots) {
    const dataset = datasets.get(snapshot.dataset);
    if (dataset === undefined) {
      throw new Error(
        `Snapshot ${snapshot.dataset}@${snapshot.snapshot} on ${node} has no dataset row`,
      );
    }
    if (liveSet.has(snapshot.snapshot)) {
      dataset.liveCount += 1;
    } else {
      dataset.orphanCount += 1;
      dataset.orphanBytes += snapshot.used;
    }
  }

  return [...datasets.values()].toSorted((left, right) =>
    left.dataset.localeCompare(right.dataset),
  );
}

async function execInPod(podName: string, command: string): Promise<string> {
  const args = [
    "kubectl",
    "exec",
    "-n",
    NAMESPACE_OPENEBS,
    "-c",
    ZFS_NODE_CONTAINER,
    podName,
    "--",
    "sh",
    "-c",
    command,
  ];
  const proc = Bun.spawn(args, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    const detail = stderr.trim() || stdout.trim() || "(no output)";
    throw new Error(
      `kubectl exec [${command}] in ${NAMESPACE_OPENEBS}/${podName} exited ${String(exitCode)}: ${detail}`,
    );
  }
  return stdout;
}
