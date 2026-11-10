import {
  applicationsOf,
  forumReleaseOf,
  siteReleaseOf,
  trmnlPluginsOf,
  workerRolloutOf,
} from "#shared/model/recipe-view.ts";
import { z } from "zod";
import { RecipeDefinitionSchema } from "#shared/model/recipe-contract.ts";
import { stepStageKey, subRecipeStageKey } from "#shared/model/stage-keys.ts";
import type { StoredRecipeDefinition } from "#shared/model/record-contract.ts";
import { DeliveryError } from "#domain/error.ts";
import type { DeploymentDetail, EvidenceInput } from "#shared/contract.ts";
import { RecoverDeploymentSchema } from "#shared/contract.ts";
import type { ApplicationReader } from "#infrastructure/kubernetes/application-reader.ts";

export const RecoveryRequestSchema = RecoverDeploymentSchema.clone();
const ArgoRecoverySchema = z.object({
  metadata: z.object({
    name: z.string(),
    resourceVersion: z.string().min(1),
    annotations: z.record(z.string(), z.string()),
  }),
  operation: z.unknown().optional(),
  status: z.object({
    operationState: z.object({
      phase: z.enum(["Running", "Terminating", "Succeeded", "Failed", "Error"]),
      finishedAt: z.iso.datetime({ offset: true }).optional(),
      operation: z.object({
        info: z.array(z.object({ name: z.string(), value: z.string() })),
      }),
    }),
    resources: z.array(
      z.object({
        kind: z.string(),
        health: z.object({ status: z.string() }).optional(),
      }),
    ),
  }),
});

/** One Application the deployment synced, and the stage that recorded its request (T3). */
type SyncTarget = { application: string; stage: string };

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

/**
 * The stage whose operation identity is the Application sync's request: a
 * v1 pipeline's `reconcile`, or a model recipe's sync step, prefixed by its
 * sub-recipe's position inside a compound recipe (T3).
 */
function syncStageKey(definition: StoredRecipeDefinition): string {
  const model = RecipeDefinitionSchema.safeParse(definition);
  if (!model.success) return "reconcile";
  const sync = stepStageKey("step", "sync");
  if (model.data.kind !== "compound") return sync;
  const index = model.data.subRecipes.findIndex(
    (sub) => sub.definition.kind === "kubernetes-application",
  );
  return subRecipeStageKey(index, sync);
}

/**
 * The Applications readback settles: the recipe's one Application, or each
 * sub-recipe of a compound recipe made only of Applications, whose sync
 * steps all record the deployment's one request (T3). Null when Application
 * readback alone cannot prove the target.
 */
function syncTargets(definition: StoredRecipeDefinition): SyncTarget[] | null {
  if (definition.kind === "compound") {
    const sync = stepStageKey("step", "sync");
    const applications = definition.subRecipes.flatMap((sub, index) =>
      sub.definition.kind === "kubernetes-application"
        ? [
            {
              application: sub.definition.application.name,
              stage: subRecipeStageKey(index, sync),
            },
          ]
        : [],
    );
    if (applications.length === definition.subRecipes.length)
      return applications;
  }
  const applications = applicationsOf(definition);
  const application = applications[0];
  return application !== undefined && applications.length === 1
    ? [{ application: application.name, stage: syncStageKey(definition) }]
    : null;
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
    if (
      targets === null ||
      definition.kind === "static-site" ||
      workerRolloutOf(definition) !== undefined ||
      siteReleaseOf(definition) !== undefined ||
      forumReleaseOf(definition) !== undefined
    )
      throw new DeliveryError(
        "INVALID",
        "This target requires its specialized recovery procedure; retain ownership until its external work is settled",
      );
    const plugins = trmnlPluginsOf(definition);
    if (plugins !== undefined && options.inspectTrmnl === undefined)
      throw new DeliveryError(
        "PAUSED",
        "TRMNL recovery requires independent exact plugin-bundle readback; native Argo settlement alone is insufficient",
      );
    const recorded = targets.map((target) => {
      const stage = detail.stages.find((entry) => entry.key === target.stage);
      // A sync that was never recorded may still have written its body.
      if (stage === undefined)
        throw new DeliveryError(
          "CONFLICT",
          `Deployment has no recorded reconciliation operation for ${target.application} to inspect`,
        );
      return { target, requestId: stage.operationId };
    });
    const settled = [];
    for (const { target, requestId } of recorded) {
      const raw = await options.readApplication(target.application);
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
      settled.push({
        current,
        requestId,
        ...requireSettled(current, detail, target, requestId),
      });
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
      plugins !== undefined && options.inspectTrmnl !== undefined
        ? await options.inspectTrmnl(detail)
        : [];
    return [
      ...settled.map(
        ({ current, requestId, identity, finishedAt }): EvidenceInput => ({
          kind: "reconciliation",
          operationId: identity,
          summary: `Independent Application readback: ${current.metadata.name}, resourceVersion ${current.metadata.resourceVersion}, request ${requestId}, operation ${identity}, phase ${current.status.operationState.phase}, finished ${finishedAt}. ${input.reason}`,
        }),
      ),
      ...pluginEvidence,
    ];
  };
}
