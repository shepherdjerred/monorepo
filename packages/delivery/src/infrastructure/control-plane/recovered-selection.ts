import { z } from "zod";
import {
  CompletePlatformRecoverySchema,
  ControlPlaneUpgradeSnapshotSchema,
} from "#shared/contract.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import { required } from "#infrastructure/delivery-records.ts";
import { DeliveryError } from "#domain/error.ts";

/** Settlement observes actual source without converting a failed upgrade into acceptance. */
export async function recoveredControllerSelection(
  tx: Transaction,
  acceptedAt: Date | null,
) {
  const recovery = await tx.recoveryIntent.findFirst({
    where: {
      kind: "platform",
      status: "succeeded",
      deployment: {
        environmentId: "delivery-control-plane/prod",
        kind: "upgrade-control-plane",
      },
      ...(acceptedAt === null ? {} : { finishedAt: { gt: acceptedAt } }),
    },
    include: { deployment: true },
    orderBy: { finishedAt: "desc" },
  });
  if (recovery === null) return null;
  const audit = required(
    await tx.audit.findFirst({
      where: { entityId: recovery.id, action: "platform.recovery_completed" },
    }),
    "Controller recovery proof",
  );
  const proof = z
    .object({ proof: CompletePlatformRecoverySchema })
    .parse(audit.metadata).proof;
  const snapshot = ControlPlaneUpgradeSnapshotSchema.parse(
    recovery.deployment.controlPlaneSnapshot,
  );
  if (proof.settlement.state === "readonly")
    throw new DeliveryError(
      "CONFLICT",
      "Controller recovery cannot settle a read-only infrastructure target",
    );
  return proof.settlement.state === "desired"
    ? {
        previousArtifact: snapshot.nextArtifact,
        priorChartArtifact: snapshot.chartArtifact,
        priorSelectionManaged: true,
      }
    : {
        previousArtifact: snapshot.previousArtifact,
        priorChartArtifact: snapshot.priorChartArtifact,
        priorSelectionManaged: snapshot.priorSelectionManaged,
      };
}
