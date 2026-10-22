import { expect, test } from "vitest";
import type { FinishDeployment } from "#shared/contract.ts";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { publishCiRunner } from "#testing/model-fixture.ts";
import { testExecutor } from "#testing/seed.ts";
import {
  requestTrmnlRelease,
  TRMNL_PIPELINE,
  trmnlDelivery,
} from "#testing/trmnl-fixture.ts";

const context = useDeliveryFixture();

/** A TRMNL release frozen under the model recipe its v1 registration converts to. */
async function modelRelease() {
  const delivery = trmnlDelivery(context.cluster.database);
  const { source, selected } = await requestTrmnlRelease(delivery);
  await publishCiRunner(delivery);
  await context.cluster.database.pipeline.create({
    data: { id: "trmnl/model", definition: recipeFromPipeline(TRMNL_PIPELINE) },
  });
  await context.cluster.database.deployment.update({
    where: { id: source.id },
    data: { pipelineRevisionId: "trmnl/model" },
  });
  await delivery.claim(source.id, testExecutor);
  return { delivery, source, selected };
}

function acceptance(
  operationId: string,
  input: { archiveArtifactId: string; versionSetRevisionId: string },
) {
  return {
    kind: "acceptance" as const,
    operationId,
    summary: JSON.stringify({
      adapter: "trmnl-plugins",
      archiveDigest: `sha256:${"c".repeat(64)}`,
      pluginCount: 3,
      ...input,
    }),
  };
}

test("a model recipe's plugin archive step settles only under its own step key", async () => {
  const { delivery, source, selected } = await modelRelease();
  const proof = {
    archiveArtifactId: "trmnl/plugins",
    versionSetRevisionId: selected.id,
  };
  const finish: FinishDeployment = {
    status: "succeeded",
    message: "Release accepted",
    observedRevisionId: selected.id,
    recoveryRequired: false,
    evidence: [
      { kind: "reconciliation", summary: "Every frozen step settled" },
      { kind: "acceptance", summary: "Oracle passed" },
    ],
  };
  // The v1 stage no longer proves a model recipe's archive step.
  const legacy = deliveryOperationId(`${source.id}:trmnl-plugins`);
  await delivery.stage(
    source.id,
    {
      key: "trmnl-plugins",
      operationId: legacy,
      status: "succeeded",
      message: "Plugins configured under the v1 key",
      evidence: [acceptance(legacy, proof)],
    },
    testExecutor,
  );
  await expect(
    delivery.finish(source.id, finish, testExecutor),
  ).rejects.toThrow("independently read back from the exact frozen archive");
  const key = "step-archive";
  const operationId = deliveryOperationId(`${source.id}:${key}`);
  await delivery.stage(
    source.id,
    {
      key,
      operationId,
      status: "succeeded",
      message: `${key}: succeeded`,
      evidence: [
        acceptance(operationId, {
          ...proof,
          archiveArtifactId: "another/archive",
        }),
      ],
    },
    testExecutor,
  );
  await expect(
    delivery.finish(source.id, finish, testExecutor),
  ).rejects.toMatchObject({ code: "INVALID" });
  const repaired = `${key}/proof`;
  await delivery.stage(
    source.id,
    {
      key: repaired,
      operationId,
      status: "succeeded",
      message: "unrelated sub-stage",
      evidence: [acceptance(operationId, proof)],
    },
    testExecutor,
  );
  // Acceptance evidence counts only under the step's own stage.
  await expect(
    delivery.finish(source.id, finish, testExecutor),
  ).rejects.toMatchObject({ code: "INVALID" });
});

test("the step's own exact archive readback accepts the release", async () => {
  const { delivery, source, selected } = await modelRelease();
  const key = "step-archive";
  const operationId = deliveryOperationId(`${source.id}:${key}`);
  await delivery.stage(
    source.id,
    {
      key,
      operationId,
      status: "succeeded",
      message: `${key}: succeeded`,
      evidence: [
        acceptance(operationId, {
          archiveArtifactId: "trmnl/plugins",
          versionSetRevisionId: selected.id,
        }),
      ],
    },
    testExecutor,
  );
  await delivery.finish(
    source.id,
    {
      status: "succeeded",
      message: "Release accepted",
      observedRevisionId: selected.id,
      recoveryRequired: false,
      evidence: [
        { kind: "reconciliation", summary: "Every frozen step settled" },
        { kind: "acceptance", summary: "Oracle passed" },
      ],
    },
    testExecutor,
  );
  expect(
    await context.cluster.database.environment.findUnique({
      where: { id: "trmnl-dashboard/prod" },
    }),
  ).toMatchObject({
    acceptedDeploymentId: source.id,
    activeDeploymentId: null,
  });
});
