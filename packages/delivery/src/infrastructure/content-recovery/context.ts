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
  type PipelineDefinition,
  ContentRecoveryNativeReceiptSchema,
} from "#shared/contract.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";
import { nativeReceipt } from "#infrastructure/platform/policy.ts";

export function contentRecoveryKind(pipeline: PipelineDefinition) {
  if (pipeline.kind === "static-site") return "static-site";
  if (pipeline.kind === "argocd") {
    if (pipeline.scoutSite !== undefined) return "static-site";
    if (pipeline.forumRelease !== undefined) return "forum";
  }
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
  const target = await tx.applicationLock.findUnique({
    where: { deploymentId: row.id },
  });
  if (target === null)
    throw new DeliveryError(
      "CONFLICT",
      "Content recovery requires the retained native target lock",
    );
  const targetName =
    pipeline.definition.kind === "static-site"
      ? `static-site:${pipeline.definition.bucket}`
      : pipeline.definition.kind === "argocd"
        ? pipeline.definition.application
        : null;
  if (
    !["failed", "canceled"].includes(row.status) ||
    !row.recoveryRequired ||
    env.activeDeploymentId !== row.id ||
    env.generation !== input.expectedEnvironmentGeneration ||
    target.application !== targetName
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
      target: target.application,
      pipelineRevisionId: row.pipelineRevisionId,
      versionSetRevisionId: row.versionSetRevisionId,
      configurationRevision: row.configurationRevision,
      configuration: row.configuration,
      previousAcceptedVersionSetRevisionId:
        row.previousAcceptedVersionSetRevisionId,
      previousAcceptedConfiguration: row.previousAcceptedConfiguration,
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
      "id" | "configuration" | "forumBaselineSnapshot"
    >;
  },
) {
  return fingerprint({
    targetKind: contentRecoveryKind(detail.pipeline.definition),
    deploymentId: detail.deployment.id,
    environmentId: detail.environment.id,
    versionSet: detail.versionSet,
    pipeline: detail.pipeline,
    configuration: detail.deployment.configuration,
    forumBaselineSnapshot: detail.deployment.forumBaselineSnapshot,
    forumRecoveredRuntime: detail.forumRecoveredRuntime,
  });
}

export function contentSettlements(
  detail: DeploymentDetail,
  prior: DeploymentDetail | null,
) {
  const current = detail.pipeline.definition;
  const before = prior?.pipeline.definition;
  const sameTarget =
    current.kind === "static-site"
      ? before?.kind === "static-site" && current.bucket === before.bucket
      : current.kind === "argocd" &&
        before?.kind === "argocd" &&
        current.application === before.application;
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
