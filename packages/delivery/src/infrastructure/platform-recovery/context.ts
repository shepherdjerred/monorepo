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

// Root releases are retired (X6); none can be quarantined after the cutover.
export const platformRecoveryKinds = new Set([
  "tofu-plan",
  "tofu-apply",
  "upgrade-control-plane",
]);

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
  if (
    !platformRecoveryKinds.has(row.kind) ||
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
