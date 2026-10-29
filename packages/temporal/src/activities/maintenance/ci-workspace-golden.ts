import * as k8s from "@kubernetes/client-node";
import { Context } from "@temporalio/activity";
import { z } from "zod";
import { log } from "#observability/log.ts";
import type { MaintenanceRequest } from "#shared/ci-maintenance.ts";
import { CI_NAMESPACE } from "./ci-workspace-reaper.ts";

/**
 * Must match CI_WORKSPACE_GOLDEN_CONFIG_MAP and
 * CI_WORKSPACE_GOLDEN_SNAPSHOT_PREFIX in the homelab workspace clone policy.
 * The policy gives each new workspace claim the snapshot this map names.
 */
export const CI_WORKSPACE_GOLDEN_CONFIG_MAP = "ci-workspace-golden";
export const CI_WORKSPACE_GOLDEN_SNAPSHOT_PREFIX = "ci-workspace-golden-";
/** Must match WOODPECKER_WORKSPACE_GOLDEN_CLAIM in the homelab CI caches. */
export const CI_WORKSPACE_GOLDEN_CLAIM = "woodpecker-workspace-golden";
const SNAPSHOT_CLASS = "host-zfs-snapshot";
const GOLDEN_LABEL = "ci.sjer.red/workspace-golden";
const SOURCE_ANNOTATION = "ci.sjer.red/source";
const SNAPSHOT_GROUP = "snapshot.storage.k8s.io";
const SNAPSHOT_VERSION = "v1";
const SNAPSHOT_PLURAL = "volumesnapshots";
/**
 * The selected snapshot and its predecessor are kept. Older ones are deleted;
 * ZFS holds each until the workspaces cloned from it are gone.
 */
const RETAINED_SNAPSHOTS = 2;
const READY_POLL_MS = 5000;

export type GoldenSnapshot = {
  name: string;
  createdAt: Date;
  ready: boolean;
  error: string | undefined;
  deleting: boolean;
};

export type CiWorkspaceGoldenClient = {
  /** Creates the snapshot; one that already exists is left as it is. */
  createSnapshot: (name: string, source: string) => Promise<void>;
  getSnapshot: (name: string) => Promise<GoldenSnapshot | null>;
  listSnapshots: () => Promise<GoldenSnapshot[]>;
  /** Deletes the snapshot; one already gone is not an error. */
  deleteSnapshot: (name: string) => Promise<void>;
  /** Names the snapshot new workspaces clone. */
  selectSnapshot: (name: string, source: string) => Promise<void>;
};

/** Stable per request, so a retried activity resumes the same snapshot. */
export function goldenSnapshotName(request: MaintenanceRequest): string {
  return `${CI_WORKSPACE_GOLDEN_SNAPSHOT_PREFIX}${request.source.slice(0, 12)}-${request.requestId.slice(0, 8)}`;
}

/** Golden snapshots to delete: all but the selected and its newest predecessor. */
export function planGoldenPrune(
  snapshots: readonly GoldenSnapshot[],
  selected: string,
): string[] {
  const live = snapshots
    .filter(
      (snapshot) =>
        !snapshot.deleting &&
        snapshot.name.startsWith(CI_WORKSPACE_GOLDEN_SNAPSHOT_PREFIX),
    )
    .toSorted(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        a.name.localeCompare(b.name),
    );
  const kept = new Set([
    selected,
    ...live
      .filter((snapshot) => snapshot.name !== selected)
      .slice(0, RETAINED_SNAPSHOTS - 1)
      .map((snapshot) => snapshot.name),
  ]);
  return live
    .filter((snapshot) => !kept.has(snapshot.name))
    .map((snapshot) => snapshot.name);
}

/**
 * Snapshots the golden claim the maintenance publisher just refreshed, waits
 * for the driver to report it ready, selects it, and deletes superseded
 * snapshots. Selecting only a ready snapshot keeps new workspace claims from
 * waiting on one.
 */
export async function publishGoldenSnapshot(
  client: CiWorkspaceGoldenClient,
  request: MaintenanceRequest,
  wait: (ms: number) => Promise<void>,
  heartbeat: (progress: Record<string, unknown>) => void = () => {
    // No-op outside an Activity.
  },
): Promise<{ snapshot: string; deleted: string[] }> {
  const name = goldenSnapshotName(request);
  await client.createSnapshot(name, request.source);
  for (;;) {
    const snapshot = await client.getSnapshot(name);
    if (snapshot === null)
      throw new Error(`Golden workspace snapshot ${name} disappeared`);
    if (snapshot.error !== undefined)
      throw new Error(
        `Golden workspace snapshot ${name} failed: ${snapshot.error}`,
      );
    if (snapshot.ready) break;
    heartbeat({ snapshot: name, ready: false });
    await wait(READY_POLL_MS);
  }
  await client.selectSnapshot(name, request.source);
  const deleted = planGoldenPrune(await client.listSnapshots(), name);
  for (const stale of deleted) {
    await client.deleteSnapshot(stale);
    heartbeat({ deleted: stale });
  }
  return { snapshot: name, deleted };
}

