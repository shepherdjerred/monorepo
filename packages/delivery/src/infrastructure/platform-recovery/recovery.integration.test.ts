import { beforeEach, expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { controlPlaneFixture } from "#testing/control-plane-fixture.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import { testNativeReceipt } from "#testing/platform-execution.ts";
import type { CompletePlatformRecovery } from "#shared/contract.ts";
import { CompletePlatformRecoverySchema } from "#shared/contract.ts";
import { platformFixture } from "#testing/platform-fixture.ts";
import {
  checkpointTestPlan,
  finishTestPlatform,
  requestTestPlan,
  testApply,
} from "#testing/platform-execution.ts";
import { platformSettlements } from "./context.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";

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

test("first Discord apply may settle its authenticated original target without accepting it or inventing a prior", async () => {
  const platform = await platformFixture(context.cluster.database);
  const delivery = platform.delivery;
  const plan = await requestTestPlan(
    delivery,
    platform.sourceBuildId,
    "discord",
  );
  const saved = await checkpointTestPlan(delivery, plan);
  await finishTestPlatform(delivery, plan, saved);
  const apply = await testApply(delivery, plan);
  await delivery.approve(
    apply.id,
    "approve",
    "Reviewed exact original Discord plan",
    testOperator,
  );
  await delivery.claim(apply.id, testExecutor);
  const native = testNativeReceipt(apply.id);
  await delivery.stage(
    apply.id,
    {
      key: "tofu-apply",
      status: "running",
      operationId: native.name,
      message: JSON.stringify(native),
      evidence: [],
    },
    testExecutor,
  );
  await delivery.finish(
    apply.id,
    {
      status: "failed",
      message: "Private application rejects the original desired URL",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  const failed = await delivery.detail(apply.id);
  const intent = await delivery.requestPlatformRecovery(
    apply.id,
    {
      requestId: "discord/original/recovery",
      expectedEnvironmentGeneration: failed.environment.generation,
      reason:
        "Independently prove original target after failed first Discord apply",
    },
    testOperator,
  );
  const current = await delivery.platformRecovery(intent.id, testOperator);
  const fingerprint = current.expectedSettlements.original;
  if (fingerprint === undefined)
    throw new Error("Expected original Discord target");
  expect(current.expectedSettlements.prior).toBeUndefined();
  expect(
    platformSettlements(current.deployment, current.deployment).original,
  ).toBeUndefined();
  const changed = structuredClone(current.deployment);
  const snapshot = changed.deployment.platformSnapshot;
  if (snapshot?.kind !== "tofu-apply")
    throw new Error("Expected frozen apply plan");
  snapshot.plan.planDigest = `sha256:${"f".repeat(64)}`;
  expect(platformSettlements(changed, null).original).not.toBe(fingerprint);
  snapshot.stack = "github";
  expect(platformSettlements(changed, null).original).toBeUndefined();
  const input = CompletePlatformRecoverySchema.parse({
    expectedEnvironmentGeneration: current.intent.expectedEnvironmentGeneration,
    snapshotFingerprint: current.intent.snapshotFingerprint,
    observedAt: new Date().toISOString(),
    sourceWorkflow: { workflowId: `delivery/${apply.id}`, status: "FAILED" },
    nativeJobs: [{ ...native, status: "Failed", podsAbsent: false }],
    settlement: { state: "original", fingerprint },
    proofSummary:
      "Authenticated original target matches six managed and six independent native application baselines; original serial 1 and stable current serial 2",
  });
  await expect(
    delivery.completePlatformRecovery(
      intent.id,
      {
        ...input,
        settlement: { state: "original", fingerprint: "0".repeat(64) },
      },
      testExecutor,
    ),
  ).rejects.toThrow();
  const completed = await delivery.completePlatformRecovery(
    intent.id,
    input,
    testExecutor,
  );
  expect(completed.status).toBe("succeeded");
  const after = await delivery.detail(apply.id);
  expect(after.deployment.status).toBe("failed");
  expect(after.deployment.recoveryRequired).toBe(false);
  expect(after.environment.acceptedPlatformDeploymentId).toBeNull();
  expect(after.environment.acceptedVersionSetRevisionId).toBeNull();
  expect(await context.cluster.database.platformLock.count()).toBe(0);
});

test("stopped first-root settlement preserves failure and partial state, releases exact ownership and admits a forward request", async () => {
  const platform = await platformFixture(context.cluster.database, true, true);
  const delivery = platform.delivery;
  for (const stack of ["seaweedfs", "tailscale", "arr"]) {
    const plan = await requestTestPlan(delivery, platform.sourceBuildId, stack);
    await finishTestPlatform(
      delivery,
      plan,
      await checkpointTestPlan(delivery, plan),
    );
    const apply = await testApply(delivery, plan);
    await delivery.claim(apply.id, testExecutor);
    await finishTestPlatform(delivery, apply);
  }
  const root = await delivery.createPlatformDeployment(
    {
      kind: "root-release",
      requestId: "first/root",
      environmentId: "gitops/root",
      expectedGeneration: 0,
      sourceBuildId: platform.sourceBuildId,
    },
    testOperator,
  );
  await delivery.claim(root.id, testExecutor);
  const native = testNativeReceipt(root.id);
  await delivery.stage(
    root.id,
    {
      key: "root-release",
      status: "running",
      operationId: native.name,
      message: JSON.stringify(native),
      evidence: [],
    },
    testExecutor,
  );
  await delivery.finish(
    root.id,
    {
      status: "failed",
      message: "Partial root applied, child readiness failed",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  const failed = await delivery.detail(root.id);
  const intent = await delivery.requestPlatformRecovery(
    root.id,
    {
      requestId: "first/root/stopped",
      expectedEnvironmentGeneration: failed.environment.generation,
      reason:
        "Inspect terminal first root and preserve its partial native inventory",
    },
    testOperator,
  );
  const current = await delivery.platformRecovery(intent.id, testOperator);
  const fingerprint = current.expectedSettlements.stopped;
  if (fingerprint === undefined)
    throw new Error("Expected stopped first-root settlement");
  expect(current.expectedSettlements.prior).toBeUndefined();
  expect(
    platformSettlements(current.deployment, current.deployment).stopped,
  ).toBeUndefined();
  const input = CompletePlatformRecoverySchema.parse({
    expectedEnvironmentGeneration: current.intent.expectedEnvironmentGeneration,
    snapshotFingerprint: current.intent.snapshotFingerprint,
    observedAt: new Date().toISOString(),
    sourceWorkflow: { workflowId: `delivery/${root.id}`, status: "FAILED" },
    nativeJobs: [{ ...native, status: "Failed", podsAbsent: false }],
    settlement: { state: "stopped", fingerprint },
    proofSummary:
      "Exact terminal original root and stable frozen child ownership; current partial state retained without root acceptance",
    stoppedRoot: {
      requestId: deliveryOperationId(`${root.id}:root-release`),
      operationId: crypto.randomUUID(),
      revision: "2.0.0-900",
      applications: ["apps", "argocd"].map((name) => ({
        name,
        uid: crypto.randomUUID(),
        sourceFingerprint: "a".repeat(64),
        specFingerprint: "b".repeat(64),
        lifecycleFingerprint: "c".repeat(64),
        targetRevision: "~2.0.0-0",
        syncStatus: "OutOfSync",
        observedRevision: "2.0.0-901",
        health: "Progressing",
        operationPhase: "Failed",
      })),
    },
  });
  const report = input.stoppedRoot;
  if (report === undefined) throw new Error("Expected stopped root report");
  for (const bad of [
    {
      ...input,
      settlement: { state: "stopped" as const, fingerprint: "0".repeat(64) },
    },
    { ...input, stoppedRoot: undefined },
    {
      ...input,
      stoppedRoot: {
        ...report,
        applications: report.applications.filter(({ name }) => name === "apps"),
      },
    },
    {
      ...input,
      stoppedRoot: { ...report, requestId: crypto.randomUUID() },
    },
    {
      ...input,
      nativeJobs: [{ ...native, status: "Deleted" as const, podsAbsent: true }],
    },
    {
      ...input,
      expectedEnvironmentGeneration: input.expectedEnvironmentGeneration + 1,
    },
  ])
    await expect(
      delivery.completePlatformRecovery(intent.id, bad, testExecutor),
    ).rejects.toThrow();
  await delivery.completePlatformRecovery(intent.id, input, testExecutor);
  const after = await delivery.detail(root.id);
  expect(after.deployment).toEqual({
    ...current.deployment.deployment,
    recoveryRequired: false,
  });
  expect(after.stages).toEqual(failed.stages);
  expect(after.environment.acceptedPlatformDeploymentId).toBeNull();
  expect(after.environment.acceptedVersionSetRevisionId).toBeNull();
  expect(after.environment.activeDeploymentId).toBeNull();
  expect(await context.cluster.database.platformLock.count()).toBe(0);
  expect(await context.cluster.database.applicationLock.count()).toBe(0);
  const next = await delivery.createPlatformDeployment(
    {
      kind: "root-release",
      requestId: "first/root/forward",
      environmentId: "gitops/root",
      expectedGeneration: after.environment.generation,
      sourceBuildId: platform.sourceBuildId,
    },
    testOperator,
  );
  await delivery.claim(next.id, testExecutor);
  const nextDetail = await delivery.detail(next.id);
  expect(nextDetail.environment.activeDeploymentId).toBe(next.id);
});
