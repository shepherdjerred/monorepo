import {
  applicationOf,
  applicationsOf,
  forumReleaseOf,
  minecraftUpgradeOf,
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

function requireSettled(
  current: z.infer<typeof ArgoRecoverySchema>,
  detail: DeploymentDetail,
  input: z.infer<typeof RecoveryRequestSchema>,
  requestId: string,
) {
  const operation = current.status.operationState;
  const application = applicationOf(detail.pipeline.definition)?.name ?? null;
  if (
    current.metadata.name !== application ||
    current.metadata.annotations["delivery.shepherdjerred.com/environment"] !==
      detail.environment.id ||
    (current.operation !== undefined && current.operation !== null) ||
    ["Running", "Terminating"].includes(operation.phase) ||
    operation.finishedAt === undefined
  )
    throw new DeliveryError(
      "CONFLICT",
      "Argo ownership differs or work is unsettled; keep target ownership",
    );
  const requests = operation.operation.info.filter(
    (entry) => entry.name === "ci.sjer.red/request-id",
  );
  const identities = operation.operation.info.filter(
    (entry) => entry.name === "ci.sjer.red/operation-id",
  );
  if (
    requests.length !== 1 ||
    requests[0]?.value !== requestId ||
    identities.length !== 1 ||
    identities[0]?.value !== input.operationId
  )
    throw new DeliveryError(
      "CONFLICT",
      "Readback does not match the deployment's recorded request and supplied external operation identity",
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
  return operation.finishedAt;
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
 * Independent of Temporal and of ArgoCD's API: inspect the recorded
 * operation on the Application object through the projected reader (D5).
 */
export function createRecoveryInspector(options: {
  readApplication: ApplicationReader;
  inspectTrmnl?: (detail: DeploymentDetail) => Promise<EvidenceInput[]>;
}) {
  return async (
    detail: DeploymentDetail,
    input: z.infer<typeof RecoveryRequestSchema>,
  ): Promise<EvidenceInput[]> => {
    const definition = detail.pipeline.definition;
    const application = applicationOf(definition);
    const upgrade = minecraftUpgradeOf(definition);
    if (
      application === null ||
      applicationsOf(definition).length !== 1 ||
      workerRolloutOf(definition) !== undefined ||
      siteReleaseOf(definition) !== undefined ||
      forumReleaseOf(definition) !== undefined ||
      (upgrade !== undefined &&
        upgrade.releaseMode !== "retained-volume-restart")
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
    const syncKey = syncStageKey(definition);
    const recorded = detail.stages.find((entry) => entry.key === syncKey);
    if (recorded === undefined)
      throw new DeliveryError(
        "CONFLICT",
        "Deployment has no recorded reconciliation operation to inspect",
      );
    const raw = await options.readApplication(application.name);
    if (raw === null)
      throw new DeliveryError(
        "CONFLICT",
        `Application ${application.name} does not exist; keep target ownership`,
      );
    const current = ArgoRecoverySchema.parse(raw);
    const operation = current.status.operationState;
    const finishedAt = requireSettled(
      current,
      detail,
      input,
      recorded.operationId,
    );
    const pluginEvidence =
      plugins !== undefined && options.inspectTrmnl !== undefined
        ? await options.inspectTrmnl(detail)
        : [];
    return [
      {
        kind: "reconciliation",
        operationId: input.operationId,
        summary: `Independent Application readback: ${current.metadata.name}, resourceVersion ${current.metadata.resourceVersion}, request ${recorded.operationId}, operation ${input.operationId}, phase ${operation.phase}, finished ${finishedAt}. ${input.reason}`,
      },
      ...pluginEvidence,
    ];
  };
}
