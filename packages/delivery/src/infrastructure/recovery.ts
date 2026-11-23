import {
  applicationsOf,
  forumReleaseOf,
  kubernetesRecipes,
  siteReleaseOf,
  trmnlPluginsOf,
  workerRolloutOf,
} from "#shared/model/recipe-view.ts";
import type { z } from "zod";
import {
  helmSource,
  type KubernetesStep,
  type RecipeDefinition,
  RecipeDefinitionSchema,
} from "#shared/model/recipe-contract.ts";
import { stepStageKey, subRecipeStageKey } from "#shared/model/stage-keys.ts";
import type { StoredRecipeDefinition } from "#shared/model/record-contract.ts";
import { DeliveryError } from "#domain/error.ts";
import type { DeploymentDetail, EvidenceInput } from "#shared/contract.ts";
import { RecoverDeploymentSchema } from "#shared/contract.ts";
import type { ApplicationReader } from "#infrastructure/kubernetes/application-reader.ts";
import {
  ArgoRecoverySchema,
  inspectNeverRequestedSync,
  inspectUnsyncedTarget,
  requireKnownModelStages,
  type SettledApplicationReadback,
  type SyncTarget,
} from "./argo-recovery/unsynced.ts";

export const RecoveryRequestSchema = RecoverDeploymentSchema.clone();

/**
 * What a recovery inspection names: the external operation an operator
 * read, or none when Delivery settles its own intent and takes each
 * Application's identity from the readback.
 */
export type RecoveryInspection = { operationId?: string; reason: string };

function requireSettled(
  current: z.infer<typeof ArgoRecoverySchema>,
  detail: DeploymentDetail,
  target: SyncTarget,
  requestId: string,
) {
  const operation = current.status.operationState;
  if (
    current.metadata.name !== target.application ||
    current.metadata.annotations["delivery.shepherdjerred.com/environment"] !==
      detail.environment.id ||
    (current.operation !== undefined && current.operation !== null) ||
    ["Running", "Terminating"].includes(operation.phase) ||
    operation.finishedAt === undefined
  )
    throw new DeliveryError(
      "CONFLICT",
      `Argo ownership of ${target.application} differs or its work is unsettled; keep target ownership`,
    );
  const requests = operation.operation.info.filter(
    (entry) => entry.name === "ci.sjer.red/request-id",
  );
  const identities = operation.operation.info.filter(
    (entry) => entry.name === "ci.sjer.red/operation-id",
  );
  const identity = identities[0]?.value;
  if (
    identity === undefined ||
    requests.length !== 1 ||
    identities.length !== 1 ||
    requests[0]?.value !== requestId
  )
    throw new DeliveryError(
      "CONFLICT",
      `Readback of ${target.application} does not match the deployment's recorded request`,
    );
  if (
    current.status.resources.some(
      (entry) => entry.kind === "Job" && entry.health?.status !== "Healthy",
    )
  )
    throw new DeliveryError(
      "CONFLICT",
      "Application includes an unsettled Job; inspect it through its specialized recovery procedure",
    );
  return { finishedAt: operation.finishedAt, identity };
}

/** Pre-sync Application steps that read live state without mutating external targets. */
const READ_ONLY_PRE_SYNC_STEPS: ReadonlySet<KubernetesStep["kind"]> = new Set([
  "players-offline",
]);

function modelSyncTarget(
  recipe: Extract<RecipeDefinition, { kind: "kubernetes-application" }>,
  index?: number,
): SyncTarget {
  const qualify = (key: string) =>
    index === undefined ? key : subRecipeStageKey(index, key);
  const stage = qualify(stepStageKey("step", "sync"));
  const applySafetyStage = qualify(stepStageKey("step", "apply-safety"));
  const readOnlyPreSync = recipe.steps
    .filter((step) => READ_ONLY_PRE_SYNC_STEPS.has(step.kind))
    .map((step) => qualify(stepStageKey("step", step.kind)));
  const helm = helmSource(recipe.application.source);
  return {
    application: recipe.application.name,
    stage,
    applySafetyStage,
    ...(helm === null
      ? {}
      : {
          helmChart: {
            repoURL: helm.repoURL,
            chart: helm.chart,
            chartComponent: recipe.chartComponent,
          },
        }),
    preSyncStages: [applySafetyStage, ...readOnlyPreSync],
    declaredStages: [
      ...recipe.steps.map((step) => qualify(stepStageKey("step", step.kind))),
      ...recipe.oracle.tests.map((test) =>
        qualify(stepStageKey("test", test.suite)),
      ),
    ],
  };
}

