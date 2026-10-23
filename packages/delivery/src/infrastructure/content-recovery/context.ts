import { DeliveryError } from "#domain/error.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import {
  fingerprint,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";
import {
  PipelineRevisionSchema,
  type DeploymentDetail,
  type StoredRecipeDefinition,
  ContentRecoveryNativeReceiptSchema,
  ContentRecoveryIntentSchema,
} from "#shared/contract.ts";
import type { RecoveryIntent } from "#generated/prisma/client.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";
import { nativeReceipt } from "#infrastructure/platform/policy.ts";
import {
  intentDetail,
  legacyIntentFields,
} from "#infrastructure/recovery-intents.ts";
import {
  forumReleaseOf,
  siteReleaseOf,
  stepApplicationOf,
} from "#shared/model/recipe-view.ts";

/** The content-kind view of a unified recovery intent row. */
export function contentIntentView(row: RecoveryIntent) {
  const detail = intentDetail(row);
  const {
    workflowId: _workflowId,
    submittedAt: _submittedAt,
    ...fields
  } = legacyIntentFields(row);
  return ContentRecoveryIntentSchema.parse(
    wire({
      ...fields,
      targetKind: detail["targetKind"],
      nativeReceipts: detail["nativeReceipts"] ?? [],
      dispatchBarrier: row.barrier,
      barrierRestoredAt: row.barrierRestoredAt,
    }),
  );
}

/**
 * The native instance content recovery repairs, which the failed release
 * holds as its target lock (4.15): a v1 site's bucket or v1 Application, or
 * a model recipe's static-site step bucket or the Application that owns its
 * forum-bundle step, inside a compound recipe too. Null when the recipe
 * releases no content.
 */
function contentTarget(definition: StoredRecipeDefinition): string | null {
  switch (definition.kind) {
    case "static-site":
      return `bucket:${definition.bucket}`;
    case "argocd":
      return `application:${definition.application}`;
    case "kubernetes-application":
    case "operator-run":
    case "compound": {
      const site = siteReleaseOf(definition);
      if (site !== undefined) return `bucket:${site.bucket}`;
      const forum = stepApplicationOf(definition, "forum-bundle");
      return forum === null ? null : `application:${forum.name}`;
    }
    case "control-plane":
    case "root-release":
    case "tofu":
    case "manual":
    case "channel":
      return null;
  }
}

/** The content a frozen release activates, in the order `contentTarget` resolves it. */
export function contentRecoveryKind(pipeline: StoredRecipeDefinition) {
  if (pipeline.kind === "static-site" || siteReleaseOf(pipeline) !== undefined)
    return "static-site";
  if (forumReleaseOf(pipeline) !== undefined) return "forum";
  throw new DeliveryError(
    "INVALID",
    "Independent content recovery is limited to frozen static, Scout-site and Forum releases",
  );
}

export async function heldContentRecovery(
  tx: Transaction,
  input: {
    deploymentId: string;
    expectedEnvironmentGeneration: number;
  },
) {
  const row = required(
    await tx.deployment.findUnique({
      where: { id: input.deploymentId },
      include: { stages: true },
    }),
    "Quarantined content deployment",
  );
  // A frozen recipe of either generation: a model step's content is
  // recovered from its own bucket or Forum Application (4.15).
  const pipeline = PipelineRevisionSchema.parse(
    wire(
      required(
        await tx.pipeline.findUnique({
          where: { id: row.pipelineRevisionId },
        }),
        "Frozen content pipeline",
      ),
    ),
  );
  const targetKind = contentRecoveryKind(pipeline.definition);
  if (
    pipeline.definition.kind === "argocd" &&
    pipeline.definition.scoutSite !== undefined &&
    !row.stages.some(
      (stage) =>
        stage.key === "scout-backend" &&
        stage.status === "succeeded" &&
        stage.operationId === deliveryOperationId(row.id),
    )
  )
    throw new DeliveryError(
      "CONFLICT",
      "Scout content recovery requires the exact completed worker/backend stage; unresolved routing must use worker recovery first",
    );
  const env = required(
    await tx.environment.findUnique({ where: { id: row.environmentId } }),
    "Content environment",
  );
  const locks = await tx.targetLock.findMany({
    where: { deploymentId: row.id },
  });
  const target = contentTarget(pipeline.definition);
  if (
    target === null ||
    !row.recoveryRequired ||
    !["failed", "canceled"].includes(row.status) ||
    env.activeDeploymentId !== row.id ||
    env.generation !== input.expectedEnvironmentGeneration ||
    !locks.some((held) => held.instance === target)
  )
    throw new DeliveryError(
      "CONFLICT",
      "Content recovery requires the exact failed release, environment generation and retained native target lock",
    );
  const snapshotFingerprint = fingerprint(
    wire({
      deploymentId: row.id,
      targetKind,
      environmentId: env.id,
      generation: env.generation,
      target,
      pipelineRevisionId: row.pipelineRevisionId,
      versionSetRevisionId: row.versionSetRevisionId,
      configurationId: row.configurationId,
      previousAcceptedVersionSetRevisionId:
        row.previousAcceptedVersionSetRevisionId,
      previousAcceptedDeploymentId: row.previousAcceptedDeploymentId,
      forumBaselineSnapshot: row.forumBaselineSnapshot,
      acceptedVersionSetRevisionId: env.acceptedVersionSetRevisionId,
      stages: row.stages.sort((a, b) => a.key.localeCompare(b.key)),
    }),
  );
  return { row, env, target, targetKind, snapshotFingerprint };
}

export function recordedContentWorkerJobs(detail: DeploymentDetail) {
  return detail.stages.flatMap((stage) => {
    const raw = nativeReceipt(stage.message);
    return typeof raw !== "object" ||
      raw === null ||
      !("namespace" in raw) ||
      raw.namespace !== "delivery-worker-jobs"
      ? []
      : [ContentRecoveryNativeReceiptSchema.shape.receipt.parse(raw)];
  });
}

export function contentSettlement(
  detail: Pick<
    DeploymentDetail,
    "pipeline" | "versionSet" | "forumRecoveredRuntime"
  > & {
    environment: { id: string };
    deployment: Pick<
      DeploymentDetail["deployment"],
      "id" | "configurationId" | "forumBaselineSnapshot"
    >;
  },
) {
  return fingerprint({
    targetKind: contentRecoveryKind(detail.pipeline.definition),
    deploymentId: detail.deployment.id,
    environmentId: detail.environment.id,
    versionSet: detail.versionSet,
    pipeline: detail.pipeline,
    configurationId: detail.deployment.configurationId,
    forumBaselineSnapshot: detail.deployment.forumBaselineSnapshot,
    forumRecoveredRuntime: detail.forumRecoveredRuntime,
  });
}

export function contentSettlements(
  detail: DeploymentDetail,
  prior: DeploymentDetail | null,
) {
  const current = detail.pipeline.definition;
  const target = contentTarget(current);
  const sameTarget =
    prior !== null &&
    target !== null &&
    contentTarget(prior.pipeline.definition) === target;
  const baseline = detail.deployment.forumBaselineSnapshot;
  return {
    desired: contentSettlement(detail),
    ...(prior !== null && sameTarget
      ? { prior: contentSettlement(prior) }
      : baseline !== null && contentRecoveryKind(current) === "forum"
        ? { prior: fingerprint({ targetKind: "forum-baseline", baseline }) }
        : {}),
  };
}
