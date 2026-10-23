import { expect, test } from "vitest";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { arcadePipeline, arcadeRegistration } from "#testing/model-fixture.ts";
import { testExecutor } from "#testing/seed.ts";

const context = useDeliveryFixture({ registration: arcadeRegistration });

async function removeProd(lifecycle: "active" | "removed") {
  await context.cluster.database.pipeline.create({
    data: { id: "arcade/3", definition: recipeFromPipeline(arcadePipeline) },
  });
  await context.cluster.database.environment.update({
    where: { id: "arcade/prod" },
    data: { pipelineRevisionId: "arcade/3", lifecycle },
  });
}

const removed = {
  observedAt: "2026-10-21T00:00:00.000Z",
  applications: ["arcade"],
};

test("a removed environment lists its Applications by lifecycle until their removal is recorded", async () => {
  await removeProd("removed");
  expect(await context.delivery.pendingRemovals()).toEqual([
    {
      environmentId: "arcade/prod",
      applications: [{ name: "arcade", lifecycle: "retain" }],
    },
  ]);
  const first = await context.delivery.recordTargetRemoved(
    "arcade/prod",
    removed,
    testExecutor,
  );
  expect(
    await context.delivery.recordTargetRemoved(
      "arcade/prod",
      { ...removed, observedAt: "2026-10-22T00:00:00.000Z" },
      testExecutor,
    ),
  ).toEqual(first);
  expect(await context.delivery.pendingRemovals()).toEqual([]);
});

test("an active environment keeps its target state", async () => {
  await removeProd("active");
  expect(await context.delivery.pendingRemovals()).toEqual([]);
  await expect(
    context.delivery.recordTargetRemoved("arcade/prod", removed, testExecutor),
  ).rejects.toThrow(/Only a removed environment/u);
});

test("a removed environment whose v1 recipe declares no lifecycle policy fails loudly", async () => {
  // The catalog refuses this removal; only a broken record reaches it.
  await context.cluster.database.environment.update({
    where: { id: "arcade/prod" },
    data: { lifecycle: "removed" },
  });
  await expect(context.delivery.pendingRemovals()).rejects.toThrow(
    /deploys Application arcade with no lifecycle policy/u,
  );
});
