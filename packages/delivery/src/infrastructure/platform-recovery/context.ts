import { DeliveryError } from "#domain/error.ts";
import {
  PlatformReleaseSnapshotSchema,
  TofuPlanReceiptSchema,
  type DeploymentDetail,
} from "#shared/contract.ts";
import type { PlatformSettlementFingerprintsSchema } from "#shared/platform-recovery-contract.ts";
import {
  fingerprint,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import { nativeReceipt } from "#infrastructure/platform/policy.ts";

export const platformRecoveryKinds = new Set([
  "root-release",
  "tofu-plan",
  "tofu-apply",
  "upgrade-control-plane",
]);

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
  const target = await tx.applicationLock.findUnique({
    where: { deploymentId: row.id },
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
      configurationRevision: row.configurationRevision,
      configuration: row.configuration,
      platformSnapshot: row.platformSnapshot,
      controlPlaneSnapshot: row.controlPlaneSnapshot,
      stages: row.stages.sort((a, b) => a.key.localeCompare(b.key)),
      target: target.application,
      global: global?.id ?? null,
      acceptedPlatformDeploymentId: env.acceptedPlatformDeploymentId,
      acceptedControlPlaneDeploymentId: env.acceptedControlPlaneDeploymentId,
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
  return snapshot.kind === "root-release"
    ? fingerprint({
        kind: snapshot.kind,
        source: snapshot.source,
        charts: snapshot.charts,
        siteArtifacts: snapshot.siteArtifacts,
      })
    : fingerprint({
        kind: "tofu",
        source: snapshot.source,
        stack: snapshot.stack,
      });
}

export function stoppedRootPriorMatches(
  detail: DeploymentDetail,
  prior: DeploymentDetail | null,
) {
  if (detail.deployment.platformSnapshot?.kind !== "root-release") return false;
  return prior === null
    ? detail.environment.acceptedPlatformDeploymentId === null
    : prior.deployment.platformSnapshot?.kind === "root-release" &&
        prior.deployment.status === "succeeded" &&
        prior.deployment.id !== detail.deployment.id &&
        prior.deployment.id === detail.environment.acceptedPlatformDeploymentId;
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
  const matching = prior?.deployment.platformSnapshot;
  const hasPrior =
    matching !== null &&
    matching !== undefined &&
    (snapshot.kind === "root-release"
      ? matching.kind === "root-release"
      : matching.kind === "tofu-apply" && matching.stack === snapshot.stack);
  const stoppedRoot = stoppedRootPriorMatches(detail, prior);
  return {
    desired: targetFingerprint(detail),
    ...(hasPrior && prior !== null ? { prior: targetFingerprint(prior) } : {}),
    ...(stoppedRoot
      ? {
          stopped: fingerprint({
            kind:
              prior === null ? "stopped-first-root" : "stopped-root-attempt",
            deploymentId: detail.deployment.id,
            target: targetFingerprint(detail),
            ...(prior === null
              ? {}
              : {
                  prior: {
                    deploymentId: prior.deployment.id,
                    target: targetFingerprint(prior),
                  },
                }),
          }),
        }
      : {}),
    ...(prior === null &&
    snapshot.kind === "tofu-apply" &&
    snapshot.stack === "discord"
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
