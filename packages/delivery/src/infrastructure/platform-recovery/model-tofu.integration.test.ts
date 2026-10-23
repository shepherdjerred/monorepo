import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import {
  requestStackDeployment,
  savedStackPlan,
  stackPlanJob,
  startStackPlan,
} from "#testing/tofu-stack-fixture.ts";

const context = useDeliveryFixture();

/** A model tofu deployment whose plan Job result was lost: failed, recovery-required, locks held. */
async function quarantinedStack() {
  const { deployment, buildId } = await requestStackDeployment(context);
  await startStackPlan(context, deployment.id);
  await context.delivery.finish(
    deployment.id,
    {
      status: "failed",
      message: "Lost the plan Job's result",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  const detail = await context.delivery.detail(deployment.id);
  const intent = await context.delivery.requestRecoveryIntent(
    deployment.id,
    {
      requestId: "stack/recovery/1",
      reason: "Inspect the stack after its plan Job's result was lost",
      expectedGeneration: detail.environment.generation,
    },
    testOperator,
  );
  return { deployment, buildId, intent };
}

/** The recovery plan Job a platform recovery records before saving its plan. */
const recoveryJob = {
  namespace: "delivery-platform-jobs" as const,
  name: `delivery-${"8".repeat(40)}`,
  uid: "44444444-4444-4444-8444-444444444444",
  specFingerprint: "e".repeat(64),
  requestId: "stack/recovery/1",
};

/** A recovery plan of the stack, saved by the recovery's own plan Job. */
function recoveryPlan(sourceBuildId: string) {
  const { receipt, encryptedPlan } = savedStackPlan(
    "stack/recovery/1",
    sourceBuildId,
  );
  const { deploymentId: _deploymentId, ...fields } = receipt;
  return {
    receipt: {
      ...fields,
      schema: "delivery-tofu-recovery-plan/v1" as const,
      recoveryIntentId: "stack/recovery/1",
      nativeJob: recoveryJob,
    },
    encryptedPlan,
  };
}

test("an intent asked for as argo opens nothing for a platform recovery", async () => {
  const { deployment } = await requestStackDeployment(context);
  await startStackPlan(context, deployment.id);
  await context.delivery.finish(
    deployment.id,
    {
      status: "failed",
      message: "Lost the plan Job's result",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  const detail = await context.delivery.detail(deployment.id);
  await expect(
    context.delivery.requestRecoveryIntent(
      deployment.id,
      {
        requestId: "stack/recovery/argo",
        reason: "Settle what looks like an ordinary Argo operation",
        expectedGeneration: detail.environment.generation,
        expectedKind: "argo",
      },
      testOperator,
    ),
  ).rejects.toMatchObject({
    code: "INVALID",
    message: expect.stringMatching(/platform intent, not argo/u),
  });
  expect(
    await context.cluster.database.recoveryIntent.count({
      where: { deploymentId: deployment.id },
    }),
  ).toBe(0);
});

test("a failed model tofu deployment settles through platform recovery at its frozen stack source", async () => {
  const { deployment, intent } = await quarantinedStack();
  // It has no Application, so platform recovery reads it, not Argo.
  expect(intent.kind).toBe("platform");
  const recovery = await context.delivery.platformRecovery(
    intent.id,
    testOperator,
  );
  const desired = recovery.expectedSettlements.desired;
  if (desired === undefined) throw new Error("Expected a desired settlement");
  // Recovery converges forward: no read-only or prior settlement exists.
  expect(Object.keys(recovery.expectedSettlements)).toEqual(["desired"]);
  const proof = {
    expectedEnvironmentGeneration:
      recovery.intent.expectedEnvironmentGeneration,
    snapshotFingerprint: recovery.intent.snapshotFingerprint,
    observedAt: new Date().toISOString(),
    sourceWorkflow: {
      workflowId: `delivery/${deployment.id}`,
      status: "FAILED" as const,
    },
    nativeJobs: [
      {
        ...stackPlanJob,
        requestId: deployment.id,
        status: "Complete" as const,
        podsAbsent: false,
      },
    ],
    settlement: { state: "desired" as const, fingerprint: desired },
    proofSummary:
      "Independent fixed-source OpenTofu cloudflare observation with zero proposed changes",
  };
  // The recorded plan Job must be independently settled first.
  await expect(
    context.delivery.completePlatformRecovery(
      intent.id,
      { ...proof, nativeJobs: [] },
      testExecutor,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await context.cluster.database.platformLock.count()).toBe(1);
  await context.delivery.completePlatformRecovery(
    intent.id,
    proof,
    testExecutor,
  );
  const after = await context.delivery.detail(deployment.id);
  expect(after.deployment).toMatchObject({
    status: "failed",
    recoveryRequired: false,
  });
  expect(after.environment.activeDeploymentId).toBeNull();
  expect(await context.cluster.database.platformLock.count()).toBe(0);
  expect(
    await context.cluster.database.targetLock.count({
      where: { deploymentId: deployment.id },
    }),
  ).toBe(0);
});

test("a model tofu recovery plan binds the frozen stack archive and follows the stack's policy", async () => {
  const { buildId, intent } = await quarantinedStack();
  await context.delivery.recordPlatformRecoveryNative(
    intent.id,
    { action: "plan", receipt: recoveryJob },
    testExecutor,
  );
  await expect(
    context.delivery.recordPlatformRecoveryPlan(
      intent.id,
      recoveryPlan("another-build"),
      testExecutor,
    ),
  ).rejects.toMatchObject({
    code: "INVALID",
    message:
      "Recovery plan differs from its original source, stack or checkpointed native Job",
  });
  const recorded = await context.delivery.recordPlatformRecoveryPlan(
    intent.id,
    recoveryPlan(buildId),
    testExecutor,
  );
  expect(recorded.sourceBuildId).toBe(buildId);
  const { intent: planned } = await context.delivery.platformRecovery(
    intent.id,
    testOperator,
  );
  if (planned.planFingerprint === null)
    throw new Error("Expected the recorded recovery plan");
  // cloudflare is an automatic stack: its recovery apply needs no approval.
  await expect(
    context.delivery.approvePlatformRecoveryPlan(
      intent.id,
      {
        planFingerprint: planned.planFingerprint,
        decision: "approved",
        reason: "Reviewed the exact recovery plan",
      },
      testOperator,
    ),
  ).rejects.toMatchObject({
    code: "INVALID",
    message:
      "Only existing reviewed-plan stack policy requires recovery approval",
  });
});
