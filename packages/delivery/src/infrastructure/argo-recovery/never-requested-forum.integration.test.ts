import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { contentRecoveryCatalog } from "#testing/content-recovery-fixture.ts";
import { registration } from "#testing/catalog-fixture.ts";
import { testOperator, testPublisher } from "#testing/seed.ts";
import { RecipeDefinitionSchema } from "#shared/model/recipe-contract.ts";
import { createRecoveryInspector } from "#infrastructure/recovery.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";

const scope = useDeliveryFixture({ catalog: contentRecoveryCatalog });
const priorOperationId = "6b1c507d-fa26-4e72-9918-cd66d7f664db";
const reason =
  "A Forum sync guard refused before any Argo operation was submitted";

/** A failed Forum release whose sync guard refused after recording the sync stage. */
async function refusedForumRelease() {
  const db = scope.cluster.database;
  const id = `forum-refused-${crypto.randomUUID()}`;
  const env = await db.environment.findUniqueOrThrow({
    where: { id: scope.fixture.environment.id },
  });
  await db.pipeline.create({
    data: {
      id: `${id}/recipe`,
      definition: RecipeDefinitionSchema.parse(
        await registration("specialized/storm-forum/pipeline.json"),
      ),
    },
  });
  await db.deployment.create({
    data: {
      id,
      requestId: id,
      environmentId: env.id,
      serviceId: env.serviceId,
      versionSetRevisionId: scope.fixture.versionSet.id,
      pipelineRevisionId: `${id}/recipe`,
      configurationId: env.declaredConfigurationId,
      catalogRevision: "test",
      expectedGeneration: env.generation,
      kind: "deploy",
      status: "failed",
      recoveryRequired: true,
      requestedBy: testPublisher.id,
      finishedAt: new Date(),
    },
  });
  await db.environment.update({
    where: { id: env.id },
    data: { activeDeploymentId: id },
  });
  const operationId = deliveryOperationId(id);
  for (const [key, status] of [
    ["step-apply-safety", "succeeded"],
    ["step-sync", "running"],
  ] as const)
    await db.stage.create({
      data: {
        id: `${id}/${key}`,
        deploymentId: id,
        key,
        status,
        operationId,
        message: `${key}: ${status}`,
        startedAt: new Date(),
      },
    });
  return { id, generation: env.generation };
}

/** The Forum Application, its last operation an earlier release's. */
function forumApplication(requestId: string, environmentId: string) {
  const source = {
    chart: "storm-forum",
    repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
    targetRevision: "2.0.0-1",
  };
  return {
    metadata: {
      name: "storm-forum",
      resourceVersion: "1",
      annotations: { "delivery.shepherdjerred.com/environment": environmentId },
    },
    spec: { source },
    operation: null,
    status: {
      history: [{ id: 3, source }],
      operationState: {
        phase: "Succeeded" as const,
        finishedAt: "2026-11-19T05:23:17Z",
        operation: {
          info: [
            { name: "ci.sjer.red/request-id", value: requestId },
            { name: "ci.sjer.red/operation-id", value: priorOperationId },
          ],
        },
      },
      resources: [],
    },
  };
}

test("an operator's Forum Application readback opens an intent only once the readback already proves it (AI-884)", async () => {
  const { id, generation } = await refusedForumRelease();
  const detail = await scope.delivery.detail(id);
  const request = {
    requestId: `${id}/argo`,
    reason,
    expectedGeneration: generation,
    expectedKind: "argo" as const,
  };
  const intents = async () =>
    await scope.cluster.database.recoveryIntent.count({
      where: { deploymentId: id },
    });
  await expect(
    scope.delivery.requestRecoveryIntent(id, request, testOperator),
  ).rejects.toMatchObject({ code: "PAUSED" });
  const reached = createRecoveryInspector({
    readApplication: async () =>
      forumApplication(deliveryOperationId(id), detail.environment.id),
  });
  await expect(
    scope.delivery.requestRecoveryIntent(id, request, testOperator, reached),
  ).rejects.toMatchObject({ code: "INVALID" });
  expect(await intents()).toBe(0);
  const prior = createRecoveryInspector({
    readApplication: async () =>
      forumApplication(
        "91078308-225c-4449-80f6-cc64a7b6e894",
        detail.environment.id,
      ),
  });
  const intent = await scope.delivery.requestRecoveryIntent(
    id,
    request,
    testOperator,
    prior,
  );
  expect(intent).toMatchObject({ kind: "argo", deploymentId: id });
});

test("Application readback settles a Forum release only when its sync request never reached an operation (AI-884)", async () => {
  const { id } = await refusedForumRelease();
  const detail = await scope.delivery.detail(id);
  const prior = createRecoveryInspector({
    readApplication: async () =>
      forumApplication(
        "91078308-225c-4449-80f6-cc64a7b6e894",
        detail.environment.id,
      ),
  });
  const evidence = await prior(detail, {
    operationId: priorOperationId,
    reason,
  });
  expect(evidence[0]?.summary).toContain("never reached an operation");
  const own = createRecoveryInspector({
    readApplication: async () =>
      forumApplication(deliveryOperationId(id), detail.environment.id),
  });
  await expect(own(detail, { reason })).rejects.toMatchObject({
    code: "INVALID",
    message: expect.stringContaining("specialized recovery procedure"),
  });
});
