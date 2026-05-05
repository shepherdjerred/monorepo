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
const POOLS = ["zfspv-pool-nvme", "zfspv-pool-hdd"] as const;

export type VeleroOrphanDataset = {
  pool: string;
  dataset: string;
  orphanCount: number;
  orphanBytes: number;
  liveCount: number;
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

      Context.current().heartbeat({ phase: "find-zfs-node-pod" });
      const nodePod = await findZfsNodePod();

      Context.current().heartbeat({ phase: "list-zfs-orphans" });
      const datasets = await listZfsOrphanSnapshots(nodePod, liveBackups);

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
          { pool: d.pool, dataset: d.dataset },
          d.orphanCount,
        );
        veleroOrphanLocalBytes.set(
          { pool: d.pool, dataset: d.dataset },
          d.orphanBytes,
        );
        zfsDatasetSnapshotCount.set(
          { pool: d.pool, dataset: d.dataset },
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

async function findZfsNodePod(): Promise<string> {
  const pods = await loadCoreApi().listNamespacedPod({
    namespace: NAMESPACE_OPENEBS,
    labelSelector: ZFS_NODE_LABEL,
  });
  const pod = pods.items.find((p) => p.status?.phase === "Running");
  const name = pod?.metadata?.name;
  if (name === undefined) {
    throw new Error(
      `No Running openebs-zfs-localpv-node pod found in ${NAMESPACE_OPENEBS} (label selector: ${ZFS_NODE_LABEL})`,
    );
  }
  return name;
}

// Calls `zfs list` on each pool's datasets and snapshots, then computes per-dataset
// orphan counts and bytes by diffing snapshot names against the live Velero Backup set.
async function listZfsOrphanSnapshots(
  nodePod: string,
  liveBackups: readonly string[],
): Promise<VeleroOrphanDataset[]> {
  // The `zfs` command isn't on PATH in this container — invoke via absolute paths.
  // /usr/local/sbin and /usr/sbin are the typical install paths in the openebs image.
  // Filtering happens in TypeScript so we don't need shell pipelines that can
  // mask non-zero exit codes; execInPod surfaces real errors verbatim.
  const liveSet = new Set(liveBackups);
  const datasets: VeleroOrphanDataset[] = [];

  for (const pool of POOLS) {
    Context.current().heartbeat({ phase: "list-pool", pool });

    // Lists ALL items under the pool — we filter in TS to find PVC datasets
    // (skip snapshot lines containing '@', skip the pool itself).
    const allItems = await execInPod(
      nodePod,
      `PATH=$PATH:/usr/local/sbin:/usr/sbin:/sbin zfs list -H -o name -r '${pool}'`,
    );
    const datasetNames = allItems
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((name) => !name.includes("@"))
      .filter((name) => name.includes("/pvc-"));

    for (const dataset of datasetNames) {
      Context.current().heartbeat({ phase: "list-snapshots", pool, dataset });

      // -p emits machine-parseable bytes; -t snapshot lists snapshots only.
      // A dataset with zero snapshots returns empty stdout + exit 0, so no
      // suppression is needed.
      const snapshotList = await execInPod(
        nodePod,
        `PATH=$PATH:/usr/local/sbin:/usr/sbin:/sbin zfs list -t snapshot -H -p -o name,used '${dataset}'`,
      );

      let orphanCount = 0;
      let orphanBytes = 0;
      let liveCount = 0;

      for (const line of snapshotList.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          continue;
        }
        const [fullName, usedStr] = trimmed.split("\t");
        if (fullName === undefined) {
          continue;
        }
        const atIdx = fullName.indexOf("@");
        if (atIdx === -1) {
          continue;
        }
        const snapName = fullName.slice(atIdx + 1);
        const used = Number.parseInt(usedStr ?? "0", 10);
        if (Number.isNaN(used)) {
          continue;
        }

        if (liveSet.has(snapName)) {
          liveCount += 1;
        } else {
          orphanCount += 1;
          orphanBytes += used;
        }
      }

      datasets.push({ pool, dataset, orphanCount, orphanBytes, liveCount });
    }
  }

  return datasets;
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
