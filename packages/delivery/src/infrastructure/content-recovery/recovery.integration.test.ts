import { beforeEach, expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import {
  contentRecoveryFixture,
  contentNativeReceipt,
  contentBarrier,
  contentObservation,
  contentRecoveryCatalog,
} from "#testing/content-recovery-fixture.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import { fingerprint } from "#infrastructure/delivery-records.ts";
import { pendingDeliveryObservations } from "#infrastructure/delivery-data.ts";
import { requireControlPlaneQuiescence } from "#infrastructure/control-plane/lifecycle.ts";
import { deliveryMetrics } from "#server/metrics.ts";

const scope = useDeliveryFixture({ catalog: contentRecoveryCatalog });
let fixture: Awaited<ReturnType<typeof contentRecoveryFixture>>;
beforeEach(async () => {
  fixture = await contentRecoveryFixture(scope.delivery);
});

async function checkpoint() {
  await scope.delivery.recordContentRecoveryBarrier(
    fixture.intent.id,
    contentBarrier,
    testExecutor,
  );
  return scope.delivery.contentRecovery(fixture.intent.id, testExecutor);
}
async function settlement() {
  const context = await checkpoint();
  return {
    ...contentObservation(context),
    settlement: {
      state: "desired" as const,
      fingerprint: context.expectedSettlements.desired,
    },
    proofSummary:
      "Independent exact archive bytes, original receipt and public entrypoints match",
  };
}

test("admin intent replays exact identity, rejects weaker principals and preserves original failure", async () => {
  expect(
    await scope.delivery.requestContentRecovery(
      fixture.failed.id,
      fixture.request,
      testOperator,
    ),
  ).toEqual(fixture.intent);
  for (const actor of [testExecutor, testPublisher])
    await expect(
      scope.delivery.requestContentRecovery(
        fixture.failed.id,
        { ...fixture.request, requestId: crypto.randomUUID() },
        actor,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    scope.delivery.requestContentRecovery(
      fixture.failed.id,
      {
        ...fixture.request,
        reason: "Different operation using same request identity",
      },
      testOperator,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const detail = await scope.delivery.detail(fixture.failed.id);
  expect(detail.deployment).toMatchObject({
    status: "failed",
    recoveryRequired: true,
  });
  expect(detail.environment.acceptedVersionSetRevisionId).toBe(
    fixture.accepted.versionSetRevisionId,
  );
  expect(detail.contentRecoveries.map((intent) => intent.id)).toEqual([
    fixture.intent.id,
  ]);
});

test("concurrent fresh requests create only one recovery owner and never acquire an orphan platform lock", async () => {
  await scope.delivery.failContentRecovery(
    fixture.intent.id,
    "No native work was admitted; inspect again",
    testExecutor,
  );
  const requests = await Promise.allSettled(
    [1, 2].map(() =>
      scope.delivery.requestContentRecovery(
        fixture.failed.id,
        { ...fixture.request, requestId: crypto.randomUUID() },
        testOperator,
      ),
    ),
  );
  expect(
    requests.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    await scope.cluster.database.contentRecoveryIntent.count({
      where: { status: "pending" },
    }),
  ).toBe(1);
  expect(await scope.cluster.database.platformLock.count()).toBe(0);
  expect(
    await scope.cluster.database.applicationLock.findUnique({
      where: { deploymentId: fixture.failed.id },
    }),
  ).not.toBeNull();
});

test("direct static recovery rejects foreign native Jobs and journals an immutable barrier before effects", async () => {
  const receipt = contentNativeReceipt(fixture.intent.id);
  await expect(
    scope.delivery.recordContentRecoveryNative(
      fixture.intent.id,
      { ...receipt, receipt: { ...receipt.receipt, uid: crypto.randomUUID() } },
      testExecutor,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    scope.delivery.recordContentRecoveryNative(
      fixture.intent.id,
      { ...receipt, receipt: { ...receipt.receipt, namespace: "storm-forum" } },
      testExecutor,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await scope.delivery.recordContentRecoveryBarrier(
    fixture.intent.id,
    contentBarrier,
    testExecutor,
  );
  await expect(
    scope.delivery.recordContentRecoveryBarrier(
      fixture.intent.id,
      { ...contentBarrier, deploymentUID: "replacement-host" },
      testExecutor,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    scope.delivery.requestContentRecovery(
      fixture.failed.id,
      { ...fixture.request, requestId: crypto.randomUUID() },
      testOperator,
    ),
  ).rejects.toMatchObject({ code: "BUSY" });
  const globalOwner =
    await scope.cluster.database.platformLock.findUniqueOrThrow({
      where: { id: "shared-resources" },
    });
  expect(globalOwner.deploymentId).toBe(fixture.failed.id);
});

test("settlement releases only exact target ownership, preserves failed result and blocks every new claim until host restoration", async () => {
  const original = await scope.delivery.detail(fixture.failed.id);
  const originalResult =
    await scope.cluster.database.deployment.findUniqueOrThrow({
      where: { id: fixture.failed.id },
    });
  const proof = await settlement();
  await scope.delivery.completeContentRecovery(
    fixture.intent.id,
    proof,
    testExecutor,
  );
  expect(
    await scope.delivery.completeContentRecovery(
      fixture.intent.id,
      proof,
      testExecutor,
    ),
  ).toMatchObject({ status: "succeeded", barrierRestoredAt: null });
  const after = await scope.delivery.detail(fixture.failed.id);
  expect(after.deployment).toMatchObject({
    status: "failed",
    message: original.deployment.message,
    recoveryRequired: false,
  });
  const retainedResult =
    await scope.cluster.database.deployment.findUniqueOrThrow({
      where: { id: fixture.failed.id },
    });
  expect(retainedResult.resultFingerprint).toBe(
    originalResult.resultFingerprint,
  );
  expect(after.environment).toMatchObject({
    activeDeploymentId: null,
    acceptedVersionSetRevisionId:
      original.environment.acceptedVersionSetRevisionId,
    observedVersionSetRevisionId:
      original.environment.observedVersionSetRevisionId,
    generation: original.environment.generation + 1,
  });
  expect(
    await scope.cluster.database.applicationLock.findUnique({
      where: { deploymentId: fixture.failed.id },
    }),
  ).toBeNull();
  const next = await scope.delivery.createDeployment(
    scope.input("barrier/next"),
    testOperator,
  );
  await expect(
    scope.delivery.claim(next.id, testExecutor),
  ).rejects.toMatchObject({ code: "BUSY" });
  expect(
    await scope.cluster.database.$transaction((tx) =>
      pendingDeliveryObservations(tx),
    ),
  ).toBe(1);
  expect(await deliveryMetrics(scope.cluster.database)).toContain(
    "delivery_independent_recoveries_pending 1\n",
  );
  await expect(
    scope.cluster.database.$transaction((tx) =>
      requireControlPlaneQuiescence(tx, {
        id: "other-controller",
        kind: "upgrade-control-plane",
        status: "queued",
        environmentId: "delivery-control-plane/prod",
        expectedGeneration: 0,
        controlPlaneSnapshot: null,
      }),
    ),
  ).rejects.toMatchObject({ code: "BUSY" });
  await scope.cluster.database.contentRecoveryIntent.update({
    where: { id: fixture.intent.id },
    data: { status: "failed" },
  });
  await expect(
    scope.delivery.claim(next.id, testExecutor),
  ).rejects.toMatchObject({ code: "BUSY" });
  expect(
    await scope.cluster.database.$transaction((tx) =>
      pendingDeliveryObservations(tx),
    ),
  ).toBe(1);
});

test("direct static repair admission needs no manufactured controller receipt and rejects unknown live writers", async () => {
  const context = await checkpoint();
  const proof = contentObservation(context);
  await scope.delivery.admitContentRecoveryRepair(
    fixture.intent.id,
    { ...proof, activeRepairJobUIDs: [] },
    testExecutor,
  );
  await expect(
    scope.delivery.admitContentRecoveryRepair(
      fixture.intent.id,
      { ...proof, activeRepairJobUIDs: [crypto.randomUUID()] },
      testExecutor,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

test("failed attempts retain the same retryable stopped-producer intent and quarantine", async () => {
  await checkpoint();
  const failed = await scope.delivery.failContentRecovery(
    fixture.intent.id,
    "Exact native state is still partial; retain and retry this same recovery",
    testExecutor,
  );
  expect(failed.status).toBe("pending");
  expect(failed.finishedAt).toBeNull();
  const detail = await scope.delivery.detail(fixture.failed.id);
  expect(detail.deployment.recoveryRequired).toBe(true);
  expect(await scope.cluster.database.platformLock.count()).toBe(1);
});

test("fresh generation and exact restored UID/template/ready Pod proof releases the final global fence", async () => {
  const proof = await settlement();
  await scope.delivery.completeContentRecovery(
    fixture.intent.id,
    proof,
    testExecutor,
  );
  const restore = {
    ...contentObservation(
      await scope.delivery.contentRecovery(fixture.intent.id, testExecutor),
    ),
    expectedEnvironmentGeneration: proof.expectedEnvironmentGeneration + 1,
  };
  await scope.delivery.admitContentRecoveryRestore(
    fixture.intent.id,
    restore,
    testExecutor,
  );
  const readback = {
    expectedEnvironmentGeneration: restore.expectedEnvironmentGeneration,
    snapshotFingerprint: restore.snapshotFingerprint,
    observedAt: new Date().toISOString(),
    journalFingerprint: fingerprint(contentBarrier),
    deploymentUID: contentBarrier.deploymentUID,
    templateFingerprint: contentBarrier.templateFingerprint,
    replicas: 1 as const,
    readyPodUIDs: ["new-ready-activity-pod"],
  };
  await expect(
    scope.delivery.restoredContentRecovery(
      fixture.intent.id,
      {
        ...readback,
        expectedEnvironmentGeneration: proof.expectedEnvironmentGeneration,
      },
      testExecutor,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    scope.delivery.restoredContentRecovery(
      fixture.intent.id,
      { ...readback, readyPodUIDs: contentBarrier.podUIDs },
      testExecutor,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await scope.delivery.restoredContentRecovery(
    fixture.intent.id,
    readback,
    testExecutor,
  );
  expect(await scope.cluster.database.platformLock.count()).toBe(0);
  expect(
    await scope.cluster.database.$transaction((tx) =>
      pendingDeliveryObservations(tx),
    ),
  ).toBe(0);
  const next = await scope.delivery.createDeployment(
    scope.input("restored/next"),
    testOperator,
  );
  await scope.delivery.claim(next.id, testExecutor);
});

test("stale, foreign, missing and mutated native observations retain all ownership", async () => {
  const proof = await settlement();
  for (const variant of [
    { ...proof, observedAt: new Date(Date.now() - 61_000).toISOString() },
    { ...proof, snapshotFingerprint: "f".repeat(64) },
    {
      ...proof,
      sourceWorkflow: {
        ...proof.sourceWorkflow,
        workflowId: "delivery/foreign",
      },
    },
    {
      ...proof,
      settlement: { ...proof.settlement, fingerprint: "f".repeat(64) },
    },
  ])
    await expect(
      scope.delivery.completeContentRecovery(
        fixture.intent.id,
        variant,
        testExecutor,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  const detail = await scope.delivery.detail(fixture.failed.id);
  expect(detail.deployment.recoveryRequired).toBe(true);
  expect(
    await scope.cluster.database.applicationLock.count({
      where: { deploymentId: fixture.failed.id },
    }),
  ).toBe(1);
  expect(await scope.cluster.database.platformLock.count()).toBe(1);
});
