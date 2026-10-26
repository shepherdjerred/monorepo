import type {
  ArtifactVersion,
  DeploymentDetail,
} from "@shepherdjerred/delivery/contract";
import { minecraftUpgradeOf } from "@shepherdjerred/delivery/model-contract";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { minecraftRuntimeImage } from "#lib/delivery/minecraft.ts";
import { workerApplicationResources } from "#lib/delivery/workers/worker-hosts.ts";
import { argoRequest } from "#activities/delivery/argocd.ts";
import { verifyDeliveryPods } from "#activities/delivery/runtime.ts";
import type { KubernetesApplicationRecipe } from "#lib/delivery/model/recipe.ts";
import { recordStage, stageOf } from "./stages.ts";

/** The TSMC Application the upgrade restarts; the reviewed target is fixed. */
const SERVER = "minecraft-tsmc";

/** Runtime readback of the retained volume, shared by the model step. */
export type MinecraftUpgradeEffects = {
  record: typeof recordStage;
  pods: (application: string) => Promise<unknown[]>;
  verifyPods: (
    pods: unknown[],
    artifacts: ArtifactVersion[],
    references: ReadonlyMap<string, string>,
  ) => Promise<void>;
};

const external: MinecraftUpgradeEffects = {
  record: recordStage,
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
 * The minecraft-upgrade step. It runs after sync and reads back that the
 * server runs exactly the selected image on its retained volume. A historical
 * `verified-restore` mode takes the same path.
 */
export async function runMinecraftUpgradeStep(
  current: DeploymentDetail,
  key: string,
  effects: MinecraftUpgradeEffects = external,
): Promise<{ waiting: boolean }> {
  const upgrade = upgradeOf(current);
  const image = minecraftRuntimeImage(current);
  const id = current.deployment.id;
  const operationId = deliveryOperationId(`${id}:minecraft-upgrade`);
  if (stageOf(current, key) === undefined)
    await effects.record(current, key, "running", { operationId });
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

/** Retained-volume releases have no preservation proof to require before sync. */
export function minecraftSyncFence(
  _current: DeploymentDetail,
  _recipe: KubernetesApplicationRecipe,
): void {
  return;
}
