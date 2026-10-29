import type { useDeliveryFixture } from "./delivery-fixture.ts";
import { testExecutor, testPublisher } from "./seed.ts";

type Context = ReturnType<typeof useDeliveryFixture>;
type PublishedArtifact = {
  id: string;
  component: string;
  kind: "archive" | "chart" | "image";
  uri: string;
  version: string;
  digest: string;
};

/**
 * Publishes one main-pipeline build of a service's artifacts, qualifies it,
 * and returns the automatic set it composed (R0).
 */
export async function publishVerifiedSet(
  context: Context,
  build: {
    serviceId: string;
    pipelineNumber: number;
    sourceRevision: string;
    artifacts: PublishedArtifact[];
  },
) {
  const published = await context.delivery.publish(
    {
      requestId: `publish/${build.serviceId}`,
      serviceId: build.serviceId,
      sourceRevision: build.sourceRevision,
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(build.pipelineNumber)}`,
      verifiedAt: new Date().toISOString(),
      artifacts: build.artifacts,
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: build.pipelineNumber },
  );
  await context.delivery.qualify(published.buildId, "verified", testExecutor);
  const [set] = await context.delivery.versions(build.serviceId);
  if (set === undefined)
    throw new Error(`${build.serviceId}'s build composed no set`);
  return { set, buildId: published.buildId };
}
