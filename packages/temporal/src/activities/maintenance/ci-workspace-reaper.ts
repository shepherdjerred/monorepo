import * as k8s from "@kubernetes/client-node";
import { Context } from "@temporalio/activity";
import { log } from "#observability/log.ts";
import {
  ciWorkspaceReaperDeletionsTotal,
  maintenanceLastSuccessTimestampSeconds,
  maintenanceRunsTotal,
} from "#observability/metrics.ts";

/**
 * Reaps CI state Woodpecker failed to clean up on the CI node.
 *
 * Woodpecker deletes a workflow's step pods and its `ci-workspace` claim when
 * the workflow ends, but its teardown stops at the first error, before the
 * claim. Each leak holds a ZFS volume on the CI pool and, for a terminal pod,
 * a container writable layer on the node's OS disk until someone deletes it.
 *
 * `maintenance_job` metric label, matched by the stale alert in
 * packages/homelab/.../monitoring/rules/woodpecker.ts
 * (CI_WORKSPACE_REAP_ACTIVITY there).
 */
export const CI_WORKSPACE_REAP_ACTIVITY = "ci-workspace-reap";

/** Must match WOODPECKER_CI_NAMESPACE in the homelab Woodpecker resources. */
export const CI_NAMESPACE = "woodpecker-ci";

/** Must match CI_WORKSPACE_STORAGE_CLASS in homelab storage-classes.ts. */
export const CI_WORKSPACE_STORAGE_CLASS = "ci-workspace";

/**
 * Must match CI_WORKSPACE_LEAK_AGE_SECONDS in the homelab Woodpecker alert
 * rules. No workflow outlives its 270-minute timeout, so anything older than
 * six hours is past every workflow that could still own it.
 */
export const CI_WORKSPACE_LEAK_AGE_SECONDS = 6 * 60 * 60;

/**
 * Upper bound on deletions of each kind per run. A normal run finds a handful;
 * a burst beyond this is drained oldest-first over the following runs rather
 * than in one unbounded sweep.
 */
export const CI_WORKSPACE_REAP_LIMIT = 50;

/**
 * Label Woodpecker's Kubernetes backend stamps on every clone, service, and
 * step pod it creates (WOODPECKER_TASK_LABEL in the homelab CI pod guard).
 */
const WOODPECKER_TASK_LABEL = "woodpecker-ci.org/task-uuid";
const WOODPECKER_RESOURCE_PREFIX = "wp-";
const TERMINAL_POD_PHASES: ReadonlySet<string> = new Set([
  "Failed",
  "Succeeded",
  "Unknown",
]);

export type ReaperPod = {
  name: string;
  uid: string;
  phase: string | undefined;
  createdAt: Date;
  deleting: boolean;
  labels: Readonly<Record<string, string>>;
  claimNames: readonly string[];
};

export type ReaperClaim = {
  name: string;
  uid: string;
  storageClassName: string | undefined;
  createdAt: Date;
  deleting: boolean;
};

export type CiWorkspaceReapPlan = {
  pods: ReaperPod[];
  claims: ReaperClaim[];
  /** Eligible pods left for a later run by the per-run limit. */
  deferredPods: number;
  /** Eligible claims left for a later run by the per-run limit. */
  deferredClaims: number;
  /** Old workspace claims kept because a pod this run keeps still mounts them. */
  mountedClaims: string[];
};

function olderThanLeakAge(createdAt: Date, now: Date): boolean {
  return (
    now.getTime() - createdAt.getTime() > CI_WORKSPACE_LEAK_AGE_SECONDS * 1000
  );
}