/**
 * The stage keys of a single-Application recipe: a v1 pipeline's `reconcile`
 * (with no apply-safety stage), or a model recipe's declared steps, prefixed
 * inside a compound recipe (T3).
 */
function singleTargetStages(
  definition: StoredRecipeDefinition,
  application: string,
): SyncTarget {
  const model = RecipeDefinitionSchema.safeParse(definition);
  if (!model.success) {
    return {
      application,
      stage: "reconcile",
      applySafetyStage: null,
      preSyncStages: [],
      declaredStages: ["reconcile"],
    };
  }
  if (model.data.kind !== "compound") {
    const recipe = kubernetesRecipes(model.data)[0];
    if (recipe === undefined)
      throw new Error(`Expected Application recipe for ${application}`);
    return modelSyncTarget(recipe);
  }
  const index = model.data.subRecipes.findIndex(
    (sub) => kubernetesRecipes(sub.definition).length === 1,
  );
  const sub = model.data.subRecipes[index];
  const recipe =
    sub === undefined ? undefined : kubernetesRecipes(sub.definition)[0];
  if (recipe === undefined)
    throw new Error(`Expected Application sub-recipe for ${application}`);
  return modelSyncTarget(recipe, index);
}

/**
 * The Applications readback settles: the recipe's one Application, or each
 * sub-recipe of a compound recipe made only of Applications, whose sync
 * steps all record the deployment's one request (T3). Null when Application
 * readback alone cannot prove the target.
 */
function syncTargets(definition: StoredRecipeDefinition): SyncTarget[] | null {
  if (definition.kind === "compound") {
    const applications = definition.subRecipes.flatMap((sub, index) =>
      sub.definition.kind === "kubernetes-application"
        ? [modelSyncTarget(sub.definition, index)]
        : [],
    );
    if (applications.length === definition.subRecipes.length)
      return applications;
  }
  const applications = applicationsOf(definition);
  const application = applications[0];
  return application !== undefined && applications.length === 1
    ? [singleTargetStages(definition, application.name)]
    : null;
}

function inspectSyncedTarget(
  raw: unknown,
  detail: DeploymentDetail,
  target: SyncTarget,
  sync: { requestId: string; reason: string },
): SettledApplicationReadback {
  if (raw === null)
    throw new DeliveryError(
      "CONFLICT",
      `Application ${target.application} does not exist; keep target ownership`,
    );
  const parsed = ArgoRecoverySchema.safeParse(raw);
  if (!parsed.success)
    throw new DeliveryError(
      "CONFLICT",
      `Application ${target.application} records no finished operation to inspect; keep target ownership`,
    );
  const current = parsed.data;
  const { finishedAt, identity } = requireSettled(
    current,
    detail,
    target,
    sync.requestId,
  );
  return {
    identity,
    evidence: {
      kind: "reconciliation",
      operationId: identity,
      summary: `Independent Application readback: ${current.metadata.name}, resourceVersion ${current.metadata.resourceVersion}, request ${sync.requestId}, operation ${identity}, phase ${current.status.operationState.phase}, finished ${finishedAt}. ${sync.reason}`,
    },
  };
}

/**
 * Whether the Application's pending or recorded operation can be this sync
 * stage's own request. Anything that cannot be read as another request's
 * settled operation takes the synced readback, which fails closed.
 */
