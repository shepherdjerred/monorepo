import type {
  ArtifactVersion,
  DeploymentDetail,
} from "@shepherdjerred/delivery/contract";
import { minecraftUpgradeOf } from "@shepherdjerred/delivery/model-contract";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { minecraftRuntimeImage } from "#lib/delivery/minecraft.ts";
import { requireMinecraftPreservation } from "#lib/delivery/minecraft-acceptance.ts";
import { workerApplicationResources } from "#lib/delivery/workers/worker-hosts.ts";
import { argoRequest } from "#activities/delivery/argocd.ts";
import { preserveDeliveryMinecraft } from "#activities/delivery/minecraft.ts";
import { verifyDeliveryPods } from "#activities/delivery/runtime.ts";
import type { KubernetesApplicationRecipe } from "#lib/delivery/model/recipe.ts";
import { recordStage, stageOf } from "./stages.ts";

/** The TSMC Application the upgrade restarts; the reviewed target is fixed. */
const SERVER = "minecraft-tsmc";

/** The v1 preservation controller and runtime readback, shared by the model step. */
export type MinecraftUpgradeEffects = {
  record: typeof recordStage;
  preserve: (id: string) => Promise<{ status: "waiting" | "ready" }>;
  pods: (application: string) => Promise<unknown[]>;
  verifyPods: (
    pods: unknown[],
    artifacts: ArtifactVersion[],
    references: ReadonlyMap<string, string>,
  ) => Promise<void>;
};

const external: MinecraftUpgradeEffects = {
  record: recordStage,
  preserve: async (id) => await preserveDeliveryMinecraft(id),
  pods: async (application) =>
    await workerApplicationResources(application, "Pod", argoRequest),
  verifyPods: verifyDeliveryPods,
};

function upgradeOf(current: DeploymentDetail) {
  const upgrade = minecraftUpgradeOf(current.pipeline.definition);
  if (upgrade === undefined)
    throw new Error("A minecraft-upgrade step requires its declared upgrade");
  return upgrade;
}

/**
 * The minecraft-upgrade step. A `verified-restore` upgrade runs before the
 * sync: the preservation controller backs the world up, restores it
 * independently and plays the candidate on the copy; players online defer
 * it, and the step waits rather than holding a stopped server. A
 * `retained-volume-restart` runs after the sync and reads back that the
 * server runs exactly the selected image on its retained volume.
 */
export async function runMinecraftUpgradeStep(
  current: DeploymentDetail,
  key: string,
  effects: MinecraftUpgradeEffects = external,
): Promise<{ waiting: boolean }> {
  const upgrade = upgradeOf(current);
  // Validates the reviewed TSMC target and refuses a rollback first.
  const image = minecraftRuntimeImage(current);
  const id = current.deployment.id;
  const operationId = deliveryOperationId(`${id}:minecraft-upgrade`);
  if (stageOf(current, key) === undefined)
    await effects.record(current, key, "running", { operationId });
  if (upgrade.releaseMode === "verified-restore") {
    const preserved = await effects.preserve(id);
    if (preserved.status === "waiting") return { waiting: true };
    await effects.record(current, key, "succeeded", {
      operationId,
      evidence: [
        {
          kind: "preflight",
          operationId,
          summary: JSON.stringify({
            adapter: "minecraft-upgrade",
            releaseMode: upgrade.releaseMode,
            candidateImage: image,
            preserved: true,
          }),
        },
      ],
    });
    return { waiting: false };
  }
  const artifact = current.versionSet.components[upgrade.imageComponent];
  if (artifact?.kind !== "image")
    throw new Error("TSMC upgrade lacks its selected server image");
  await effects.verifyPods(
    await effects.pods(SERVER),
    [artifact],
    new Map([[artifact.id, image]]),
  );
  await effects.record(current, key, "succeeded", {
    operationId,
    evidence: [
      {
        kind: "runtime",
        operationId,
        summary: JSON.stringify({
          adapter: "minecraft-upgrade",
          releaseMode: upgrade.releaseMode,
          runningImage: image,
        }),
      },
    ],
  });
  return { waiting: false };
}

/**
 * Before the sync switches the image of a world a verified-restore upgrade
 * preserved: the preservation stage and its fresh candidate evidence are
 * still required (v1 `applyDelivery`'s check).
 */
export function minecraftSyncFence(
  current: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
): void {
  const upgrade = recipe.steps.find(
    (step) => step.kind === "minecraft-upgrade",
  );
  if (
    upgrade?.kind === "minecraft-upgrade" &&
    upgrade.releaseMode === "verified-restore"
  )
    requireMinecraftPreservation(current);
}
