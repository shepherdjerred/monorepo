import { expect, test } from "vitest";
import { StageSchema } from "#shared/contract.ts";
import {
  fingerprint,
  selectionFingerprint,
} from "#infrastructure/delivery-records.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { createTestApp } from "#testing/http-app.ts";
import { publishCiRunner, requestOnProd } from "#testing/model-fixture.ts";
import { registerTestService } from "#testing/services.ts";
import { replicateProducedArtifacts } from "#testing/replication.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";

const context = useDeliveryFixture();
const native = {
  namespace: "delivery-platform-jobs" as const,
  name: `delivery-${"9".repeat(40)}`,
  uid: "33333333-3333-4333-8333-333333333333",
  specFingerprint: "f".repeat(64),
};

/** tofu-cloudflare/prod running a model tofu recipe from its stack archive. */
async function runningStackDeployment() {
  const db = context.cluster.database;
  await registerTestService(db, "tofu-cloudflare");
  await publishCiRunner(context.delivery);
  await db.pipeline.create({
    data: {
      id: "tofu-cloudflare/1",
      definition: {
        kind: "tofu",
        stack: "cloudflare",
        archiveComponent: "archive:tofu-cloudflare",
        runner: { service: "ci", component: "image:ci-base" },
        steps: ["plan", "approve", "apply"].map((kind) => ({
          kind,
          instance: "stack:cloudflare",
        })),
        sharedLock: "platform",
      },
    },
  });
  await db.configuration.create({
    data: { id: "tofu-cloudflare/1", content: {} },
  });
  await db.environment.create({
    data: {
      id: "tofu-cloudflare/prod",
      serviceId: "tofu-cloudflare",
      name: "prod",
      pipelineRevisionId: "tofu-cloudflare/1",
      declaredConfigurationId: "tofu-cloudflare/1",
    },
  });
  const build = await context.delivery.publish(
    {
      requestId: "publish/tofu-cloudflare",
      serviceId: "tofu-cloudflare",
      sourceRevision: "c".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/91",
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: "tofu-cloudflare/archive",
          component: "archive:tofu-cloudflare",
          kind: "archive",
          uri: `s3://delivery-artifacts/tofu/cloudflare/${"c".repeat(64)}.tar`,
          version: "c".repeat(40),
          digest: `sha256:${"c".repeat(64)}`,
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 91 },
  );
  await replicateProducedArtifacts(context.delivery, build.buildId);
  await context.delivery.qualify(build.buildId, "verified", testExecutor);
  const [set] = await context.delivery.versions("tofu-cloudflare");
  if (set === undefined) throw new Error("Stack archive composed no set");
  const deployment = await context.delivery.createDeployment(
    {
      requestId: crypto.randomUUID(),
      environmentId: "tofu-cloudflare/prod",
      versionSetRevisionId: set.id,
      expectedGeneration: 0,
      kind: "deploy",
    },
    testOperator,
  );
  await context.delivery.claim(deployment.id, testExecutor);
  await context.delivery.stage(
    deployment.id,
    {
      key: "step-plan",
      status: "running",
      operationId: native.name,
      message: JSON.stringify({ ...native, requestId: deployment.id }),
      evidence: [],
    },
    testExecutor,
  );
  return { deployment, buildId: build.buildId };
}

function savedPlan(deploymentId: string, buildId: string) {
  const now = Date.now();
  return {
    receipt: {
      schema: "delivery-tofu-plan/v1" as const,
      deploymentId,
      sourceBuildId: buildId,
      sourceRevision: "c".repeat(40),
      stack: "cloudflare" as const,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
      planDigest: `sha256:${"7".repeat(64)}`,
      state: { lineage: "lineage-1", serial: 4 },
      nativeJob: { ...native, requestId: deploymentId },
      changes: { create: 1, update: 0, delete: 0, replace: 0 },
    },
    encryptedPlan: {
      algorithm: "aes-256-gcm" as const,
      salt: btoa("s".repeat(16)),
      iv: btoa("i".repeat(12)),
      tag: btoa("t".repeat(16)),
      ciphertext: btoa("plan"),
    },
  };
}

test("a model tofu deployment records the plan its plan step produced, then takes a human approval of it", async () => {
  const { deployment, buildId } = await runningStackDeployment();
  const plan = savedPlan(deployment.id, buildId);
  await expect(
    context.delivery.recordTofuPlan(
      savedPlan(deployment.id, "other-build"),
      testExecutor,
    ),
  ).rejects.toThrow(/frozen source/u);
  await context.delivery.recordTofuPlan(plan, testExecutor);
  await expect(
    context.delivery.approveTofuPlan(
      deployment.id,
      {
        decision: "approved",
        planDigest: `sha256:${"8".repeat(64)}`,
        reason: "looked",
      },
      testOperator,
    ),
  ).rejects.toThrow(/exact unexpired saved plan/u);
  await context.delivery.approveTofuPlan(
    deployment.id,
    {
      decision: "approved",
      planDigest: plan.receipt.planDigest,
      reason: "one DNS record, reviewed",
    },
    testOperator,
  );
  const detail = await context.delivery.detail(deployment.id);
  expect(detail.stages).toContainEqual(
    expect.objectContaining({
      key: "approve/plan",
      status: "succeeded",
      operationId: plan.receipt.planDigest,
    }),
  );
  expect(
    await context.cluster.database.approval.findUniqueOrThrow({
      where: { deploymentId: deployment.id },
    }),
  ).toMatchObject({
    status: "granted",
    actor: testOperator.id,
    reason: "one DNS record, reviewed",
  });
  await expect(
    context.delivery.tofuPlan(deployment.id, testExecutor),
  ).resolves.toEqual(plan);
});

