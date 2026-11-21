import type { Delivery } from "#infrastructure/delivery.ts";
import { testPublisher } from "#testing/seed.ts";

// A pipeline whose CI run is still in progress, for the browser harness.

/** A service no other seed touches, so only its own pipeline page changes. */
export const RUNNING_SERVICE = "streambot";
/** The Woodpecker double reports this pipeline as an in-progress monorepo run. */
export const RUNNING_PIPELINE = 401;

/**
 * Publish a build and leave it unqualified, as Delivery holds one while its
 * Woodpecker run has not finished.
 */
export async function seedRunningPipeline(delivery: Delivery) {
  const sourceRevision = "5ca1ab1e".repeat(5);
  await delivery.publish(
    {
      requestId: "pipeline-graph/running",
      serviceId: RUNNING_SERVICE,
      sourceRevision,
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(RUNNING_PIPELINE)}`,
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: "pipeline-graph/running/image",
          component: "server",
          kind: "image",
          uri: "docker.io/shepherdjerred/streambot",
          version: "3.1.0",
          digest: `sha256:${sourceRevision}${"0".repeat(24)}`,
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: RUNNING_PIPELINE },
  );
}
