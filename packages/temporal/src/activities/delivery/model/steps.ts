import { ApplicationFailure } from "@temporalio/activity";
import { z } from "zod";
import type { EvidenceInput } from "@shepherdjerred/delivery/contract";
import type { RecipeDefinition } from "@shepherdjerred/delivery/model-contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import {
  modelSteps,
  oracleProbes,
  requireModelRecipe,
  requireSettledBefore,
  requireStep,
  resumeAt,
  stepRecipe,
  type KubernetesApplicationRecipe,
  type ModelStep,
} from "#lib/delivery/model/recipe.ts";
import { applySafety, enableSelfHeal, sync } from "./kubernetes.ts";
import { oracleEvidence, runTestStep } from "./oracle.ts";
import { awaitAttestations } from "./operator-run.ts";
import { runWorkerRolloutStep } from "./worker-rollout.ts";
import { runMinecraftUpgradeStep } from "./minecraft-upgrade.ts";
import { runPlayersOfflineStep } from "./players-offline.ts";
import { runChannelStep } from "./channel.ts";
import { stepLease, withLeaseRenewal } from "./lease.ts";
import { runStaticSiteStep } from "./static-site.ts";
import { runArchiveStep } from "./archive.ts";
import { requireSyncedBefore } from "./step-order.ts";
import { runForumBundleStep } from "./forum-bundle.ts";
import {
  deploymentDetail,
  deploymentPath,
  executorIdentity,
  requireOwned,
} from "./stages.ts";

/** The frozen step keys and the first unsettled one (intent before effect). */
export async function planDeliveryModel(id: string) {
  const current = await requireOwned(id);
  const steps = modelSteps(requireModelRecipe(current));
  return {
    keys: steps.map((step) => step.key),
    resumeAt: resumeAt(steps, current.stages),
    // Tofu steps hold platform authority and run on its own queue.
    platform: steps
      .filter((step) => step.adapter === "tofu")
      .map((step) => step.key),
    // A self-hosted service's executor hands off after applying (D8).
    handoff: current.selfHosted,
  };
}

/** Each step renews the lease under the executor's own identity (D7). */
export async function renewDeliveryLease(id: string) {
  await deliveryRequest(
    `${deploymentPath(id)}/lease`,
    z.unknown(),
    executorIdentity(),
  );
}

function kubernetes(recipe: RecipeDefinition): KubernetesApplicationRecipe {
  if (recipe.kind !== "kubernetes-application")
    throw new Error(`A ${recipe.kind} recipe has no Kubernetes steps`);
  return recipe;
}

function missingAdapter(kind: string): never {
  throw ApplicationFailure.nonRetryable(
    `This executor version has no ${kind} step adapter; the deployment stays owned for inspection`,
    "DeliveryModelAdapterMissing",
  );
}

async function runKubernetesStep(
  current: Awaited<ReturnType<typeof requireOwned>>,
  recipe: KubernetesApplicationRecipe,
  steps: readonly ModelStep[],
  frozen: Extract<ModelStep, { adapter: "kubernetes" }>,
): Promise<{ waiting: boolean }> {
  const { key, step } = frozen;
  switch (step.kind) {
    case "apply-safety":
      await applySafety(current, recipe, key);
      return { waiting: false };
    case "sync":
      await sync(current, recipe, key);
      return { waiting: false };
    case "worker-rollout":
      requireSettledBefore(steps, current.stages, key);
      await runWorkerRolloutStep(current, key);
      return { waiting: false };
    case "minecraft-upgrade":
      requireSettledBefore(steps, current.stages, key);
      return await runMinecraftUpgradeStep(current, key);
    case "players-offline":
      requireSettledBefore(steps, current.stages, key);
      return await runPlayersOfflineStep(current, key);
    case "static-site":
      requireSyncedBefore(steps, key, step.kind);
      requireSettledBefore(steps, current.stages, key);
      await runStaticSiteStep(current, step.policy, key);
      return { waiting: false };
    case "archive":
      requireSyncedBefore(steps, key, step.kind);
      requireSettledBefore(steps, current.stages, key);
      await runArchiveStep(current, step.archiveComponent, key);
      return { waiting: false };
    case "forum-bundle":
      requireSyncedBefore(steps, key, step.kind);
      requireSettledBefore(steps, current.stages, key);
      await runForumBundleStep(current, recipe, key);
      return { waiting: false };
  }
}

