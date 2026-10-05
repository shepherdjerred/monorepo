/**
 * Read-only view of live minecraft-tsmc from the cluster: the StatefulSet,
 * its pod, and the mining-reset lock. The harness never scales, patches or
 * annotates anything; an asleep or locked server is a refusal, not a wake.
 */
import { z } from "zod";
import {
  MC_HARNESS_SERVICE_ACCOUNT,
  type Kubectl,
} from "#providers/kubernetes/kubectl.ts";

export const LIVE_NAMESPACE = "minecraft-tsmc";
export const LIVE_STATEFULSET = "minecraft-tsmc";
export const LIVE_POD = "minecraft-tsmc-0";
/** The itzg chart names the server container after the release fullname. */
export const LIVE_CONTAINER = "minecraft-tsmc";
export const LIVE_BRIDGE_PORT = 25_580;
/** Set by the Temporal mining-reset workflow while it owns the server. */
export const MINING_RESET_LOCK_ANNOTATION = "sjer.red/mining-reset-lock";
export const VELERO_NAMESPACE = "velero";

/** kubectl target for live reads: tsmc's namespace as the scoped ServiceAccount. */
export function liveKubeTarget(context: string, namespace = LIVE_NAMESPACE) {
  return { context, namespace, as: MC_HARNESS_SERVICE_ACCOUNT };
}

const MetadataSchema = z.object({
  name: z.string(),
  annotations: z.record(z.string(), z.string()).optional(),
});

export const StatefulSetSchema = z.object({
  metadata: MetadataSchema,
  spec: z.object({
    replicas: z.number().int().optional(),
    template: z.object({
      spec: z.object({ containers: z.array(z.object({ image: z.string() })) }),
    }),
  }),
  status: z.object({ readyReplicas: z.number().int().optional() }).optional(),
});

export const PodSchema = z.object({
  metadata: MetadataSchema,
  status: z
    .object({
      phase: z.string().optional(),
      conditions: z
        .array(z.object({ type: z.string(), status: z.string() }))
        .optional(),
    })
    .optional(),
});

export type LiveClusterStatus = {
  replicas: number;
  readyReplicas: number;
  podPhase: string | null;
  podReady: boolean;
  image: string | null;
  miningResetLock: string | null;
};

export function parseLiveStatus(
  statefulSet: unknown,
  pod: unknown,
): LiveClusterStatus {
  const sts = StatefulSetSchema.parse(statefulSet);
  const parsedPod = pod === null ? null : PodSchema.parse(pod);
  const ready =
    parsedPod?.status?.conditions?.some(
      (condition) => condition.type === "Ready" && condition.status === "True",
    ) ?? false;
  return {
    replicas: sts.spec.replicas ?? 0,
    readyReplicas: sts.status?.readyReplicas ?? 0,
    podPhase: parsedPod?.status?.phase ?? null,
    podReady: ready,
    image: sts.spec.template.spec.containers[0]?.image ?? null,
    miningResetLock:
      sts.metadata.annotations?.[MINING_RESET_LOCK_ANNOTATION] ?? null,
  };
}

/**
 * Why live calls are refused right now, or null. Waking a sleeping server is
 * deliberately out of scope: ask the user to join it (mc-router wakes it).
 */
export function liveRefusal(status: LiveClusterStatus): string | null {
  if (status.miningResetLock !== null) {
    return `the mining reset holds minecraft-tsmc (lock ${status.miningResetLock}); wait for it to finish — see the "Recover The Storm mining reset" how-to`;
  }
  if (status.replicas === 0) {
    return "minecraft-tsmc is asleep (scaled to 0). Ask the user to join ts-mc.net so mc-router wakes it; the harness never scales the server";
  }
  return !status.podReady || status.readyReplicas === 0
    ? `minecraft-tsmc is not ready (pod ${status.podPhase ?? "missing"}); wait for it to finish starting`
    : null;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && /NotFound|not found/u.test(error.message);
}

/** Reads the StatefulSet and pod; a missing pod (asleep) is not an error. */
export async function readLiveStatus(
  kubectl: Kubectl,
): Promise<LiveClusterStatus> {
  const sts = await kubectl.run([
    "get",
    "statefulset",
    LIVE_STATEFULSET,
    "-o",
    "json",
  ]);
  let pod: unknown = null;
  try {
    const result = await kubectl.run(["get", "pod", LIVE_POD, "-o", "json"]);
    pod = JSON.parse(result.stdout);
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
  return parseLiveStatus(JSON.parse(sts.stdout), pod);
}
