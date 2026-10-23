import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor } from "#testing/seed.ts";
import { arcadeRegistration } from "#testing/model-fixture.ts";

const context = useDeliveryFixture({ registration: arcadeRegistration });

/** arcade/prod as an automatic channel: its live set reaches the audience by `channel-publish`. */
async function channelEnvironment() {
  await context.cluster.database.pipeline.create({
    data: {
      id: "arcade/channel",
      definition: {
        kind: "channel",
        store: "docker-hub",
        name: "shepherdjerred/arcade",
        pointer: "latest",
        forwardOnly: false,
        artifactComponent: "image:arcade",
      },
    },
  });
  await context.cluster.database.environment.update({
    where: { id: "arcade/prod" },
    data: { pipelineRevisionId: "arcade/channel", automatic: true },
  });
}

test("an automatic channel environment receives a channel-publish deployment (4.12)", async () => {
  await channelEnvironment();
  const reconciled = await context.delivery.reconcile(
    ["arcade/prod"],
    testExecutor,
  );
  expect(reconciled.deployments).toHaveLength(1);
  const [id = ""] = reconciled.deployments;
  const deployment =
    await context.cluster.database.deployment.findUniqueOrThrow({
      where: { id },
    });
  expect(deployment).toMatchObject({
    kind: "channel-publish",
    automatic: true,
    pipelineRevisionId: "arcade/channel",
    versionSetRevisionId: context.fixture.versionSet.id,
  });
});
