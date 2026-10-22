import type { useDeliveryFixture } from "./delivery-fixture.ts";
import { publishCiRunner } from "./model-fixture.ts";
import { registerTestService } from "./services.ts";
import { replicateProducedArtifacts } from "./replication.ts";
import { testExecutor, testOperator, testPublisher } from "./seed.ts";

type Context = ReturnType<typeof useDeliveryFixture>;

/** The native plan Job a stack deployment's plan step records as its intent. */
export const stackPlanJob = {
  namespace: "delivery-platform-jobs" as const,
  name: `delivery-${"9".repeat(40)}`,
  uid: "33333333-3333-4333-8333-333333333333",
  specFingerprint: "f".repeat(64),
};

/**
 * Requests a deploy of tofu-cloudflare/prod, a model tofu recipe (plan,
 * approve, apply) from its stack archive. `override` moves the service's
 * lineage first, so the selection is non-eligible and needs one (H4).
 */
export async function requestStackDeployment(
  context: Context,
  options: { approvalPolicy?: "none" | "required"; override?: boolean } = {},
) {
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
      approvalPolicy: options.approvalPolicy ?? "none",
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
  if (options.override === true)
    await db.service.update({
      where: { id: "tofu-cloudflare" },
      data: { lineage: "f".repeat(64) },
    });
  const deployment = await context.delivery.createDeployment(
    {
      requestId: crypto.randomUUID(),
      environmentId: "tofu-cloudflare/prod",
      versionSetRevisionId: set.id,
      expectedGeneration: 0,
      kind: "deploy",
      ...(options.override === true ? { override: true } : {}),
    },
    testOperator,
  );
  return { deployment, buildId: build.buildId };
}

/** Claims a queued stack deployment and records its plan step's native Job. */
export async function startStackPlan(context: Context, deploymentId: string) {
  await context.delivery.claim(deploymentId, testExecutor);
  await context.delivery.stage(
    deploymentId,
    {
      key: "step-plan",
      status: "running",
      operationId: stackPlanJob.name,
      message: JSON.stringify({ ...stackPlanJob, requestId: deploymentId }),
      evidence: [],
    },
    testExecutor,
  );
}

/** The saved plan the plan step's Job reports for a stack deployment. */
export function savedStackPlan(deploymentId: string, buildId: string) {
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
      nativeJob: { ...stackPlanJob, requestId: deploymentId },
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