/**
 * Runs one frozen step by key; a settled step is a no-op so a resumed run
 * never repeats it. `waiting` asks the Workflow to run it again later. The
 * lease is renewed for as long as the step runs.
 */
export async function runDeliveryModelStep(
  id: string,
  key: string,
): Promise<{ waiting: boolean }> {
  const current = await requireOwned(id);
  const settled = current.stages.some(
    (stage) => stage.key === key && stage.status === "succeeded",
  );
  return settled
    ? { waiting: false }
    : await withLeaseRenewal(
        stepLease(current),
        async () => await runOwnedStep(current, key),
      );
}

async function runOwnedStep(
  current: Awaited<ReturnType<typeof requireOwned>>,
  key: string,
): Promise<{ waiting: boolean }> {
  const recipe = requireModelRecipe(current);
  const steps = modelSteps(recipe);
  const step = requireStep(steps, key);
  // A compound recipe's step runs against its own sub-recipe.
  const owner = stepRecipe(recipe, key);
  switch (step.adapter) {
    case "kubernetes":
      return await runKubernetesStep(current, kubernetes(owner), steps, step);
    case "static-site":
      // A compound recipe's site sub-recipe never runs ahead of its earlier
      // members, as an Application's site step does not (T3).
      requireSettledBefore(steps, current.stages, key);
      await runStaticSiteStep(current, step.policy, key);
      return { waiting: false };
    case "test":
      await runTestStep(current, kubernetes(owner), step);
      return { waiting: false };
    case "operator-run":
      // Attestations name the deployment's own operator-run recipe.
      if (owner !== recipe) return missingAdapter("compound operator-run");
      if (owner.kind !== "operator-run")
        throw new Error(`A ${owner.kind} recipe has no attestation step`);
      return await awaitAttestations(current, owner, key);
    case "tofu":
      throw new Error(
        `Tofu step ${key} runs on the platform queue, never the Delivery queue`,
      );
    case "channel":
      if (owner.kind !== "channel")
        throw new Error(`A ${owner.kind} recipe has no channel step`);
      await runChannelStep(current, owner, step);
      return { waiting: false };
  }
}

/** The oracle after every step settled (4.14). */
export async function acceptDeliveryModel(
  id: string,
): Promise<EvidenceInput[]> {
  const current = await requireOwned(id);
  const recipe = requireModelRecipe(current);
  return await oracleEvidence(
    current,
    modelSteps(recipe).map((step) => step.key),
    oracleProbes(recipe),
  );
}

/**
 * The Application recipes self-heal turns on after acceptance: the recipe's
 * own, or each kubernetes-application sub-recipe of a compound recipe,
 * rendered exactly as its sync step rendered it (T4).
 */
function selfHealingRecipes(
  recipe: RecipeDefinition,
): KubernetesApplicationRecipe[] {
  switch (recipe.kind) {
    case "kubernetes-application":
      return [recipe];
    case "compound":
      return recipe.subRecipes.flatMap((sub) =>
        sub.definition.kind === "kubernetes-application"
          ? [sub.definition]
          : [],
      );
    case "static-site":
    case "tofu":
    case "channel":
    case "operator-run":
      return [];
  }
}

/**
 * After acceptance: self-heal on the accepted exact source (T4). It returns
 * null: histories recorded while the retired cold-start snapshot existed
 * returned a snapshot to write here, and the Workflow keeps that branch
 * only for their replay.
 */
export async function settleDeliveryModel(id: string): Promise<null> {
  const current = await deploymentDetail(id);
  if (
    current.deployment.status !== "succeeded" ||
    current.environment.acceptedDeploymentId !== id
  )
    return null;
  for (const application of selfHealingRecipes(requireModelRecipe(current)))
    await enableSelfHeal(current, application);
  return null;
}
