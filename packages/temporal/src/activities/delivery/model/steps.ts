import { ApplicationFailure } from "@temporalio/activity";
import { z } from "zod";
import type { EvidenceInput } from "@shepherdjerred/delivery/contract";
import {
  ColdStartReceiptSchema,
  ColdStartRequirementSchema,
  type ColdStartReceipt,
} from "@shepherdjerred/delivery/model-contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import {
  modelSteps,
  requireModelRecipe,
  requireStep,
  resumeAt,
  type KubernetesApplicationRecipe,
  type ModelRecipe,
} from "#lib/delivery/model/recipe.ts";
import { applySafety, enableSelfHeal, sync } from "./kubernetes.ts";
import { oracleEvidence, runTestStep } from "./oracle.ts";
import { awaitAttestations } from "./operator-run.ts";
import type { ColdStartWrite } from "#lib/delivery/model/oracle-inputs.ts";
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

function kubernetes(recipe: ModelRecipe): KubernetesApplicationRecipe {
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
  step: {
    key: string;
    kind: KubernetesApplicationRecipe["steps"][number]["kind"];
  },
) {
  switch (step.kind) {
    case "apply-safety":
      await applySafety(current, recipe, step.key);
      return;
    case "sync":
      await sync(current, recipe, step.key);
      return;
    case "worker-rollout":
    case "static-site":
    case "archive":
    case "forum-bundle":
    case "minecraft-upgrade":
      missingAdapter(step.kind);
  }
}

/**
 * Runs one frozen step by key; a settled step is a no-op so a resumed run
 * never repeats it. `waiting` asks the Workflow to run it again later.
 */
export async function runDeliveryModelStep(
  id: string,
  key: string,
): Promise<{ waiting: boolean }> {
  const current = await requireOwned(id);
  if (
    current.stages.some(
      (stage) => stage.key === key && stage.status === "succeeded",
    )
  )
    return { waiting: false };
  const recipe = requireModelRecipe(current);
  const step = requireStep(modelSteps(recipe), key);
  switch (step.adapter) {
    case "kubernetes":
      await runKubernetesStep(current, kubernetes(recipe), {
        key,
        kind: step.step.kind,
      });
      return { waiting: false };
    case "test":
      await runTestStep(current, kubernetes(recipe), step);
      return { waiting: false };
    case "operator-run":
      if (recipe.kind !== "operator-run")
        throw new Error(`A ${recipe.kind} recipe has no attestation step`);
      return await awaitAttestations(current, recipe, key);
    case "tofu":
      throw new Error(
        `Tofu step ${key} runs on the platform queue, never the Delivery queue`,
      );
    case "channel":
      return missingAdapter(step.adapter);
  }
}

/** The oracle after every step settled (4.14). */
export async function acceptDeliveryModel(
  id: string,
): Promise<EvidenceInput[]> {
  const current = await requireOwned(id);
  const recipe = requireModelRecipe(current);
  const kubernetesOracle =
    recipe.kind === "operator-run" ? recipe.wrapped : recipe;
  return await oracleEvidence(
    current,
    kubernetesOracle.kind === "kubernetes-application"
      ? kubernetesOracle.oracle.probes
      : [],
  );
}

/**
 * After acceptance: self-heal on the accepted exact source (T4), and the
 * cold-start snapshot to write off-cluster when the chain moved (X7).
 */
export async function settleDeliveryModel(
  id: string,
): Promise<ColdStartWrite | null> {
  const current = await deploymentDetail(id);
  if (
    current.deployment.status !== "succeeded" ||
    current.environment.acceptedDeploymentId !== id
  )
    return null;
  const recipe = requireModelRecipe(current);
  if (recipe.kind === "kubernetes-application")
    await enableSelfHeal(current, recipe);
  const requirement = await deliveryRequest(
    `${deploymentPath(id)}/cold-start`,
    ColdStartRequirementSchema,
  );
  return requirement.required
    ? {
        deploymentId: id,
        fingerprint: requirement.fingerprint,
        snapshot: requirement.snapshot,
      }
    : null;
}

export async function recordDeliveryColdStart(
  id: string,
  receipt: ColdStartReceipt,
) {
  await deliveryRequest(
    `${deploymentPath(id)}/cold-start`,
    ColdStartReceiptSchema,
    receipt,
  );
}