const SnapshotSchema = z.object({
  metadata: z.object({
    name: z.string(),
    creationTimestamp: z.string(),
    deletionTimestamp: z.string().optional(),
  }),
  status: z
    .object({
      readyToUse: z.boolean().optional(),
      error: z.object({ message: z.string().optional() }).optional(),
    })
    .optional(),
});

function toSnapshot(value: unknown): GoldenSnapshot {
  const parsed = SnapshotSchema.parse(value);
  return {
    name: parsed.metadata.name,
    createdAt: new Date(parsed.metadata.creationTimestamp),
    ready: parsed.status?.readyToUse === true,
    error:
      parsed.status?.error === undefined
        ? undefined
        : (parsed.status.error.message ?? "unknown error"),
    deleting: parsed.metadata.deletionTimestamp !== undefined,
  };
}

function apiCode(error: unknown): number | undefined {
  return error instanceof k8s.ApiException ? error.code : undefined;
}

export function kubernetesCiWorkspaceGoldenClient(
  objects: k8s.CustomObjectsApi,
  core: k8s.CoreV1Api,
): CiWorkspaceGoldenClient {
  const location = {
    group: SNAPSHOT_GROUP,
    version: SNAPSHOT_VERSION,
    namespace: CI_NAMESPACE,
    plural: SNAPSHOT_PLURAL,
  };
  return {
    async createSnapshot(name, source) {
      try {
        await objects.createNamespacedCustomObject({
          ...location,
          body: {
            apiVersion: `${SNAPSHOT_GROUP}/${SNAPSHOT_VERSION}`,
            kind: "VolumeSnapshot",
            metadata: {
              name,
              namespace: CI_NAMESPACE,
              labels: { [GOLDEN_LABEL]: "true" },
              annotations: { [SOURCE_ANNOTATION]: source },
            },
            spec: {
              volumeSnapshotClassName: SNAPSHOT_CLASS,
              source: { persistentVolumeClaimName: CI_WORKSPACE_GOLDEN_CLAIM },
            },
          },
        });
      } catch (error: unknown) {
        if (apiCode(error) !== 409) throw error;
      }
    },
    async getSnapshot(name) {
      try {
        return toSnapshot(
          await objects.getNamespacedCustomObject({ ...location, name }),
        );
      } catch (error: unknown) {
        if (apiCode(error) === 404) return null;
        throw error;
      }
    },
    async listSnapshots() {
      const response = z.object({ items: z.array(z.unknown()) }).parse(
        await objects.listNamespacedCustomObject({
          ...location,
          labelSelector: `${GOLDEN_LABEL}=true`,
        }),
      );
      return response.items.map((item) => toSnapshot(item));
    },
    async deleteSnapshot(name) {
      try {
        await objects.deleteNamespacedCustomObject({ ...location, name });
      } catch (error: unknown) {
        if (apiCode(error) !== 404) throw error;
      }
    },
    async selectSnapshot(name, source) {
      const metadata = {
        name: CI_WORKSPACE_GOLDEN_CONFIG_MAP,
        namespace: CI_NAMESPACE,
        annotations: { [SOURCE_ANNOTATION]: source },
      };
      let current: k8s.V1ConfigMap | undefined;
      try {
        current = await core.readNamespacedConfigMap({
          name: CI_WORKSPACE_GOLDEN_CONFIG_MAP,
          namespace: CI_NAMESPACE,
        });
      } catch (error: unknown) {
        if (apiCode(error) !== 404) throw error;
      }
      if (current === undefined) {
        await core.createNamespacedConfigMap({
          namespace: CI_NAMESPACE,
          body: { metadata, data: { snapshot: name } },
        });
        return;
      }
      // The read's resourceVersion makes a concurrent writer fail, not lose.
      const resourceVersion = current.metadata?.resourceVersion;
      if (resourceVersion === undefined)
        throw new Error("Golden workspace ConfigMap has no resourceVersion");
      await core.replaceNamespacedConfigMap({
        name: CI_WORKSPACE_GOLDEN_CONFIG_MAP,
        namespace: CI_NAMESPACE,
        body: {
          metadata: {
            ...metadata,
            resourceVersion,
          },
          data: { snapshot: name },
        },
      });
    },
  };
}

export type CiWorkspaceGoldenActivities = typeof ciWorkspaceGoldenActivities;

export const ciWorkspaceGoldenActivities = {
  async publishCiWorkspaceGoldenSnapshot(
    request: MaintenanceRequest,
  ): Promise<{ snapshot: string; deleted: string[] }> {
    const kc = new k8s.KubeConfig();
    kc.loadFromCluster();
    const context = Context.current();
    const result = await publishGoldenSnapshot(
      kubernetesCiWorkspaceGoldenClient(
        kc.makeApiClient(k8s.CustomObjectsApi),
        kc.makeApiClient(k8s.CoreV1Api),
      ),
      request,
      (ms) => context.sleep(ms),
      (progress) => {
        context.heartbeat(progress);
      },
    );
    log("info", "CI workspace golden snapshot selected", result);
    return result;
  },
};