function carriesRequest(raw: unknown, requestId: string): boolean {
  const parsed = ArgoRecoverySchema.safeParse(raw);
  if (!parsed.success) return true;
  const current = parsed.data;
  if (current.operation !== undefined && current.operation !== null)
    return true;
  const requests = current.status.operationState.operation.info.filter(
    (entry) => entry.name === "ci.sjer.red/request-id",
  );
  return requests.length !== 1 || requests[0]?.value === requestId;
}

/**
 * One recorded sync stage's readback, from a single read of its Application:
 * its own finished operation, or a request that never reached one (AI-884).
 * A Forum release settles only through the latter.
 */
async function inspectRecordedSync(
  readApplication: ApplicationReader,
  detail: DeploymentDetail,
  target: SyncTarget,
  sync: {
    stage: { operationId: string; status: string; startedAt: string | null };
    reason: string;
    neverRequestedOnly: boolean;
    specialized: DeliveryError;
  },
): Promise<SettledApplicationReadback> {
  const { stage, reason } = sync;
  const raw = await readApplication(target.application);
  const own =
    stage.status !== "running" || carriesRequest(raw, stage.operationId);
  if (own && sync.neverRequestedOnly) throw sync.specialized;
  return own
    ? inspectSyncedTarget(raw, detail, target, {
        requestId: stage.operationId,
        reason,
      })
    : inspectNeverRequestedSync(raw, detail, target, { stage, reason });
}

/**
 * Independent of Temporal and of ArgoCD's API: inspect the recorded
 * operation on each Application object through the projected reader (D5).
 * A supplied operation identity must be one of the Applications'; every
 * Application is still checked, and each yields its own evidence.
 */
export function createRecoveryInspector(options: {
  readApplication: ApplicationReader;
  inspectTrmnl?: (detail: DeploymentDetail) => Promise<EvidenceInput[]>;
}) {
  return async (
    detail: DeploymentDetail,
    input: RecoveryInspection,
  ): Promise<EvidenceInput[]> => {
    const definition = detail.pipeline.definition;
    const targets = syncTargets(definition);
    const specialized = new DeliveryError(
      "INVALID",
      "This target requires its specialized recovery procedure; retain ownership until its external work is settled",
    );
    if (
      targets === null ||
      definition.kind === "static-site" ||
      workerRolloutOf(definition) !== undefined ||
      siteReleaseOf(definition) !== undefined
    )
      throw specialized;
    // A Forum release's Job runs only inside its Argo operation: readback
    // settles it only when that operation provably never started (AI-884).
    const neverRequestedOnly = forumReleaseOf(definition) !== undefined;
    const plugins = trmnlPluginsOf(definition);
    if (plugins !== undefined && options.inspectTrmnl === undefined)
      throw new DeliveryError(
        "PAUSED",
        "TRMNL recovery requires independent exact plugin-bundle readback; native Argo settlement alone is insufficient",
      );
    requireKnownModelStages(detail, targets);
    const settled: SettledApplicationReadback[] = [];
    for (const target of targets) {
      const stage = detail.stages.find((entry) => entry.key === target.stage);
      if (stage === undefined && neverRequestedOnly) throw specialized;
      settled.push(
        stage === undefined
          ? await inspectUnsyncedTarget(
              options.readApplication,
              detail,
              target,
              input.reason,
            )
          : await inspectRecordedSync(options.readApplication, detail, target, {
              stage,
              reason: input.reason,
              neverRequestedOnly,
              specialized,
            }),
      );
    }
    if (
      input.operationId !== undefined &&
      !settled.some((entry) => entry.identity === input.operationId)
    )
      throw new DeliveryError(
        "CONFLICT",
        "Readback does not match the supplied external operation identity",
      );
    const pluginEvidence =
      plugins === undefined || options.inspectTrmnl === undefined
        ? []
        : await options.inspectTrmnl(detail);
    return [...settled.map((entry) => entry.evidence), ...pluginEvidence];
  };
}
