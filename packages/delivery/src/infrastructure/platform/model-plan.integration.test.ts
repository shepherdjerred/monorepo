import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
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
      { planDigest: `sha256:${"8".repeat(64)}`, reason: "looked" },
      testOperator,
    ),
  ).rejects.toThrow(/exact unexpired saved plan/u);
  await context.delivery.approveTofuPlan(
    deployment.id,
    { planDigest: plan.receipt.planDigest, reason: "one DNS record, reviewed" },
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
});

test("an application deployment takes no plan approval", async () => {
  const deployment = await requestOnProd(context, "deploy");
  await expect(
    context.delivery.approveTofuPlan(
      deployment.id,
      { planDigest: `sha256:${"7".repeat(64)}`, reason: "looked" },
      testOperator,
    ),
  ).rejects.toThrow(/Only a model tofu recipe/u);
});
