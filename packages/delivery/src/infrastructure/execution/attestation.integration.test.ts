import { expect, test } from "vitest";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import type { Principal } from "#shared/contract.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import {
  arcadePipeline,
  arcadeRegistration,
  publishCiRunner,
  requestOnProd,
} from "#testing/model-fixture.ts";

const context = useDeliveryFixture({ registration: arcadeRegistration });
/** The operator tool's credential (X13): a machine credential with execute. */
const operatorTool: Principal = {
  id: "operator-tool",
  kind: "machine",
  scopes: ["read", "execute"],
};
const ran = [{ kind: "attestation" as const, summary: "ran" }];

/** arcade/prod deployed by an operator tool outside the cluster. */
async function operatorRunDeployment() {
  await publishCiRunner(context.delivery);
  const wrapped = recipeFromPipeline(arcadePipeline);
  if (wrapped.kind !== "kubernetes-application")
    throw new Error("arcade converts to a Kubernetes application recipe");
  await context.cluster.database.pipeline.create({
    data: {
      id: "arcade/4",
      definition: {
        kind: "operator-run",
        wrapped,
        stages: ["bootstrap", "verify"],
      },
    },
  });
  await context.cluster.database.environment.update({
    where: { id: "arcade/prod" },
    data: { pipelineRevisionId: "arcade/4", automatic: false },
  });
  const deployment = await requestOnProd(context, "operator-run");
  await context.delivery.claim(deployment.id, testExecutor);
  return deployment;
}

test("an operator attests each declared stage of an operator-run deployment", async () => {
  const deployment = await operatorRunDeployment();
  await expect(
    context.delivery.attestStage(
      deployment.id,
      { stage: "unknown", evidence: ran },
      operatorTool,
    ),
  ).rejects.toThrow(/not one the recipe asks/u);
  // A human session holds no execute scope; the tool uses its own credential.
  await expect(
    context.delivery.attestStage(
      deployment.id,
      { stage: "bootstrap", evidence: ran },
      testOperator,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    context.delivery.attestStage(
      deployment.id,
      { stage: "bootstrap", evidence: [] },
      operatorTool,
    ),
  ).rejects.toThrow();
  const attestation = {
    stage: "bootstrap",
    evidence: [
      {
        kind: "attestation" as const,
        operationId: "op-1",
        summary: "bootstrap tool applied the chart at the frozen revision",
        url: "https://github.com/shepherdjerred/monorepo/actions/runs/1",
      },
    ],
  };
  const stage = await context.delivery.attestStage(
    deployment.id,
    attestation,
    operatorTool,
  );
  expect(stage).toMatchObject({
    key: "attest/bootstrap",
    status: "succeeded",
    operationId: "op-1",
  });
  // A replay records nothing new.
  await context.delivery.attestStage(deployment.id, attestation, operatorTool);
  const detail = await context.delivery.detail(deployment.id);
  expect(detail.stages).toContainEqual(
    expect.objectContaining({
      key: "attest/bootstrap",
      status: "succeeded",
      operationId: "op-1",
    }),
  );
  expect(
    detail.evidence.filter((entry) => entry.kind === "attestation"),
  ).toHaveLength(1);
  // Without an operation id the evidence itself identifies the attestation.
  const verified = await context.delivery.attestStage(
    deployment.id,
    { stage: "verify", evidence: ran },
    operatorTool,
  );
  expect(verified.operationId).toMatch(/^sha256:[a-f0-9]{64}$/u);
});

test("a deployment of another recipe kind takes no attestation", async () => {
  const deployment = await requestOnProd(context, "deploy");
  await expect(
    context.delivery.attestStage(
      deployment.id,
      { stage: "bootstrap", evidence: ran },
      operatorTool,
    ),
  ).rejects.toThrow(/Only an operator-run deployment/u);
});
