import { beforeEach, expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { controlPlaneFixture } from "#testing/control-plane-fixture.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import { testNativeReceipt } from "#testing/platform-execution.ts";
import type { CompletePlatformRecovery } from "#shared/contract.ts";
import { CompletePlatformRecoverySchema } from "#shared/contract.ts";

const context = useDeliveryFixture();
let fixture: Awaited<ReturnType<typeof controlPlaneFixture>>;
beforeEach(async () => {
  fixture = await controlPlaneFixture(context.cluster.database);
});
async function quarantined() {
  const deployment = await fixture.delivery.requestControlPlaneUpgrade(
    fixture.environment.id,
    fixture.input,
    testOperator,
  );
  await fixture.delivery.claim(deployment.id, testExecutor);
  const native = testNativeReceipt(deployment.id);
  await fixture.delivery.stage(
    deployment.id,
    {
      key: "control-plane",
      status: "running",
      operationId: native.name,
      message: JSON.stringify(native),
      evidence: [],
    },
    testExecutor,
  );
  await fixture.delivery.finish(
    deployment.id,
    {
      status: "failed",
      message: "External write response lost",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  const detail = await fixture.delivery.detail(deployment.id);
  const request = {
    requestId: "controller/recovery/1",
    expectedEnvironmentGeneration: detail.environment.generation,
    reason:
      "Independently inspect settled controller after interrupted native effect",
  };
  const intent = await fixture.delivery.requestPlatformRecovery(
    deployment.id,
    request,
    testOperator,
  );
  return { deployment, native, request, intent };
}
async function proof(
  id: string,
  native: ReturnType<typeof testNativeReceipt>,
): Promise<CompletePlatformRecovery> {
  const detail = await fixture.delivery.platformRecovery(id, testOperator);
  if (detail.expectedSettlements.desired === undefined)
    throw new Error("Expected frozen desired controller target");
  return {
    expectedEnvironmentGeneration: detail.intent.expectedEnvironmentGeneration,
    snapshotFingerprint: detail.intent.snapshotFingerprint,
    observedAt: new Date().toISOString(),
    sourceWorkflow: {
      workflowId: `delivery/${detail.deployment.deployment.id}`,
      status: "FAILED",
    },
    nativeJobs: [{ ...native, status: "Complete", podsAbsent: false }],
    settlement: {
      state: "desired",
      fingerprint: detail.expectedSettlements.desired,
    },
    proofSummary:
      "Independent native source, terminal Job and ready exact image readback verified",
  };
}
test("independent recovery preserves failed result and accepts the observed desired source as the next controller prior", async () => {
  const { deployment, native, request, intent } = await quarantined();
  expect(
    await fixture.delivery.requestPlatformRecovery(
      deployment.id,
      request,
      testOperator,
    ),
  ).toEqual(intent);
  await expect(
    fixture.delivery.requestPlatformRecovery(
      deployment.id,
      { ...request, requestId: "publisher/recovery" },
      testPublisher,
    ),
  ).rejects.toThrow("admin");
  const input = await proof(intent.id, native);
  const recovered = await fixture.delivery.completePlatformRecovery(
    intent.id,
    input,
    testExecutor,
  );
  expect(recovered.status).toBe("succeeded");
  expect(
    await fixture.delivery.completePlatformRecovery(
      intent.id,
      input,
      testExecutor,
    ),
  ).toEqual(recovered);
  const after = await fixture.delivery.detail(deployment.id);
  expect(after.deployment.status).toBe("failed");
  expect(after.deployment.recoveryRequired).toBe(false);
  expect(after.environment.acceptedControlPlaneDeploymentId).toBeNull();
  expect(after.environment.acceptedVersionSetRevisionId).toBeNull();
  expect(await context.cluster.database.platformLock.count()).toBe(0);
  expect(await context.cluster.database.applicationLock.count()).toBe(0);
  const next = await fixture.delivery.requestControlPlaneUpgrade(
    fixture.environment.id,
    {
      ...fixture.input,
      requestId: "controller/after-recovery",
      expectedGeneration: after.environment.generation,
      previousImageArtifactId: fixture.next.artifactId,
      priorChartArtifactId: fixture.chart.artifactId,
    },
    testOperator,
  );
  expect(next.controlPlaneSnapshot?.previousArtifact.id).toBe(
    fixture.next.artifactId,
  );
  expect(next.controlPlaneSnapshot?.priorSelectionManaged).toBe(true);
  await fixture.delivery.claim(next.id, testExecutor);
});
test("stale proof, changed target, live source or replaced native identity cannot release quarantine", async () => {
  const { deployment, native, intent } = await quarantined(),
    input = await proof(intent.id, native);
  for (const changed of [
    { ...input, observedAt: new Date(Date.now() - 61_000).toISOString() },
    { ...input, snapshotFingerprint: "0".repeat(64) },
    {
      ...input,
      expectedEnvironmentGeneration: input.expectedEnvironmentGeneration + 1,
    },
    {
      ...input,
      nativeJobs: [{ ...input.nativeJobs[0], uid: crypto.randomUUID() }],
    },
    { ...input, settlement: { state: "desired", fingerprint: "0".repeat(64) } },
    {
      ...input,
      sourceWorkflow: { ...input.sourceWorkflow, status: "RUNNING" },
    },
  ])
    await expect(
      (async () =>
        fixture.delivery.completePlatformRecovery(
          intent.id,
          CompletePlatformRecoverySchema.parse(changed),
          testExecutor,
        ))(),
    ).rejects.toThrow();
  const quarantinedDetail = await fixture.delivery.detail(deployment.id);
  expect(quarantinedDetail.deployment.recoveryRequired).toBe(true);
  expect(await context.cluster.database.platformLock.count()).toBe(1);
});
test("all prior recovery attempts remain part of independent native settlement", async () => {
  const { deployment, native, intent } = await quarantined();
  const recoveryJob = {
    ...testNativeReceipt(intent.id),
    name: `delivery-${"d".repeat(40)}`,
  };
  await fixture.delivery.recordPlatformRecoveryNative(
    intent.id,
    { action: "inspect", receipt: recoveryJob },
    testExecutor,
  );
  await fixture.delivery.failPlatformRecovery(
    intent.id,
    "Independent inspection unavailable",
    testExecutor,
  );
  const next = await fixture.delivery.requestPlatformRecovery(
    deployment.id,
    {
      requestId: "controller/recovery/2",
      expectedEnvironmentGeneration: intent.expectedEnvironmentGeneration,
      reason:
        "Repeat independent inspection including every prior native action identity",
    },
    testOperator,
  );
  const input = await proof(next.id, native);
  await expect(
    fixture.delivery.completePlatformRecovery(next.id, input, testExecutor),
  ).rejects.toThrow("Every original");
  await fixture.delivery.completePlatformRecovery(
    next.id,
    {
      ...input,
      nativeJobs: [
        ...input.nativeJobs,
        { ...recoveryJob, status: "Failed", podsAbsent: false },
      ],
    },
    testExecutor,
  );
});
