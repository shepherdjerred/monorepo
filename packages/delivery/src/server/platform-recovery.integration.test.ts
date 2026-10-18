import { beforeEach, expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { platformFixture } from "#testing/platform-fixture.ts";
import {
  requestTestPlan,
  checkpointTestPlan,
  testNativeReceipt,
} from "#testing/platform-execution.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import { createTestApp } from "#testing/http-app.ts";

const context = useDeliveryFixture();
let fixture: Awaited<ReturnType<typeof platformFixture>>;
let app: ReturnType<typeof createTestApp>;
let writes = true;
const token = "disposable-infrastructure-recovery-executor";
const executorHeaders = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
const humanHeaders = {
  "Tailscale-User-Login": "operator@example.com",
  Origin: "http://delivery.test",
  "Content-Type": "application/json",
};
beforeEach(async () => {
  writes = true;
  fixture = await platformFixture(context.cluster.database);
  app = createTestApp(fixture.delivery, {
    machineCredentials: [{ token, principal: testExecutor }],
    writesEnabled: () => Promise.resolve(writes),
    enabledEnvironments: () => Promise.resolve(fixture.environmentIds),
  });
});
async function recovery(stack = "github") {
  const deployment = await requestTestPlan(
    fixture.delivery,
    fixture.sourceBuildId,
    stack,
  );
  const saved = await checkpointTestPlan(fixture.delivery, deployment);
  await fixture.delivery.finish(
    deployment.id,
    {
      status: "failed",
      message: "Planning result unavailable",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  const env = await context.cluster.database.environment.findUniqueOrThrow({
    where: { id: deployment.environmentId },
  });
  const intent = await fixture.delivery.requestPlatformRecovery(
    deployment.id,
    {
      requestId: `recovery/${stack}`,
      expectedEnvironmentGeneration: env.generation,
      reason:
        "Inspect original state and produce a fresh immutable recovery plan",
    },
    testOperator,
  );
  const native = {
    ...testNativeReceipt(intent.id),
    name: `delivery-${"d".repeat(40)}`,
  };
  await fixture.delivery.recordPlatformRecoveryNative(
    intent.id,
    { action: "plan", receipt: native },
    testExecutor,
  );
  const { deploymentId: _original, schema: _schema, ...fields } = saved.receipt;
  return {
    deployment,
    saved,
    intent,
    native,
    record: {
      receipt: {
        ...fields,
        schema: "delivery-tofu-recovery-plan/v1" as const,
        recoveryIntentId: intent.id,
        nativeJob: native,
      },
      encryptedPlan: {
        ...saved.encryptedPlan,
        ciphertext: Buffer.alloc(1_100_000, 4).toString("base64"),
      },
    },
  };
}
test("large recovery plan records remain execute-only immutable envelopes and public responses redact bytes", async () => {
  const { intent, record } = await recovery();
  const response = await app.request(
    `/api/v1/platform-recovery/${encodeURIComponent(intent.id)}/plan`,
    { method: "POST", headers: executorHeaders, body: JSON.stringify(record) },
  );
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain("ciphertext");
  const privateResponse = await app.request(
    `/api/v1/platform-recovery/${encodeURIComponent(intent.id)}/plan`,
    { headers: executorHeaders },
  );
  expect(privateResponse.status).toBe(200);
  expect(await privateResponse.json()).toEqual(record);
  const denied = await app.request(
    `/api/v1/platform-recovery/${encodeURIComponent(intent.id)}/plan`,
    { headers: humanHeaders },
  );
  expect(denied.status).toBe(403);
  const publicResponse = await app.request(
    `/api/v1/platform-recovery/${encodeURIComponent(intent.id)}`,
    { headers: humanHeaders },
  );
  expect(await publicResponse.text()).not.toContain("ciphertext");
  await expect(
    fixture.delivery.recordPlatformRecoveryPlan(
      intent.id,
      {
        ...record,
        encryptedPlan: {
          ...record.encryptedPlan,
          ciphertext: Buffer.from("changed").toString("base64"),
        },
      },
      testExecutor,
    ),
  ).rejects.toThrow("immutable");
  const ordinary = await app.request(
    `/api/v1/platform-recovery/${encodeURIComponent(intent.id)}/native`,
    {
      method: "POST",
      headers: executorHeaders,
      body: JSON.stringify({ ...record, padding: "x".repeat(1_100_000) }),
    },
  );
  expect(ordinary.status).toBe(413);
});
test("reviewed recovery apply binds exact human approval and every prior native job while pause blocks new effects", async () => {
  const { intent, record, saved } = await recovery("openai");
  await fixture.delivery.recordPlatformRecoveryPlan(
    intent.id,
    record,
    testExecutor,
  );
  const current = await fixture.delivery.platformRecovery(
    intent.id,
    testOperator,
  );
  const planFingerprint = current.intent.planFingerprint;
  if (planFingerprint === null)
    throw new Error("Expected recorded immutable recovery plan");
  const applyNative = {
    ...testNativeReceipt(intent.id),
    name: `delivery-${"e".repeat(40)}`,
  };
  await fixture.delivery.recordPlatformRecoveryNative(
    intent.id,
    { action: "apply", receipt: applyNative },
    testExecutor,
  );
  const input = {
    expectedEnvironmentGeneration: intent.expectedEnvironmentGeneration,
    snapshotFingerprint: intent.snapshotFingerprint,
    observedAt: new Date().toISOString(),
    sourceWorkflow: {
      workflowId: `delivery/${intent.deploymentId}`,
      status: "FAILED" as const,
    },
    nativeJobs: [saved.receipt.nativeJob, record.receipt.nativeJob].map(
      (receipt) => ({
        ...receipt,
        status: "Complete" as const,
        podsAbsent: false,
      }),
    ),
    planFingerprint,
  };
  await expect(
    fixture.delivery.admitPlatformRecoveryApply(intent.id, input, testExecutor),
  ).rejects.toThrow("human approval");
  const approval = {
    planFingerprint,
    decision: "approved" as const,
    reason:
      "Review exact saved state, plan digest and bounded recovery effects",
  };
  const machine = await app.request(
    `/api/v1/platform-recovery/${encodeURIComponent(intent.id)}/approve`,
    {
      method: "POST",
      headers: executorHeaders,
      body: JSON.stringify(approval),
    },
  );
  expect(machine.status).toBe(403);
  const approved = await app.request(
    `/api/v1/platform-recovery/${encodeURIComponent(intent.id)}/approve`,
    { method: "POST", headers: humanHeaders, body: JSON.stringify(approval) },
  );
  expect(approved.status).toBe(200);
  await fixture.delivery.admitPlatformRecoveryApply(
    intent.id,
    input,
    testExecutor,
  );
  await expect(
    fixture.delivery.admitPlatformRecoveryApply(
      intent.id,
      { ...input, planFingerprint: "0".repeat(64) },
      testExecutor,
    ),
  ).rejects.toThrow("exact unexpired");
  writes = false;
  const blocked = await app.request(
    `/api/v1/platform-recovery/${encodeURIComponent(intent.id)}/admit-apply`,
    { method: "POST", headers: executorHeaders, body: JSON.stringify(input) },
  );
  expect(blocked.status).toBe(503);
  const quarantinedDetail = await fixture.delivery.platformRecovery(
    intent.id,
    testOperator,
  );
  expect(quarantinedDetail.deployment.deployment.recoveryRequired).toBe(true);
});
