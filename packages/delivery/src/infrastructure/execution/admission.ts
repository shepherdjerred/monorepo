import { DeliveryError } from "#domain/error.ts";
import type { Environment, StoredRecipeDefinition } from "#shared/contract.ts";
import {
  type AdmissionSnapshot,
  AdmissionSnapshotSchema,
} from "#shared/model/admission-contract.ts";
import {
  RecipeDefinitionSchema,
  recipeInstances,
  recipeRunners,
} from "#shared/model/recipe-contract.ts";
import {
  artifact,
  orderKey,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import { liveSet } from "#infrastructure/composition/automatic.ts";
import { required } from "#infrastructure/delivery-records.ts";
import { targetInstances } from "./ownership.ts";
import { legacyPipelineOf } from "./legacy-recipe.ts";

/** A model recipe, or null for a pre-cutover pipeline. */
export function modelRecipeOf(definition: StoredRecipeDefinition) {
  const parsed = RecipeDefinitionSchema.safeParse(definition);
  return parsed.success && legacyPipelineOf(definition) === null
    ? parsed.data
    : null;
}

/** Instances a deployment locks in canonical order and whether it takes the shared lock (T1). */
export function admissionTargets(
  definition: StoredRecipeDefinition,
  application: string | null,
) {
  const model = modelRecipeOf(definition);
  if (model === null) {
    const legacy = required(legacyPipelineOf(definition), "Recipe");
    return { instances: targetInstances(legacy, application), shared: false };
  }
  return {
    instances: recipeInstances(model).toSorted(),
    shared: sharedLockOf(model),
  };
}

function sharedLockOf(definition: ReturnType<typeof modelRecipeOf>): boolean {
  if (definition === null) return false;
  switch (definition.kind) {
    case "kubernetes-application":
    case "tofu":
      return definition.sharedLock === "platform";
    case "operator-run":
      return sharedLockOf(definition.wrapped);
    case "compound":
      return definition.subRecipes.some((sub) => sharedLockOf(sub.definition));
    case "static-site":
    case "channel":
      return false;
  }
}

function keyAtLeast(candidate: string | null, floor: string | null) {
  // A manual set revision carries no order key; any acceptance satisfies it.
  return floor === null || (candidate !== null && candidate >= floor);
}

/** Every prerequisite edge holds now; the accepted selections it found (Z1). */
async function prerequisites(
  tx: Transaction,
  row: { environmentId: string; versionSetRevisionId: string },
): Promise<AdmissionSnapshot["prerequisites"]> {
  const selected = await tx.versionSet.findUniqueOrThrow({
    where: { id: row.versionSetRevisionId },
  });
  const floor = orderKey(selected.orderMajor, selected.orderMinor);
  const frozen: AdmissionSnapshot["prerequisites"] = [];
  for (const edge of await tx.prerequisiteEdge.findMany({
    where: { dependentId: row.environmentId },
    orderBy: { prerequisiteId: "asc" },
  })) {
    const prerequisite = await tx.environment.findUniqueOrThrow({
      where: { id: edge.prerequisiteId },
    });
    const accepted =
      prerequisite.acceptedDeploymentId === null
        ? null
        : await tx.deployment.findUniqueOrThrow({
            where: { id: prerequisite.acceptedDeploymentId },
            include: { configuration: false },
          });
    const set =
      accepted === null
        ? null
        : await tx.versionSet.findUniqueOrThrow({
            where: { id: accepted.versionSetRevisionId },
          });
    const key = set === null ? null : orderKey(set.orderMajor, set.orderMinor);
    if (
      accepted === null ||
      set === null ||
      (edge.rule === "same-or-later-order-key" && !keyAtLeast(key, floor))
    )
      throw new DeliveryError(
        "BUSY",
        `Waiting for ${edge.prerequisiteId} to accept a qualifying selection (${edge.rule})`,
      );
    frozen.push({
      environmentId: edge.prerequisiteId,
      rule:
        edge.rule === "any-accepted"
          ? "any-accepted"
          : "same-or-later-order-key",
      deploymentId: accepted.id,
      versionSetRevisionId: set.id,
      orderKey: key,
    });
  }
  return frozen;
}

async function runners(
  tx: Transaction,
  definition: ReturnType<typeof modelRecipeOf>,
): Promise<AdmissionSnapshot["runners"]> {
  if (definition === null) return [];
  const frozen: AdmissionSnapshot["runners"] = [];
  for (const runner of recipeRunners(definition)) {
    const live = await liveSet(tx, runner.service);
    const entry = live?.entries.find(
      (candidate) => candidate.component === runner.component,
    );
    if (entry === undefined)
      throw new DeliveryError(
        "BUSY",
        `Runner ${runner.service} ${runner.component} has no live artifact yet`,
      );
    frozen.push({ ...runner, artifact: await artifact(tx, entry.artifactId) });
  }
  return frozen;
}

/** Freeze what admission found; any unmet input keeps the deployment queued (Z1). */
export async function freezeAdmission(
  tx: Transaction,
  row: { environmentId: string; versionSetRevisionId: string },
  definition: StoredRecipeDefinition,
): Promise<AdmissionSnapshot> {
  return AdmissionSnapshotSchema.parse({
    prerequisites: await prerequisites(tx, row),
    runners: await runners(tx, modelRecipeOf(definition)),
  });
}

/** A retried deployment rechecks its prerequisites against today's acceptances (Z1). */
export async function recheckAdmission(
  tx: Transaction,
  row: {
    environmentId: string;
    versionSetRevisionId: string;
    admissionSnapshot: unknown;
  },
) {
  if (row.admissionSnapshot === null) return;
  AdmissionSnapshotSchema.parse(row.admissionSnapshot);
  await prerequisites(tx, row);
}

/** The self-hosted dispatch barrier (D8): one self-hosted deployment owns the executor at a time. */
export async function requireDispatchBarrier(
  tx: Transaction,
  row: { id: string; serviceId: string },
  env: Pick<Environment, "id">,
) {
  const holder = await tx.deployment.findFirst({
    where: {
      id: { not: row.id },
      service: { selfHosted: true },
      OR: [{ status: "running" }, { recoveryRequired: true }],
    },
    select: { id: true, environmentId: true },
  });
  if (holder !== null)
    throw new DeliveryError(
      "BUSY",
      `Self-hosted deployment ${holder.id} of ${holder.environmentId} holds the dispatch barrier`,
    );
  const service = await tx.service.findUniqueOrThrow({
    where: { id: row.serviceId },
  });
  if (!service.selfHosted) return;
  const owned = await tx.deployment.count({
    where: {
      id: { not: row.id },
      OR: [{ status: "running" }, { recoveryRequired: true }],
    },
  });
  if (owned > 0)
    throw new DeliveryError(
      "BUSY",
      `${env.id} is self-hosted; waiting for every owned deployment to settle before taking the dispatch barrier (D8)`,
    );
}
