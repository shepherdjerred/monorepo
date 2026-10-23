import { DeliveryError } from "#domain/error.ts";
import {
  PlatformReleaseSnapshotSchema,
  TofuPlanReceiptSchema,
  type DeploymentDetail,
} from "#shared/contract.ts";
import {
  PlatformRecoveryIntentSchema,
  type PlatformSettlementFingerprintsSchema,
} from "#shared/platform-recovery-contract.ts";
import type { RecoveryIntent } from "#generated/prisma/client.ts";
import {
  fingerprint,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import {
  intentDetail,
  legacyIntentFields,
} from "#infrastructure/recovery-intents.ts";
import {
  RETIRED_ROOT,
  nativeReceipt,
} from "#infrastructure/platform/policy.ts";
import { modelTofuSource } from "#infrastructure/platform/plans.ts";
import { RecipeDefinitionSchema } from "#shared/model/recipe-contract.ts";

// Root releases are retired (X6); none can be quarantined after the cutover.
export const platformRecoveryKinds = new Set([
  "tofu-plan",
  "tofu-apply",
  "upgrade-control-plane",
]);

/**
 * A model tofu deployment's stack and frozen stack archive build (X8), read
 * from its detail; null for a v1 platform snapshot and any other recipe.
 */
export function modelTofuTarget(detail: DeploymentDetail) {
  if (detail.deployment.platformSnapshot !== null) return null;
  const recipe = RecipeDefinitionSchema.safeParse(detail.pipeline.definition);
  if (recipe.data?.kind !== "tofu") return null;
  const archive = required(
    detail.versionSet.components[recipe.data.archiveComponent] ?? null,
    "Frozen stack archive",
  );
  return {
    stack: recipe.data.stack,
    sourceBuildId: archive.buildId,
    sourceRevision: archive.sourceRevision,
  };
}

/**
 * The OpenTofu stack and source a recovery plans and applies from: a v1
 * snapshot's, or a model tofu recipe's frozen stack archive. Null for the
 * control plane, which has no saved plan.
 */
export async function recoveryTofuSource(
  tx: Transaction,
  row: {
    platformSnapshot: unknown;
    pipelineRevisionId: string;
    versionSetRevisionId: string;
  },
) {
  if (row.platformSnapshot === null) return modelTofuSource(tx, row);
  const snapshot = PlatformReleaseSnapshotSchema.parse(row.platformSnapshot);
  if (snapshot.kind === "root-release")
    throw new DeliveryError("INVALID", RETIRED_ROOT);
  return {
    stack: snapshot.stack,
    sourceBuildId: snapshot.source.id,
    sourceRevision: snapshot.source.sourceRevision,
  };
}

/** The platform-kind view of a unified recovery intent row. */
export function platformIntentView(row: RecoveryIntent) {
  const detail = intentDetail(row);
  return PlatformRecoveryIntentSchema.parse(
    wire({
      ...legacyIntentFields(row),
      nativeReceipts: detail["nativeReceipts"] ?? [],
      planReceipt: detail["planReceipt"] ?? null,
      planFingerprint: detail["planFingerprint"] ?? null,
      planApproval: detail["planApproval"] ?? null,
    }),
  );
}

export async function heldPlatformRecovery(
  tx: Transaction,
  input: { deploymentId: string; expectedEnvironmentGeneration: number },
) {
  const row = required(
    await tx.deployment.findUnique({
      where: { id: input.deploymentId },
      include: { stages: true },
    }),
    "Quarantined infrastructure deployment",
  );
  // A model tofu recipe runs as an ordinary deployment with no v1 snapshot.
  const model =
    row.platformSnapshot === null && row.controlPlaneSnapshot === null
      ? await modelTofuSource(tx, row)
      : null;
  if (
    (model === null && !platformRecoveryKinds.has(row.kind)) ||
    !["failed", "canceled"].includes(row.status) ||
    !row.recoveryRequired
  )
    throw new DeliveryError(
      "CONFLICT",
      "Platform recovery requires a failed or canceled native infrastructure operation retaining ownership",
    );
  const env = await tx.environment.findUniqueOrThrow({
    where: { id: row.environmentId },
  });
  const target = await tx.targetLock.findFirst({
    where: { deploymentId: row.id },
    orderBy: { instance: "asc" },
  });
  const global = await tx.platformLock.findUnique({
    where: { deploymentId: row.id },
  });
  if (
    target === null ||
    env.activeDeploymentId !== row.id ||
    env.generation !== input.expectedEnvironmentGeneration ||
    (global === null && row.kind !== "tofu-plan")
  )
    throw new DeliveryError(
      "CONFLICT",
      "Recovery source lost its exact environment generation, native target or global ownership",
    );
  const snapshotFingerprint = fingerprint(
    wire({
      deploymentId: row.id,
      kind: row.kind,
      environmentId: env.id,
      generation: env.generation,
      pipelineRevisionId: row.pipelineRevisionId,
      configurationId: row.configurationId,
      platformSnapshot: row.platformSnapshot,
      controlPlaneSnapshot: row.controlPlaneSnapshot,
      ...(model === null
        ? {}
        : { versionSetRevisionId: row.versionSetRevisionId, source: model }),
      stages: row.stages.sort((a, b) => a.key.localeCompare(b.key)),
      target: target.instance,
      global: global?.id ?? null,
      acceptedDeploymentId: env.acceptedDeploymentId,
    }),
  );
  return { row, env, target, global, snapshotFingerprint };
}

function targetFingerprint(detail: DeploymentDetail) {
  const snapshot = detail.deployment.platformSnapshot;
  if (snapshot === null)
    throw new DeliveryError(
      "INVALID",
      "Recovery target lacks its frozen infrastructure snapshot",
    );
  if (snapshot.kind === "root-release")
    throw new DeliveryError("INVALID", RETIRED_ROOT);
  return fingerprint({
    kind: "tofu",
    source: snapshot.source,
    stack: snapshot.stack,
  });
}

export function platformSettlements(
  detail: DeploymentDetail,
  prior: DeploymentDetail | null,
): ReturnType<typeof PlatformSettlementFingerprintsSchema.parse> {
  const controller = detail.deployment.controlPlaneSnapshot;
  if (controller !== null)
    return {
      desired: fingerprint({
        kind: "control-plane",
        image: controller.nextArtifact,
        chart: controller.chartArtifact,
      }),
      prior: fingerprint({
        kind: "control-plane",
        image: controller.previousArtifact,
        chart: controller.priorChartArtifact,
      }),
    };
  // A model tofu recovery converges forward: the stack equals its frozen
  // archive with zero proposed changes, directly or after an exact recovery
  // plan is approved by stack policy and applied.
  const model = modelTofuTarget(detail);
  if (model !== null)
    return { desired: fingerprint({ kind: "tofu", ...model }) };
  const snapshot = PlatformReleaseSnapshotSchema.parse(
    detail.deployment.platformSnapshot,
  );
  if (snapshot.kind === "tofu-plan")
    return {
      readonly: fingerprint({
        kind: snapshot.kind,
        source: snapshot.source,
        stack: snapshot.stack,
      }),
    };
  if (snapshot.kind === "root-release")
    throw new DeliveryError("INVALID", RETIRED_ROOT);
  const matching = prior?.deployment.platformSnapshot;
  const hasPrior =
    matching?.kind === "tofu-apply" && matching.stack === snapshot.stack;
  return {
    desired: targetFingerprint(detail),
    ...(hasPrior && prior !== null ? { prior: targetFingerprint(prior) } : {}),
    ...(prior === null && snapshot.stack === "discord"
      ? {
          original: fingerprint({
            kind: "tofu-original-target",
            source: snapshot.source,
            stack: snapshot.stack,
            planDeploymentId: snapshot.planDeploymentId,
            plan: snapshot.plan,
          }),
        }
      : {}),
  };
}

export function recordedPlatformJobs(detail: DeploymentDetail) {
  return detail.stages.flatMap((stage) => {
    const parsed = TofuPlanReceiptSchema.shape.nativeJob.safeParse(
      nativeReceipt(stage.message),
    );
    return parsed.success ? [parsed.data] : [];
  });
}
