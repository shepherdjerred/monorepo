import { afterAll, beforeAll, beforeEach } from "vitest";
import type { CreateDeployment, PublishBuild } from "#shared/contract.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { createTestDatabase } from "./postgres.ts";
import { resetDeliveryTables } from "./delivery-http-fixture.ts";
import {
  seedDelivery,
  testExecutor,
  testOperator,
  testPublisher,
} from "./seed.ts";
import type { ForumPolicyReader } from "#infrastructure/forum/source-policy.ts";
import type { TestRegistration } from "./seed.ts";
import type { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";

/** Each calling test file owns one disposable cluster and a fresh seeded test. */
export function useDeliveryFixture(
  options: {
    forumPolicyReader?: ForumPolicyReader;
    registration?: TestRegistration;
    catalog?: ServiceIndex;
  } = {},
) {
  let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
  let delivery: Delivery;
  let fixture: Awaited<ReturnType<typeof seedDelivery>>;
  beforeAll(async () => {
    cluster = await createTestDatabase();
    delivery = new Delivery(
      cluster.database,
      1,
      options.catalog,
      options.forumPolicyReader,
    );
  }, 60_000);
  afterAll(async () => {
    await cluster.close();
  });
  beforeEach(async () => {
    await resetDeliveryTables(cluster.database, options.catalog);
    fixture = await seedDelivery(delivery, options.registration);
  });
  return {
    get cluster() {
      return cluster;
    },
    get delivery() {
      return delivery;
    },
    get fixture() {
      return fixture;
    },
    async publishVerified(number: number) {
      const build = await delivery.publish(
        testPublication(number),
        testPublisher,
        {
          repositoryId: 1,
          pipelineNumber: number,
        },
      );
      await delivery.qualify(build.buildId, "verified", testExecutor);
      return build;
    },
    input(requestId = "deploy/1"): CreateDeployment {
      return {
        requestId,
        environmentId: fixture.environment.id,
        versionSetRevisionId: fixture.versionSet.id,
        expectedGeneration: fixture.environment.generation,
        kind: "deploy",
      };
    },
  };
}

export function testPublication(number: number): PublishBuild {
  return {
    requestId: `publish/${String(number)}`,
    serviceId: "arcade",
    sourceRevision: "b".repeat(40),
    ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
    verifiedAt: new Date().toISOString(),
    artifacts: [
      {
        id: `image/${String(number)}`,
        component: "server",
        kind: "image",
        uri: "docker.io/shepherdjerred/arcade",
        version: `1.0.${String(number)}`,
        digest: `sha256:${"c".repeat(64)}`,
      },
    ],
  };
}

/**
 * A deployment of the fixture environment, its service made self-hosted so
 * it can be handed off, claimed by one executor identity (D7, D8).
 */
export async function claimedSelfHostedDeployment(
  context: ReturnType<typeof useDeliveryFixture>,
  requestId: string,
) {
  const db = context.cluster.database;
  const env = await db.environment.findUniqueOrThrow({
    where: { id: context.fixture.environment.id },
  });
  await db.service.update({
    where: { id: env.serviceId },
    data: { selfHosted: true },
  });
  const deployment = await context.delivery.createDeployment(
    {
      requestId,
      environmentId: env.id,
      versionSetRevisionId: context.fixture.versionSet.id,
      expectedGeneration: env.generation,
      kind: "deploy",
    },
    testOperator,
  );
  const owner = { workflowId: "delivery/owner", workflowRunId: "run-1" };
  await context.delivery.claim(deployment.id, testExecutor, undefined, owner);
  return { deployment, owner };
}

/**
 * An operator's deploy of one set revision, claimed and accepted by the
 * executor with reconciliation and acceptance evidence.
 */
export async function acceptedDeployment(
  context: ReturnType<typeof useDeliveryFixture>,
  versionSetId: string,
  approve = false,
) {
  const env = await context.cluster.database.environment.findUniqueOrThrow({
    where: { id: context.fixture.environment.id },
  });
  const deployment = await context.delivery.createDeployment(
    {
      requestId: crypto.randomUUID(),
      environmentId: env.id,
      versionSetRevisionId: versionSetId,
      expectedGeneration: env.generation,
      kind: "deploy",
    },
    testOperator,
  );
  if (approve)
    await context.delivery.approve(
      deployment.id,
      { decision: "approve", reason: "reviewed the release" },
      testOperator,
    );
  await context.delivery.claim(deployment.id, testExecutor);
  await context.delivery.finish(
    deployment.id,
    {
      status: "succeeded",
      message: "Accepted",
      observedRevisionId: versionSetId,
      recoveryRequired: false,
      evidence: [
        { kind: "reconciliation", summary: "exact operation completed" },
        { kind: "acceptance", summary: "acceptance checks passed" },
      ],
    },
    testExecutor,
  );
  return deployment;
}
