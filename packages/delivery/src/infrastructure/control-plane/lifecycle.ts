import type { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import {
  ControlPlaneUpgradeSnapshotSchema,
  ControlPlaneAcceptanceSchema,
} from "#shared/contract.ts";
import { TofuPlanReceiptSchema } from "#shared/platform-contract.ts";
import {
  pendingDeliveryObservations,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import {
  PLATFORM_LOCK,
  applicationInstance,
  fingerprint,
  required,
} from "#infrastructure/delivery-records.ts";
import { DeliveryError } from "#domain/error.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";
import { holdPlatformLock } from "#infrastructure/platform/lifecycle.ts";
import { nativeReceipt } from "#infrastructure/platform/policy.ts";
import {
  controlPlaneEnvironment,
  requireControlPlaneOwner,
  previousControlPlane,
} from "./policy.ts";

type Operation = {
  id: string;
  kind: string;
  status: string;
  environmentId: string;
  expectedGeneration: number;
  controlPlaneSnapshot: unknown;
};

/** All callers hold the common delivery:claim transaction lock before this check. */
export async function requireControlPlaneQuiescence(
  tx: Transaction,
  row: Operation,
) {
  const held = await tx.platformLock.findUnique({
    where: { id: PLATFORM_LOCK },
    include: { deployment: true },
  });
  if (row.kind !== "upgrade-control-plane") {
    if (held?.deployment.kind === "upgrade-control-plane")
      throw new DeliveryError(
        "BUSY",
        "Independent control-plane upgrade or recovery holds the global execution barrier",
      );
    return;
  }
  const active = await tx.deployment.count({
    where: {
      id: { not: row.id },
      OR: [
        { status: { in: ["queued", "awaiting_approval", "running"] } },
        { recoveryRequired: true },
      ],
    },
  });
  const owned = await tx.environment.count({
    where: {
      activeDeploymentId: { not: null },
      NOT: { activeDeploymentId: row.id },
    },
  });
  if (
    active !== 0 ||
    owned !== 0 ||
    (await pendingDeliveryObservations(tx)) !== 0
  )
    throw new DeliveryError(
      "BUSY",
      "Waiting for all existing Delivery operations and recovery ownership to settle before controller replacement",
    );
}

export async function admitControlPlaneUpgrade(
  tx: Transaction,
  row: Operation,
  catalog: ServiceIndex,
) {
  if (row.kind !== "upgrade-control-plane") return;
  requireControlPlaneOwner(catalog);
  if (row.environmentId !== controlPlaneEnvironment)
    throw new DeliveryError(
      "INVALID",
      "Control-plane upgrade lost its fixed independent environment",
    );
  const snapshot = ControlPlaneUpgradeSnapshotSchema.parse(
    row.controlPlaneSnapshot,
  );
  const env = await tx.environment.findUniqueOrThrow({
    where: { id: row.environmentId },
  });
  const running = row.status === "running";
  // Only acceptance moves the generation (E1); ownership is checked directly.
  if (env.generation !== row.expectedGeneration)
    throw new DeliveryError(
      "CONFLICT",
      "Control-plane environment generation changed",
    );
  if (running) {
    const held = await tx.targetLock.findUnique({
      where: { instance: applicationInstance("delivery-control-plane") },
    });
    if (env.activeDeploymentId !== row.id || held?.deploymentId !== row.id)
      throw new DeliveryError(
        "CONFLICT",
        "Control-plane upgrade lost native Application ownership",
      );
  }
  const previous = await previousControlPlane(tx, {
    acceptedDeploymentId: env.acceptedDeploymentId,
    previousImageArtifactId: snapshot.previousArtifact.id,
    priorChartArtifactId: snapshot.priorChartArtifact.id,
    repositoryId: snapshot.source.repositoryId,
  });
  if (previous.priorSelectionManaged !== snapshot.priorSelectionManaged)
    throw new DeliveryError(
      "CONFLICT",
      "Controller source ownership changed before upgrade",
    );
  await holdPlatformLock(tx, row.id, running);
}

export async function validateControlPlaneSuccess(
  tx: Transaction,
  row: Operation,
) {
  if (row.kind !== "upgrade-control-plane") return;
  const snapshot = ControlPlaneUpgradeSnapshotSchema.parse(
    row.controlPlaneSnapshot,
  );
  const stage = await tx.stage.findUnique({
    where: { deploymentId_key: { deploymentId: row.id, key: "control-plane" } },
  });
  const native = TofuPlanReceiptSchema.shape.nativeJob.safeParse(
    stage === null ? null : nativeReceipt(stage.message),
  );
  if (
    stage?.status !== "succeeded" ||
    !native.success ||
    native.data.requestId !== row.id ||
    stage.operationId !== native.data.name
  )
    throw new DeliveryError(
      "INVALID",
      "Controller acceptance requires its exact completed independent native Job",
    );
  const expected = {
    adapter: "control-plane",
    previousArtifactId: snapshot.previousArtifact.id,
    nextArtifactId: snapshot.nextArtifact.id,
    chartArtifactId: snapshot.chartArtifact.id,
    nativeJobUID: native.data.uid,
    argoRequestId: deliveryOperationId(`${row.id}:control-plane`),
  };
  const evidence = await tx.evidence.findMany({
    where: {
      deploymentId: row.id,
      kind: "acceptance",
      operationId: native.data.uid,
    },
  });
  if (
    !evidence.some((entry) => {
      const parsed = ControlPlaneAcceptanceSchema.safeParse(
        nativeReceipt(entry.summary),
      );
      const bound = parsed.success
        ? Object.fromEntries(
            Object.entries(parsed.data).filter(
              ([key]) => key !== "argoOperationId",
            ),
          )
        : null;
      return (
        entry.id.startsWith(`${row.id}/stage/control-plane/`) &&
        parsed.success &&
        fingerprint(bound) === fingerprint(expected)
      );
    })
  )
    throw new DeliveryError(
      "INVALID",
      "Controller acceptance lacks exact original artifacts, native producer and owned Argo readback evidence",
    );
  const held = required(
    await tx.platformLock.findUnique({ where: { id: PLATFORM_LOCK } }),
    "Global controller execution barrier",
  );
  if (held.deploymentId !== row.id)
    throw new DeliveryError(
      "CONFLICT",
      "Controller operation lost global execution ownership",
    );
}
