import { Prisma } from "#generated/prisma/client.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  PipelineRevisionSchema,
  type Environment,
  type StoredRecipeDefinition,
} from "#shared/contract.ts";
import {
  type AdmissionSnapshot,
  AdmissionSnapshotSchema,
} from "#shared/model/admission-contract.ts";
import { RecipeDefinitionSchema } from "#shared/model/recipe-contract.ts";
import {
  recipeInstances,
  recipeRunners,
} from "#shared/model/recipe-bindings.ts";
import {
  artifact,
  environment as readEnvironment,
  orderKey,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import { liveSet } from "#infrastructure/composition/automatic.ts";
import { required, wire } from "#infrastructure/delivery-records.ts";
import { staleSource } from "#infrastructure/selection/selection.ts";
import { AWAITING_HUMAN_GATE } from "#infrastructure/selection/views.ts";
import { targetInstances } from "./ownership.ts";
import { legacyPipelineOf } from "./legacy-recipe.ts";

/** A model recipe, or null for a pre-cutover pipeline. */
export function modelRecipeOf(definition: StoredRecipeDefinition) {
  const parsed = RecipeDefinitionSchema.safeParse(definition);
  return parsed.success && legacyPipelineOf(definition) === null
    ? parsed.data
    : null;
}

/**
 * Whether a model recipe defers acquiring the shared `platform` lock until its
 * mutating `step-apply` stage starts, rather than holding it across read-only
 * `step-plan` and human `step-approve` (AI-907).
 */
export function defersPlatformLockToApply(
  definition: StoredRecipeDefinition,
): boolean {
  return modelRecipeOf(definition)?.kind === "tofu";
}

/** Instances a deployment locks in canonical order and whether claim takes the shared lock (T1). */
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
    shared: sharedLockAtClaim(model),
  };
}

function sharedLockAtClaim(
  definition: ReturnType<typeof modelRecipeOf>,
): boolean {
  if (definition === null) return false;
  switch (definition.kind) {
    case "kubernetes-application":
      return definition.sharedLock === "platform";
    case "tofu":
      return false;
    case "operator-run":
      return (
        definition.wrapped.kind !== "host" &&
        (definition.wrapped.kind === "tofu" ||
          sharedLockAtClaim(definition.wrapped))
      );
    case "compound":
      return definition.subRecipes.some((sub) =>
        sharedLockAtClaim(sub.definition),
      );
    case "static-site":
    case "channel":
      return false;
  }
}

function keyAtLeast(candidate: string | null, floor: string | null) {
  // A manual set revision carries no order key; any acceptance satisfies it.
  return floor === null || (candidate !== null && candidate >= floor);
}

/**
 * A brand-new service's RBAC grant lands in argocd/prod's declared
 * configuration; wait for argocd/prod to accept its declared binding before
 * the initial deployment calls ArgoCD (AI-906).
 */
function requireInitialArgoBinding(
  dependent: { acceptedDeploymentId: string | null } | null,
  prerequisiteId: string,
  prerequisite: {
    declaredConfigurationId: string;
    pipelineRevisionId: string;
  },
  accepted: { configurationId: string; pipelineRevisionId: string },
) {
  if (
    prerequisiteId !== "argocd/prod" ||
    dependent?.acceptedDeploymentId !== null
  )
    return;
  if (
    accepted.configurationId !== prerequisite.declaredConfigurationId ||
    accepted.pipelineRevisionId !== prerequisite.pipelineRevisionId
  )
    throw new DeliveryError(
      "BUSY",
      `Waiting for ${prerequisiteId} to accept its declared configuration ${prerequisite.declaredConfigurationId} and recipe ${prerequisite.pipelineRevisionId}`,
    );
}

