import { ApplicationFailure, Context } from "@temporalio/activity";
import type {
  DeploymentDetail,
  EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import { stepStageKey } from "@shepherdjerred/delivery/model-contract";
import { deliveryOperationId } from "@shepherdjerred/delivery/operation-id";
import type { ModelStep } from "#lib/delivery/model/recipe.ts";
import type { createTrmnlPluginClient } from "@shepherdjerred/ops-clients/trmnl.ts";
import {
  inspectTrmnlArchive,
  readTrmnlArchive,
  type TrmnlArchiveReader,
} from "@shepherdjerred/ops-clients/trmnl-archive.ts";
import { withBackupActivityHeartbeat } from "#activities/homelab/seaweedfs-backup-heartbeat.ts";
import { liveTrmnlClients } from "#activities/delivery/trmnl.ts";
import { configureTrmnlPlugins } from "#lib/delivery/trmnl.ts";
import { recordStage, requireOwned, stageOf } from "./stages.ts";

export type ArchiveStepEffects = {
  client: ReturnType<typeof createTrmnlPluginClient>;
  /** Reads `delivery-artifacts/trmnl-plugins/<digest>.json`; the digest names the bytes. */
  readArchive: TrmnlArchiveReader;
  record: typeof recordStage;
  owned: typeof requireOwned;
  signal: AbortSignal;
};

function liveEffects(signal: AbortSignal): ArchiveStepEffects {
  return {
    ...liveTrmnlClients(signal),
    record: recordStage,
    owned: requireOwned,
    signal,
  };
}

/** A compound sub-recipe's key prefix (`sub<n>-`); a single recipe has none. */
const SUB_RECIPE_PREFIX = /^sub\d+-/u;

/**
 * A plugin archive publishes settings its Application's backend serves, so
 * it runs only after that Application's own sync (T3). The recipe contract
 * orders apply-safety before sync but not an archive after it, so a recipe
 * that orders the archive first is refused rather than publishing against an
 * unsynced backend.
 */
export function requireSyncBeforeArchive(
  steps: readonly ModelStep[],
  key: string,
) {
  const prefix = SUB_RECIPE_PREFIX.exec(key)?.[0] ?? "";
  const keys = steps.map((step) => step.key);
  const sync = keys.indexOf(`${prefix}${stepStageKey("step", "sync")}`);
  if (sync === -1 || sync > keys.indexOf(key))
    throw ApplicationFailure.nonRetryable(
      `Step ${key} would publish plugin settings before its Application synced; the recipe must order sync first`,
      "DeliveryModelStepOrder",
    );
}

/** The plugin archive step under an Activity's heartbeat and cancellation. */
export async function runArchiveStep(
  current: DeploymentDetail,
  archiveComponent: string,
  key: string,
): Promise<void> {
  await withBackupActivityHeartbeat(
    Context.current(),
    async ({ signal }) =>
      await applyPluginArchive(
        current,
        archiveComponent,
        key,
        liveEffects(signal),
      ),
    { stage: key },
  );
}

/**
 * The plugin archive step (TRMNL): the frozen bundle is read from
 * `delivery-artifacts` by its digest and every fixed plugin setting is
 * written only when its readback differs. Each write records its own
 * sub-step intent first (`<step>/plugin-<id>`), re-checks ownership and the
 * frozen selection, and is read back before it settles, so a resumed step
 * repeats only the writes whose readback still differs and an ambiguous
 * write leaves the sub-step named for recovery. Acceptance re-reads the
 * archive and every remote setting.
 */
export async function applyPluginArchive(
  current: DeploymentDetail,
  archiveComponent: string,
  key: string,
  effects: ArchiveStepEffects,
): Promise<EvidenceInput[]> {
  const id = current.deployment.id;
  const archive = current.versionSet.components[archiveComponent];
  if (archive?.kind !== "archive")
    throw new Error(
      `Selection lacks the frozen plugin archive ${archiveComponent}`,
    );
  const bundle = await readTrmnlArchive(archive, effects.readArchive);
  const operationId = deliveryOperationId(`${id}:${key}`);
  if (stageOf(current, key) === undefined)
    await effects.record(current, key, "running", {
      operationId,
      message: `Configuring the fixed plugins from archive ${archive.digest}`,
    });
  await configureTrmnlPlugins(bundle, {
    client: effects.client,
    signal: effects.signal,
    async fence() {
      const fresh = await effects.owned(id);
      if (
        fresh.deployment.versionSetRevisionId !==
        current.deployment.versionSetRevisionId
      )
        throw new Error("Plugin write lost its exact frozen selection");
    },
    async stage(pluginId, status) {
      const pluginKey = `${key}/plugin-${String(pluginId)}`;
      const pluginOperation = deliveryOperationId(`${id}:${pluginKey}`);
      await effects.record(current, pluginKey, status, {
        operationId: pluginOperation,
        evidence:
          status === "running"
            ? []
            : [
                {
                  kind: "reconciliation",
                  operationId: pluginOperation,
                  summary: `Plugin ${String(pluginId)} readback matches archive ${archive.digest}`,
                },
              ],
      });
    },
  });
  const inspection = await inspectTrmnlArchive(archive, {
    readArchive: effects.readArchive,
    client: effects.client,
  });
  const evidence: EvidenceInput[] = [
    {
      kind: "reconciliation",
      operationId,
      summary: `All ${String(inspection.pluginCount)} fixed plugin settings independently match archive ${inspection.archiveDigest}`,
    },
    {
      kind: "acceptance",
      operationId,
      summary: JSON.stringify({
        adapter: "trmnl-plugins",
        archiveArtifactId: archive.id,
        archiveDigest: archive.digest,
        versionSetRevisionId: current.versionSet.id,
        pluginCount: inspection.pluginCount,
      }),
    },
  ];
  await effects.record(current, key, "succeeded", { operationId, evidence });
  return evidence;
}