function oldestFirst<T extends { createdAt: Date; name: string }>(
  items: readonly T[],
): T[] {
  return items.toSorted(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Pure selection: which pods and claims are leaked, given one listing.
 *
 * Pods qualify when Woodpecker created them, they reached a terminal phase,
 * and they are older than the leak age. Claims qualify when they are
 * Woodpecker workspace claims of the `ci-workspace` class, older than the leak
 * age, and no pod outside this run's pod deletions still mounts them -- a
 * running pod, a pod already terminating, or a terminal pod deferred by the
 * limit all keep their claim for a later run.
 */
export function planCiWorkspaceReap(
  pods: readonly ReaperPod[],
  claims: readonly ReaperClaim[],
  now: Date,
  limit = CI_WORKSPACE_REAP_LIMIT,
): CiWorkspaceReapPlan {
  const eligiblePods = oldestFirst(
    pods.filter(
      (pod) =>
        !pod.deleting &&
        pod.name.startsWith(WOODPECKER_RESOURCE_PREFIX) &&
        WOODPECKER_TASK_LABEL in pod.labels &&
        pod.phase !== undefined &&
        TERMINAL_POD_PHASES.has(pod.phase) &&
        olderThanLeakAge(pod.createdAt, now),
    ),
  );
  const selectedPods = eligiblePods.slice(0, limit);
  const selectedPodNames = new Set(selectedPods.map((pod) => pod.name));
  const mountedByKeptPods = new Set(
    pods
      .filter((pod) => !selectedPodNames.has(pod.name))
      .flatMap((pod) => pod.claimNames),
  );

  const oldWorkspaceClaims = claims.filter(
    (claim) =>
      !claim.deleting &&
      claim.storageClassName === CI_WORKSPACE_STORAGE_CLASS &&
      claim.name.startsWith(WOODPECKER_RESOURCE_PREFIX) &&
      olderThanLeakAge(claim.createdAt, now),
  );
  const mountedClaims = oldWorkspaceClaims
    .filter((claim) => mountedByKeptPods.has(claim.name))
    .map((claim) => claim.name)
    .toSorted();
  const eligibleClaims = oldestFirst(
    oldWorkspaceClaims.filter((claim) => !mountedByKeptPods.has(claim.name)),
  );

  return {
    pods: selectedPods,
    claims: eligibleClaims.slice(0, limit),
    deferredPods: eligiblePods.length - selectedPods.length,
    deferredClaims: Math.max(0, eligibleClaims.length - limit),
    mountedClaims,
  };
}

/** Outcome of one delete. `gone` and `changed` are not failures. */
export type ReaperDeleteOutcome = "deleted" | "gone" | "changed";

export type CiWorkspaceReaperClient = {
  listPods: () => Promise<ReaperPod[]>;
  listClaims: () => Promise<ReaperClaim[]>;
  deletePod: (name: string, uid: string) => Promise<ReaperDeleteOutcome>;
  deleteClaim: (name: string, uid: string) => Promise<ReaperDeleteOutcome>;
};

export type CiWorkspaceReapResult = {
  deletedPods: string[];
  deletedClaims: string[];
  /** Already gone, or replaced by an object with a different UID. */
  skipped: string[];
  deferredPods: number;
  deferredClaims: number;
  mountedClaims: string[];
};

/**
 * Deletes the planned pods, then the planned claims.
 *
 * Pods go first because a claim's protection finalizer holds it until no pod
 * uses it. Every delete carries the listed UID as a precondition, so a run
 * never deletes an object that replaced the one it inspected, and a repeat of
 * an interrupted run is harmless: an object already gone is skipped.
 *
 * The claim plan assumed the selected pods would go away. Pods are listed
 * again after their deletes, and a planned claim still mounted by any pod this
 * run did not delete -- a pod that replaced one under the same name, or one
 * created since the first listing -- is kept for a later run.
 */
export async function reapCiWorkspaces(
  client: CiWorkspaceReaperClient,
  now: Date,
  heartbeat: (progress: Record<string, unknown>) => void = () => {
    // No-op outside an Activity.
  },
): Promise<CiWorkspaceReapResult> {
  const [pods, claims] = await Promise.all([
    client.listPods(),
    client.listClaims(),
  ]);
  const plan = planCiWorkspaceReap(pods, claims, now);
  const result: CiWorkspaceReapResult = {
    deletedPods: [],
    deletedClaims: [],
    skipped: [],
    deferredPods: plan.deferredPods,
    deferredClaims: plan.deferredClaims,
    mountedClaims: [...plan.mountedClaims],
  };

  const deletedPodUids = new Set<string>();
  for (const pod of plan.pods) {
    const outcome = await client.deletePod(pod.name, pod.uid);
    if (outcome === "deleted") {
      deletedPodUids.add(pod.uid);
      result.deletedPods.push(pod.name);
      ciWorkspaceReaperDeletionsTotal.inc({ resource: "pod" });
    } else {
      result.skipped.push(`pod/${pod.name} (${outcome})`);
    }
    heartbeat({ resource: "pod", name: pod.name, outcome });
  }

  const podsAfterDeletes = await client.listPods();
  const stillMounted = new Set(
    podsAfterDeletes
      .filter((pod) => !deletedPodUids.has(pod.uid))
      .flatMap((pod) => pod.claimNames),
  );
  for (const claim of plan.claims) {
    if (stillMounted.has(claim.name)) {
      result.mountedClaims.push(claim.name);
      continue;
    }
    const outcome = await client.deleteClaim(claim.name, claim.uid);
    if (outcome === "deleted") {
      result.deletedClaims.push(claim.name);
      ciWorkspaceReaperDeletionsTotal.inc({ resource: "claim" });
    } else {
      result.skipped.push(`persistentvolumeclaim/${claim.name} (${outcome})`);
    }
    heartbeat({ resource: "claim", name: claim.name, outcome });
  }
  return result;
}

function requiredMetadata(
  kind: string,
  metadata: k8s.V1ObjectMeta | undefined,
): { name: string; uid: string; createdAt: Date } {
  const name = metadata?.name;
  const uid = metadata?.uid;
  const createdAt = metadata?.creationTimestamp;
  if (name === undefined || uid === undefined || createdAt === undefined) {
    throw new Error(
      `${kind} in ${CI_NAMESPACE} is missing name, uid, or creationTimestamp`,
    );
  }
  return { name, uid, createdAt: new Date(createdAt) };
}

function deleteOutcome(error: unknown): ReaperDeleteOutcome {
  if (error instanceof k8s.ApiException) {
    if (error.code === 404) return "gone";
    // A failed UID precondition: the name now belongs to a newer object.
    if (error.code === 409) return "changed";
  }
  throw error;
}

export function kubernetesCiWorkspaceReaperClient(
  api: k8s.CoreV1Api,
): CiWorkspaceReaperClient {
  return {
    async listPods() {
      const response = await api.listNamespacedPod({ namespace: CI_NAMESPACE });
      return response.items.map((pod) => ({
        ...requiredMetadata("Pod", pod.metadata),
        phase: pod.status?.phase,
        deleting: pod.metadata?.deletionTimestamp !== undefined,
        labels: pod.metadata?.labels ?? {},
        claimNames: (pod.spec?.volumes ?? []).flatMap((volume) =>
          volume.persistentVolumeClaim === undefined
            ? []
            : [volume.persistentVolumeClaim.claimName],
        ),
      }));
    },
    async listClaims() {
      const response = await api.listNamespacedPersistentVolumeClaim({
        namespace: CI_NAMESPACE,
      });
      return response.items.map((claim) => ({
        ...requiredMetadata("PersistentVolumeClaim", claim.metadata),
        storageClassName: claim.spec?.storageClassName,
        deleting: claim.metadata?.deletionTimestamp !== undefined,
      }));
    },
    async deletePod(name, uid) {
      try {
        await api.deleteNamespacedPod({
          name,
          namespace: CI_NAMESPACE,
          body: { preconditions: { uid } },
        });
        return "deleted";
      } catch (error: unknown) {
        return deleteOutcome(error);
      }
    },
    async deleteClaim(name, uid) {
      try {
        await api.deleteNamespacedPersistentVolumeClaim({
          name,
          namespace: CI_NAMESPACE,
          body: { preconditions: { uid } },
        });
        return "deleted";
      } catch (error: unknown) {
        return deleteOutcome(error);
      }
    },
  };
}

export type CiWorkspaceReaperActivities = typeof ciWorkspaceReaperActivities;

export const ciWorkspaceReaperActivities = {
  async reapLeakedCiWorkspaces(): Promise<CiWorkspaceReapResult> {
    const kc = new k8s.KubeConfig();
    kc.loadFromCluster();
    const context = Context.current();
    try {
      const result = await reapCiWorkspaces(
        kubernetesCiWorkspaceReaperClient(kc.makeApiClient(k8s.CoreV1Api)),
        new Date(),
        (progress) => {
          context.heartbeat(progress);
        },
      );
      maintenanceLastSuccessTimestampSeconds.set(
        { maintenance_job: CI_WORKSPACE_REAP_ACTIVITY },
        Date.now() / 1000,
      );
      maintenanceRunsTotal.inc({
        maintenance_job: CI_WORKSPACE_REAP_ACTIVITY,
        outcome: "success",
      });
      log("info", "CI workspace reap completed", result);
      return result;
    } catch (error: unknown) {
      maintenanceRunsTotal.inc({
        maintenance_job: CI_WORKSPACE_REAP_ACTIVITY,
        outcome: "failure",
      });
      throw error;
    }
  },
};