test("a rejection is the deployment's one decision: it discards the plan, and the failed deployment holds no lock", async () => {
  const db = context.cluster.database;
  const { deployment, buildId } = await runningStackDeployment();
  const plan = savedPlan(deployment.id, buildId);
  await context.delivery.recordTofuPlan(plan, testExecutor);
  const rejection = {
    decision: "rejected" as const,
    planDigest: plan.receipt.planDigest,
    reason: "deletes the apex record",
  };
  await expect(
    context.delivery.approveTofuPlan(deployment.id, rejection, {
      id: "bot",
      kind: "machine",
      scopes: ["read", "approve"],
    }),
  ).rejects.toThrow(/Machine credentials cannot approve/u);
  const app = createTestApp(context.delivery, {
    machineCredentials: [],
    writesEnabled: () => Promise.resolve(true),
    enabledEnvironments: () => Promise.resolve(["tofu-cloudflare/prod"]),
  });
  const decide = (body: unknown) =>
    app.request(
      `/api/v1/deployments/${encodeURIComponent(deployment.id)}/plan-approval`,
      {
        method: "POST",
        headers: {
          "Tailscale-User-Login": testOperator.id,
          Origin: "http://delivery.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
  // The decision is explicit: a body without one is refused.
  const undecided = await decide({
    planDigest: rejection.planDigest,
    reason: "no",
  });
  expect(undecided.status).toBe(400);
  const response = await decide(rejection);
  expect(response.status).toBe(200);
  expect(StageSchema.parse(await response.json())).toMatchObject({
    key: "approve/plan",
    status: "failed",
    operationId: plan.receipt.planDigest,
    message: `Rejected by ${testOperator.id}`,
  });
  expect(
    await db.approval.findUniqueOrThrow({
      where: { deploymentId: deployment.id },
    }),
  ).toMatchObject({
    status: "rejected",
    actor: testOperator.id,
    reason: rejection.reason,
    boundFingerprint: fingerprint({
      selection: selectionFingerprint(
        deployment.versionSetRevisionId,
        deployment.pipelineRevisionId,
        deployment.configurationId,
      ),
      planDigest: plan.receipt.planDigest,
      state: plan.receipt.state,
    }),
  });
  // The plan is discarded and never saved again.
  await expect(
    context.delivery.tofuPlan(deployment.id, testExecutor),
  ).rejects.toThrow(/saved platform plan/u);
  await expect(
    context.delivery.recordTofuPlan(plan, testExecutor),
  ).rejects.toThrow(/rejected and discarded/u);
  // One decision per deployment: only the identical rejection repeats.
  await expect(
    context.delivery.approveTofuPlan(
      deployment.id,
      { ...rejection, decision: "approved" },
      testOperator,
    ),
  ).rejects.toThrow(/already been decided/u);
  await expect(
    context.delivery.approveTofuPlan(deployment.id, rejection, testOperator),
  ).resolves.toMatchObject({ key: "approve/plan", status: "failed" });
  // The executor settles its steps (none left running) and finishes failed.
  expect(
    await db.platformLock.count({ where: { deploymentId: deployment.id } }),
  ).toBe(1);
  for (const [key, status] of [
    ["step-plan", "succeeded"],
    ["step-approve", "failed"],
  ] as const)
    await context.delivery.stage(
      deployment.id,
      {
        key,
        status,
        operationId: key === "step-plan" ? native.name : deployment.id,
        message: `${key}: ${status}`,
        evidence: [],
      },
      testExecutor,
    );
  await context.delivery.finish(
    deployment.id,
    {
      status: "failed",
      message: "Saved plan was rejected; nothing was applied",
      recoveryRequired: false,
      evidence: [],
    },
    testExecutor,
  );
  expect(
    await db.platformLock.count({ where: { deploymentId: deployment.id } }),
  ).toBe(0);
  expect(
    await db.targetLock.count({ where: { deploymentId: deployment.id } }),
  ).toBe(0);
  expect(
    await db.environment.findUniqueOrThrow({
      where: { id: "tofu-cloudflare/prod" },
    }),
  ).toMatchObject({ activeDeploymentId: null, acceptedDeploymentId: null });
});

test("an application deployment takes no plan approval", async () => {
  const deployment = await requestOnProd(context, "deploy");
  await expect(
    context.delivery.approveTofuPlan(
      deployment.id,
      {
        decision: "rejected",
        planDigest: `sha256:${"7".repeat(64)}`,
        reason: "looked",
      },
      testOperator,
    ),
  ).rejects.toThrow(/Only a model tofu recipe/u);
});
