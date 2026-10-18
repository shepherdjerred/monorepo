import type { Delivery } from "#infrastructure/delivery.ts";
import {
  TofuPlanReceiptSchema,
  type Deployment,
  type RecordTofuPlan,
} from "#shared/contract.ts";
import { testExecutor, testOperator } from "./seed.ts";

/** Native Job results are injected here; all admission, evidence and acceptance use real PostgreSQL operations. */
export async function requestTestPlan(
  delivery: Delivery,
  sourceBuildId: string,
  stack = "github",
  requestId = crypto.randomUUID(),
) {
  const environment = await delivery.database.environment.findUniqueOrThrow({
    where: { id: `gitops/tofu:${stack}` },
  });
  return delivery.createPlatformDeployment(
    {
      kind: "tofu-plan",
      environmentId: environment.id,
      expectedGeneration: environment.generation,
      sourceBuildId,
      requestId,
    },
    testOperator,
  );
}

export function testNativeReceipt(deploymentId: string) {
  return {
    namespace: "delivery-platform-jobs" as const,
    name: `delivery-${"a".repeat(40)}`,
    uid: crypto.randomUUID(),
    specFingerprint: "b".repeat(64),
    requestId: deploymentId,
  };
}

export async function checkpointTestPlan(
  delivery: Delivery,
  deployment: Deployment,
  ciphertextBytes = 64,
): Promise<RecordTofuPlan> {
  const detail = await delivery.claim(deployment.id, testExecutor);
  const snapshot = detail.deployment.platformSnapshot;
  if (snapshot?.kind !== "tofu-plan") throw new Error("Expected frozen plan");
  const nativeJob = testNativeReceipt(deployment.id);
  await delivery.stage(
    deployment.id,
    {
      key: snapshot.kind,
      status: "running",
      operationId: nativeJob.name,
      message: JSON.stringify(nativeJob),
      evidence: [],
    },
    testExecutor,
  );
  const receipt = TofuPlanReceiptSchema.parse({
    schema: "delivery-tofu-plan/v1",
    deploymentId: deployment.id,
    sourceBuildId: snapshot.source.id,
    sourceRevision: snapshot.source.sourceRevision,
    stack: snapshot.stack,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    planDigest: `sha256:${"c".repeat(64)}`,
    state: { lineage: "disposable-state", serial: 7 },
    nativeJob,
    changes: { create: 1, update: 2, delete: 0, replace: 0 },
  });
  return {
    receipt,
    encryptedPlan: {
      algorithm: "aes-256-gcm",
      salt: Buffer.alloc(16, 1).toString("base64"),
      iv: Buffer.alloc(12, 2).toString("base64"),
      tag: Buffer.alloc(16, 3).toString("base64"),
      ciphertext: Buffer.alloc(ciphertextBytes, 4).toString("base64"),
    },
  };
}

export async function finishTestPlatform(
  delivery: Delivery,
  deployment: Deployment,
  saved?: RecordTofuPlan,
) {
  const detail = await delivery.detail(deployment.id);
  const snapshot = detail.deployment.platformSnapshot;
  if (snapshot === null) throw new Error("Expected frozen platform operation");
  const nativeJob =
    saved?.receipt.nativeJob ?? testNativeReceipt(deployment.id);
  const summary = {
    adapter: "platform",
    kind: snapshot.kind,
    sourceBuildId: snapshot.source.id,
    ...(snapshot.kind === "root-release" ? {} : { stack: snapshot.stack }),
    ...(snapshot.kind === "tofu-plan"
      ? { planDigest: saved?.receipt.planDigest }
      : snapshot.kind === "tofu-apply"
        ? { planDigest: snapshot.plan.planDigest }
        : {}),
  };
  const evidence = [
    {
      kind: "reconciliation" as const,
      summary: "Native result bound to exact operation",
    },
    {
      kind: "acceptance" as const,
      operationId: nativeJob.uid,
      summary: JSON.stringify(summary),
    },
  ];
  if (snapshot.kind === "tofu-plan") {
    if (saved === undefined) throw new Error("Saved plan required");
    await delivery.recordTofuPlan(saved, testExecutor);
  }
  await delivery.stage(
    deployment.id,
    {
      key: snapshot.kind,
      status: "succeeded",
      operationId: nativeJob.name,
      message: JSON.stringify(nativeJob),
      evidence,
    },
    testExecutor,
  );
  return delivery.finish(
    deployment.id,
    {
      status: "succeeded",
      message: "Exact native result accepted",
      recoveryRequired: false,
      evidence,
    },
    testExecutor,
  );
}

export async function testApply(delivery: Delivery, plan: Deployment) {
  const env = await delivery.database.environment.findUniqueOrThrow({
    where: { id: plan.environmentId },
  });
  return delivery.createPlatformDeployment(
    {
      kind: "tofu-apply",
      requestId: crypto.randomUUID(),
      environmentId: env.id,
      expectedGeneration: env.generation,
      planDeploymentId: plan.id,
    },
    testOperator,
  );
}
