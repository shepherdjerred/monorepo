import { DeliveryError } from "#domain/error.ts";
import {
  PlatformReleaseSnapshotSchema,
  TofuPlanReceiptSchema,
  type FinishDeployment,
  type Principal,
} from "#shared/contract.ts";
import type { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import {
  PLATFORM_LOCK,
  audit,
  fingerprint,
  required,
  lock,
} from "#infrastructure/delivery-records.ts";
import {
  PlatformAcceptanceSchema,
  RETIRED_ROOT,
  nativeReceipt,
  platformPolicyFingerprint,
  requirePlatformOwner,
} from "./policy.ts";
import { requirePlatformPrerequisites } from "./prerequisites.ts";

type PlatformDeployment = {
  id: string;
  kind: string;
  platformSnapshot: unknown;
};

export async function holdPlatformLock(
  tx: Transaction,
  deploymentId: string,
  running: boolean,
) {
  const held = await tx.platformLock.findUnique({
    where: { id: PLATFORM_LOCK },
  });
  if (held !== null && held.deploymentId !== deploymentId)
    throw new DeliveryError(
      "BUSY",
      "Shared platform resources are owned by another state apply or shared-lock operation",
    );
  if (held === null && running)
    throw new DeliveryError(
      "CONFLICT",
      "Running platform operation lost its shared resource lock",
    );
  if (held === null)
    await tx.platformLock.create({
      data: { id: PLATFORM_LOCK, deploymentId },
    });
}

export async function admitPlatformDeployment(
  tx: Transaction,
  row: PlatformDeployment,
  catalog: ServiceIndex,
  options: { actor: Principal; running?: boolean },
) {
  if (row.platformSnapshot === null) return;
  const snapshot = PlatformReleaseSnapshotSchema.parse(row.platformSnapshot);
  if (snapshot.kind === "root-release")
    throw new DeliveryError("INVALID", RETIRED_ROOT);
  if (
    snapshot.kind !== row.kind ||
    snapshot.policyFingerprint !== platformPolicyFingerprint()
  )
    throw new DeliveryError(
      "CONFLICT",
      "Platform ownership policy or frozen operation changed; request a new deployment",
    );
  requirePlatformOwner(catalog, snapshot.kind);
  if (catalog.catalog.platformDeliveryDelegated === true)
    await requirePlatformPrerequisites(tx, snapshot);
  if (snapshot.kind !== "tofu-plan") {
    await holdPlatformLock(tx, row.id, options.running === true);
  }
  if (snapshot.kind === "tofu-apply") {
    const plan = required(
      await tx.platformPlan.findUnique({
        where: { deploymentId: snapshot.planDeploymentId },
      }),
      "Saved platform plan",
    );
    if (
      fingerprint(plan.receipt) !== fingerprint(snapshot.plan) ||
      Date.parse(snapshot.plan.expiresAt) <= Date.now()
    )
      throw new DeliveryError(
        "CONFLICT",
        "Frozen saved plan changed or expired before apply; prepare a new plan",
      );
    const claimed = await tx.platformPlan.updateMany({
      where: {
        deploymentId: snapshot.planDeploymentId,
        OR: [{ applyDeploymentId: null }, { applyDeploymentId: row.id }],
      },
      data: { applyDeploymentId: row.id },
    });
    if (claimed.count !== 1)
      throw new DeliveryError(
        "CONFLICT",
        "Saved plan has already been claimed by another apply",
      );
    await audit(tx, options.actor, {
      action: "platform.plan_claimed",
      entityId: row.id,
      requestId: snapshot.planDeploymentId,
      metadata: { planDigest: snapshot.plan.planDigest, stack: snapshot.stack },
    });
  }
}

export async function readmitPlatformDeployment(
  tx: Transaction,
  row: PlatformDeployment & {
    environmentId: string;
    expectedGeneration: number;
  },
  catalog: ServiceIndex,
  actor: Principal,
) {
  if (row.platformSnapshot === null) return;
  await lock(tx, `environment:${row.environmentId}`);
  const owned = await tx.environment.findUniqueOrThrow({
    where: { id: row.environmentId },
  });
  const held = await tx.targetLock.findFirst({
    where: { deploymentId: row.id },
  });
  // Only acceptance moves the generation (E1); ownership is checked directly.
  if (
    held === null ||
    owned.activeDeploymentId !== row.id ||
    owned.generation !== row.expectedGeneration
  )
    throw new DeliveryError(
      "CONFLICT",
      "Running platform deployment lost its stack ownership or generation",
    );
  await admitPlatformDeployment(tx, row, catalog, { actor, running: true });
}

export async function validatePlatformSuccess(
  tx: Transaction,
  row: PlatformDeployment,
  input: FinishDeployment,
) {
  if (row.platformSnapshot === null) return;
  if (input.observedRevisionId !== undefined)
    throw new DeliveryError(
      "INVALID",
      "Platform operations cannot report application VersionSet observation",
    );
  const snapshot = PlatformReleaseSnapshotSchema.parse(row.platformSnapshot);
  if (snapshot.kind === "root-release")
    throw new DeliveryError("INVALID", RETIRED_ROOT);
  const stage = await tx.stage.findUnique({
    where: { deploymentId_key: { deploymentId: row.id, key: snapshot.kind } },
  });
  const receipt = TofuPlanReceiptSchema.shape.nativeJob.safeParse(
    stage === null ? null : nativeReceipt(stage.message),
  );
  if (
    stage?.status !== "succeeded" ||
    !receipt.success ||
    receipt.data.requestId !== row.id ||
    stage.operationId !== receipt.data.name
  )
    throw new DeliveryError(
      "INVALID",
      "Platform success requires its exact completed native Job receipt",
    );
  let planDigest: string | undefined;
  if (snapshot.kind === "tofu-plan") {
    const plan = required(
      await tx.platformPlan.findUnique({ where: { deploymentId: row.id } }),
      "Recorded private saved plan",
    );
    const saved = TofuPlanReceiptSchema.parse(plan.receipt);
    if (fingerprint(saved.nativeJob) !== fingerprint(receipt.data))
      throw new DeliveryError(
        "INVALID",
        "Plan completion differs from the native producer identity",
      );
    planDigest = saved.planDigest;
  } else planDigest = snapshot.plan.planDigest;
  const evidence = await tx.evidence.findMany({
    where: {
      deploymentId: row.id,
      kind: "acceptance",
      operationId: receipt.data.uid,
    },
  });
  const accepted = evidence.some((entry) => {
    const parsed = PlatformAcceptanceSchema.safeParse(
      nativeReceipt(entry.summary),
    );
    return (
      entry.id.startsWith(`${row.id}/stage/${snapshot.kind}/`) &&
      parsed.success &&
      parsed.data.kind === snapshot.kind &&
      parsed.data.sourceBuildId === snapshot.source.id &&
      parsed.data.stack === snapshot.stack &&
      parsed.data.planDigest === planDigest
    );
  });
  if (!accepted)
    throw new DeliveryError(
      "INVALID",
      "Platform success lacks exact source, stack and saved-plan acceptance evidence",
    );
  if (snapshot.kind !== "tofu-plan") {
    const held = await tx.platformLock.findUnique({
      where: { id: PLATFORM_LOCK },
    });
    if (held?.deploymentId !== row.id)
      throw new DeliveryError(
        "CONFLICT",
        "Platform operation lost shared resource ownership before acceptance",
      );
  }
}
