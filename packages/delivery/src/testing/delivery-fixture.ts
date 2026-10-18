import { afterAll, beforeAll, beforeEach } from "vitest";
import type { CreateDeployment, PublishBuild } from "#shared/contract.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { createTestDatabase } from "./postgres.ts";
import { seedDelivery, testExecutor, testPublisher } from "./seed.ts";
import type { ForumPolicyReader } from "#infrastructure/forum/source-policy.ts";
import type { TestRegistration } from "./seed.ts";

/** Each calling test file owns one disposable cluster and a fresh seeded test. */
export function useDeliveryFixture(
  options: {
    forumPolicyReader?: ForumPolicyReader;
    registration?: TestRegistration;
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
      undefined,
      options.forumPolicyReader,
    );
  }, 60_000);
  afterAll(async () => {
    await cluster.close();
  });
  beforeEach(async () => {
    await cluster.database.$executeRawUnsafe(
      'TRUNCATE "ApplicationLock", "Outbox", "Evidence", "Approval", "Stage", "Deployment", "Environment", "Pipeline", "VersionSetEntry", "VersionSet", "Artifact", "Build", "Request", "Audit", "ImportedSnapshot" CASCADE',
    );
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
