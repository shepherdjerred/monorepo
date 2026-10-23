import { expect, test } from "vitest";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import type { Principal } from "#shared/contract.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import { MachineCredentialSchema } from "#infrastructure/config.ts";
import { createTestApp } from "#testing/http-app.ts";
import {
  arcadePipeline,
  arcadeRegistration,
  publishCiRunner,
  requestOnProd,
} from "#testing/model-fixture.ts";

const context = useDeliveryFixture({ registration: arcadeRegistration });
/** The operator tool's credential (X13): an attestor that never executes. */
const operatorTool: Principal = {
  id: "operator-tool",
  kind: "machine",
  scopes: ["read", "attest"],
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
  // Only the distinct attestor identity attests: never a human session, the
  // executor, or a credential carrying execute alongside attest.
  for (const actor of [
    testOperator,
    testExecutor,
    { ...testExecutor, scopes: [...testExecutor.scopes, "attest" as const] },
  ])
    await expect(
      context.delivery.attestStage(
        deployment.id,
        { stage: "bootstrap", evidence: ran },
        actor,
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
  const leased = await context.cluster.database.deployment.findUniqueOrThrow({
    where: { id: deployment.id },
  });
  const stage = await context.delivery.attestStage(
    deployment.id,
    attestation,
    operatorTool,
  );
  // An attestation proves nothing about the executor: its lease is unchanged.
  const after = await context.cluster.database.deployment.findUniqueOrThrow({
    where: { id: deployment.id },
  });
  expect(after.leaseExpiresAt).toEqual(leased.leaseExpiresAt);
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

test("an identity that owns the deployment never attests it, under any credential", async () => {
  const deployment = await operatorRunDeployment();
  // The same principal once claimed it with an executor credential.
  const owner: Principal = {
    id: "operator-tool",
    kind: "machine",
    scopes: ["read", "execute"],
  };
  await context.delivery.renewLease(
    deployment.id,
    { workflowId: `delivery/${deployment.id}`, workflowRunId: "run-1" },
    owner,
  );
  await expect(
    context.delivery.attestStage(
      deployment.id,
      { stage: "bootstrap", evidence: ran },
      operatorTool,
    ),
  ).rejects.toThrow(/owns this deployment never attests/u);
});

test("the executor's stage route never records an attestation stage", async () => {
  const deployment = await operatorRunDeployment();
  const token = "test-executor-stage-route-credential-00";
  const app = createTestApp(context.delivery, {
    machineCredentials: [{ token, principal: testExecutor }],
    writesEnabled: () => Promise.resolve(true),
    enabledEnvironments: () => Promise.resolve(["arcade/prod"]),
  });
  const write = (key: string) =>
    app.request(`/api/v1/deployments/${deployment.id}/stages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        key,
        status: "succeeded",
        operationId: "executor-self-attestation",
        message: "The executor attests its own work",
        evidence: ran,
      }),
    });
  const refused = await write("attest/bootstrap");
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({
    error: {
      code: "FORBIDDEN",
      message: "Only an operator attestation records an attestation stage",
    },
  });
  const detail = await context.delivery.detail(deployment.id);
  expect(detail.stages.map((stage) => stage.key)).not.toContain(
    "attest/bootstrap",
  );
  // Ordinary executor stages still record through the same route.
  const ordinary = await write("step-sync");
  expect(ordinary.status).toBe(200);
});

test("the API refuses an attestation credential that also executes", () => {
  expect(
    MachineCredentialSchema.safeParse({
      token: "t".repeat(32),
      principal: {
        id: "attestor",
        kind: "machine",
        scopes: ["read", "attest", "execute"],
      },
    }).success,
  ).toBe(false);
  expect(
    MachineCredentialSchema.safeParse({
      token: "t".repeat(32),
      principal: {
        id: "attestor",
        kind: "machine",
        scopes: ["read", "attest"],
      },
    }).success,
  ).toBe(true);
});
