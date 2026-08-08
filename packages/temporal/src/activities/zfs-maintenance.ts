import { Context } from "@temporalio/activity";
import * as k8s from "@kubernetes/client-node";
import { selectRunningReadyNodePods } from "#shared/kubernetes-node-pods.ts";
import { kubectlExecInPod } from "#shared/kubectl-exec.ts";

const NAMESPACE = "prometheus";
const ZFS_COLLECTOR_LABEL = "app=zfs-zpool-collector";
const ZFS_COLLECTOR_CONTAINER = "zfs-zpool-collector";
const MANAGED_POOL_PREFIX = "zfspv-pool-";

export type ZfsCollectorPod = {
  node: string;
  pod: string;
};

export type ZfsCollectorPodCandidate = {
  metadata?: { name?: string };
  spec?: { nodeName?: string };
  status?: {
    phase?: string;
    conditions?: { type?: string; status?: string }[];
  };
};

type ZfsMaintenancePhase = "discover" | "autotrim" | "scrub";

type ZfsMaintenanceHeartbeat = (details: {
  phase: ZfsMaintenancePhase;
  node: string;
  pod: string;
  pool?: string;
}) => void;

export type ZfsMaintenanceDependencies = {
  listClusterNodes: () => Promise<readonly string[]>;
  listCollectorPods: () => Promise<readonly ZfsCollectorPodCandidate[]>;
  execInPod: (pod: ZfsCollectorPod, command: string) => Promise<string>;
  heartbeat: ZfsMaintenanceHeartbeat;
};

export type ZfsMaintenanceActivities = typeof zfsMaintenanceActivities;

export const zfsMaintenanceActivities = {
  async runZfsMaintenance(): Promise<string> {
    return runZfsMaintenanceWithDependencies({
      listClusterNodes: findKubernetesNodes,
      listCollectorPods: findZfsCollectorPods,
      execInPod: (pod, command) =>
        kubectlExecInPod({
          namespace: NAMESPACE,
          container: ZFS_COLLECTOR_CONTAINER,
          pod: pod.pod,
          command,
        }),
      heartbeat: (details) => {
        Context.current().heartbeat(details);
      },
    });
  },
};

export async function runZfsMaintenanceWithDependencies(
  dependencies: ZfsMaintenanceDependencies,
): Promise<string> {
  const nodes = await dependencies.listClusterNodes();
  const candidates = await dependencies.listCollectorPods();
  const nodePods = selectZfsCollectorPods(candidates, nodes);
  const results: string[] = [];

  for (const nodePod of nodePods) {
    dependencies.heartbeat({
      phase: "discover",
      node: nodePod.node,
      pod: nodePod.pod,
    });
    const inventory = await runCommand(
      dependencies,
      nodePod,
      "zpool list -H -o name",
    );
    const pools = parseManagedZfsPools(inventory, nodePod);

    for (const pool of pools) {
      dependencies.heartbeat({
        phase: "autotrim",
        node: nodePod.node,
        pod: nodePod.pod,
        pool,
      });
      const autotrimOutput = await runCommand(
        dependencies,
        nodePod,
        `zpool set autotrim=on ${pool}`,
        pool,
      );

      dependencies.heartbeat({
        phase: "scrub",
        node: nodePod.node,
        pod: nodePod.pod,
        pool,
      });
      const status = await runCommand(
        dependencies,
        nodePod,
        `zpool status ${pool}`,
        pool,
      );
      let scrubOutput: string;
      if (status.includes("scrub in progress")) {
        scrubOutput = "already in progress, skipped";
      } else {
        const scrubCommandOutput = await runCommand(
          dependencies,
          nodePod,
          `zpool scrub ${pool}`,
          pool,
        );
        scrubOutput = `initiated (${scrubCommandOutput.trim() || "ok"})`;
      }
      results.push(
        `${nodePod.node}/${pool}: autotrim ${autotrimOutput.trim() || "ok"}; scrub ${scrubOutput}`,
      );
    }
  }

  return results.join("\n");
}

export function selectZfsCollectorPods(
  pods: readonly ZfsCollectorPodCandidate[],
  expectedNodes?: readonly string[],
): ZfsCollectorPod[] {
  const context = {
    namespace: NAMESPACE,
    labelSelector: ZFS_COLLECTOR_LABEL,
    resourceDescription: "zfs-zpool-collector",
    requireExactlyOneReadyPodPerNode: true,
  };
  if (expectedNodes !== undefined) {
    return selectRunningReadyNodePods(pods, { ...context, expectedNodes });
  }
  return selectRunningReadyNodePods(pods, context);
}

export function parseManagedZfsPools(
  inventory: string,
  nodePod: ZfsCollectorPod,
): string[] {
  const pools = inventory
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const managedPools = pools.filter((pool) =>
    pool.startsWith(MANAGED_POOL_PREFIX),
  );
  for (const pool of managedPools) {
    if (!/^\w[\w.-]*$/.test(pool)) {
      throw new Error(
        `Invalid ZFS pool name from ${nodePod.node}/${nodePod.pod}: ${pool}`,
      );
    }
  }

  if (managedPools.length === 0) {
    throw new Error(
      `No managed ZFS pools (${MANAGED_POOL_PREFIX}*) found on ${nodePod.node}/${nodePod.pod}`,
    );
  }
  return managedPools.toSorted();
}

async function findZfsCollectorPods(): Promise<ZfsCollectorPodCandidate[]> {
  const kc = new k8s.KubeConfig();
  kc.loadFromCluster();
  const response = await kc.makeApiClient(k8s.CoreV1Api).listNamespacedPod({
    namespace: NAMESPACE,
    labelSelector: ZFS_COLLECTOR_LABEL,
  });
  return response.items.map((pod) => {
    const candidate: ZfsCollectorPodCandidate = {};
    if (pod.metadata?.name !== undefined) {
      candidate.metadata = { name: pod.metadata.name };
    }
    if (pod.spec?.nodeName !== undefined) {
      candidate.spec = { nodeName: pod.spec.nodeName };
    }
    if (pod.status !== undefined) {
      candidate.status = {};
      if (pod.status.phase !== undefined) {
        candidate.status.phase = pod.status.phase;
      }
      if (pod.status.conditions !== undefined) {
        candidate.status.conditions = pod.status.conditions.map(
          ({ type, status }) => ({
            type,
            status,
          }),
        );
      }
    }
    return candidate;
  });
}

async function findKubernetesNodes(): Promise<string[]> {
  const kc = new k8s.KubeConfig();
  kc.loadFromCluster();
  const response = await kc.makeApiClient(k8s.CoreV1Api).listNode();
  const nodes: string[] = [];
  for (const node of response.items) {
    const name = node.metadata?.name;
    if (name === undefined) {
      throw new Error(
        "Kubernetes node inventory contains a node without metadata.name",
      );
    }
    nodes.push(name);
  }
  return nodes.toSorted();
}

async function runCommand(
  dependencies: ZfsMaintenanceDependencies,
  nodePod: ZfsCollectorPod,
  command: string,
  pool?: string,
): Promise<string> {
  try {
    return await dependencies.execInPod(nodePod, command);
  } catch (error) {
    const context = [
      `node=${nodePod.node}`,
      `pod=${nodePod.pod}`,
      `pool=${pool ?? "unknown"}`,
      `command=${command}`,
    ].join(", ");
    throw new Error(`ZFS maintenance command failed: ${context}`, {
      cause: error,
    });
  }
}