/** Every prerequisite edge holds now; the accepted selections it found (Z1). */
async function prerequisites(
  tx: Transaction,
  row: { environmentId: string; versionSetRevisionId: string },
  options: { initialClaim: boolean },
): Promise<AdmissionSnapshot["prerequisites"]> {
  const dependent = options.initialClaim
    ? await tx.environment.findUniqueOrThrow({
        where: { id: row.environmentId },
        select: { acceptedDeploymentId: true },
      })
    : null;
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
    requireInitialArgoBinding(
      dependent,
      edge.prerequisiteId,
      prerequisite,
      accepted,
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
    prerequisites: await prerequisites(tx, row, { initialClaim: true }),
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
  await prerequisites(tx, row, { initialClaim: false });
}

/**
 * Serialize worker claims on either end of a promotion edge while the other
 * end owns a rollout or its recovery. The source's live routing must stay on
 * the promoted candidate through promote-time verification (AI-857, AI-1124).
 * An owning promotion keeps its frozen source through catalog changes. Host
 * retirements preserve the candidate and remain unblocked.
 */
export async function requireRelatedWorkerRolloutsIdle(
  tx: Transaction,
  row: {
    id: string;
    environmentId: string;
    kind: string;
    workerSnapshot: unknown;
  },
  promotionSourceId: string | null,
) {
  if (row.workerSnapshot === null || row.kind === "retire-host") return;
  const blocker = await tx.deployment.findFirst({
    where: {
      id: { not: row.id },
      OR: [{ status: "running" }, { recoveryRequired: true }],
      kind: { not: "retire-host" },
      NOT: [
        { workerSnapshot: { equals: Prisma.DbNull } },
        { workerSnapshot: { equals: Prisma.JsonNull } },
      ],
      AND: {
        OR: [
          { environment: { promotionSourceEnvironmentId: row.environmentId } },
          { kind: "promote", sourceEnvironmentId: row.environmentId },
          ...(promotionSourceId === null
            ? []
            : [{ environmentId: promotionSourceId }]),
        ],
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, environmentId: true },
  });
  if (blocker !== null) {
    const relation =
      blocker.environmentId === promotionSourceId
        ? "promotion source"
        : "dependent";
    throw new DeliveryError(
      "BUSY",
      `Waiting for ${relation} worker rollout ${blocker.id} in ${blocker.environmentId} to settle before advancing ${row.environmentId}`,
    );
  }
}

/** Refuses when another self-hosted deployment is running or quarantined (D8). */
export async function requireNoSelfHostedBarrierHolder(
  tx: Transaction,
  deploymentId: string,
) {
  const holder = await tx.deployment.findFirst({
    where: {
      id: { not: deploymentId },
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
}

async function isAdmissibleSelfHostedCandidate(
  tx: Transaction,
  candidate: {
    id: string;
    environmentId: string;
    versionSetRevisionId: string;
    pipelineRevisionId: string;
    expectedGeneration: number;
    kind: string;
    sourceEnvironmentId: string | null;
  },
): Promise<boolean> {
  const env = await readEnvironment(tx, candidate.environmentId);
  if (
    env.lifecycle !== "active" ||
    env.activeDeploymentId !== null ||
    env.generation !== candidate.expectedGeneration
  )
    return false;
  try {
    if ((await staleSource(tx, candidate, env)) !== null) return false;
    const pipeline = PipelineRevisionSchema.parse(
      wire(
        required(
          await tx.pipeline.findUnique({
            where: { id: candidate.pipelineRevisionId },
          }),
          "Pipeline",
        ),
      ),
    );
    const { instances } = admissionTargets(
      pipeline.definition,
      env.application,
    );
    if (instances.length === 0) return false;
    const quarantinedTarget = await tx.targetLock.findFirst({
      where: {
        instance: { in: instances },
        deploymentId: { not: candidate.id },
        deployment: { status: { not: "running" } },
      },
      select: { instance: true },
    });
    if (quarantinedTarget !== null) return false;
    await freezeAdmission(tx, candidate, pipeline.definition);
    return true;
  } catch (error) {
    if (error instanceof DeliveryError && error.code === "BUSY") return false;
    throw error;
  }
}

async function findAdmissibleQueuedSelfHosted(tx: Transaction) {
  const candidates = await tx.deployment.findMany({
    where: {
      status: "queued",
      cancelRequested: false,
      service: { selfHosted: true },
      environment: { lifecycle: "active", activeDeploymentId: null },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      environmentId: true,
      versionSetRevisionId: true,
      pipelineRevisionId: true,
      expectedGeneration: true,
      kind: true,
      sourceEnvironmentId: true,
    },
  });
  for (const candidate of candidates) {
    if (await isAdmissibleSelfHostedCandidate(tx, candidate)) return candidate;
  }
  return null;
}

/** The self-hosted dispatch barrier (D8): one self-hosted deployment owns the executor at a time. */
export async function requireDispatchBarrier(
  tx: Transaction,
  row: { id: string; serviceId: string; status: string },
  env: Pick<Environment, "id">,
) {
  await requireNoSelfHostedBarrierHolder(tx, row.id);
  const service = await tx.service.findUniqueOrThrow({
    where: { id: row.serviceId },
  });
  if (!service.selfHosted) {
    // Drain mode (AI-572): once a queued self-hosted release is otherwise
    // admissible, pause new ordinary claims while in-flight runs finish.
    if (row.status === "queued") {
      const waiter = await findAdmissibleQueuedSelfHosted(tx);
      if (waiter !== null)
        throw new DeliveryError(
          "BUSY",
          `Self-hosted deployment ${waiter.id} of ${waiter.environmentId} is draining running work before taking the dispatch barrier (D8)`,
        );
    }
    return;
  }
  // Queues drain first: active running work finishes before the executor is
  // replaced. Deployments parked solely on a human saved-plan decision or an
  // operator-run attestation gate have no active in-cluster step and do not
  // starve self-hosted recovery releases (AI-572).
  const blockers = await tx.deployment.findMany({
    where: {
      id: { not: row.id },
      status: "running",
      NOT: AWAITING_HUMAN_GATE,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, environmentId: true },
  });
  if (blockers.length > 0) {
    const named = blockers
      .map((blocker) => `${blocker.environmentId} (${blocker.id})`)
      .join(", ");
    throw new DeliveryError(
      "BUSY",
      `${env.id} is self-hosted; waiting for every running deployment to finish before taking the dispatch barrier (D8): ${named}`,
    );
  }
}
