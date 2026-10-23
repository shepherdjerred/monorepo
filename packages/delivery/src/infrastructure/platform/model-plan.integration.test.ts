import { expect, test } from "vitest";
import { StageSchema } from "#shared/contract.ts";
import {
  fingerprint,
  selectionFingerprint,
} from "#infrastructure/delivery-records.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { createTestApp } from "#testing/http-app.ts";
import { requestOnProd } from "#testing/model-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import {
  requestStackDeployment,
  savedStackPlan,
  stackPlanJob,
  startStackPlan,
} from "#testing/tofu-stack-fixture.ts";

const context = useDeliveryFixture();
/** tofu-cloudflare/prod running a model tofu recipe from its stack archive. */
async function runningStackDeployment() {
  const requested = await requestStackDeployment(context);
  await startStackPlan(context, requested.deployment.id);
  return requested;
}

test("a model tofu deployment records the plan its plan step produced, then takes a human approval of it", async () => {
  const { deployment, buildId } = await runningStackDeployment();
  const plan = savedStackPlan(deployment.id, buildId);
  await expect(
    context.delivery.recordTofuPlan(
      savedStackPlan(deployment.id, "other-build"),
      testExecutor,
    ),
  ).rejects.toThrow(/frozen source/u);
  await context.delivery.recordTofuPlan(plan, testExecutor);
  await expect(
    context.delivery.approveTofuPlan(
      deployment.id,
      {
        decision: "approved",
        planDigest: `sha256:${"8".repeat(64)}`,
        reason: "looked",
      },
      testOperator,
    ),
  ).rejects.toThrow(/exact unexpired saved plan/u);
  await context.delivery.approveTofuPlan(
    deployment.id,
    {
      decision: "approved",
      planDigest: plan.receipt.planDigest,
      reason: "one DNS record, reviewed",
    },
    testOperator,
  );
  const detail = await context.delivery.detail(deployment.id);
  expect(detail.stages).toContainEqual(
    expect.objectContaining({
      key: "approve/plan",
      status: "succeeded",
      operationId: plan.receipt.planDigest,
    }),
  );
  expect(
    await context.cluster.database.approval.findUniqueOrThrow({
      where: { deploymentId: deployment.id },
    }),
  ).toMatchObject({
    status: "granted",
    actor: testOperator.id,
    reason: "one DNS record, reviewed",
  });
  await expect(
    context.delivery.tofuPlan(deployment.id, testExecutor),
  ).resolves.toEqual(plan);
});

test("a rejection is the deployment's one decision: it discards the plan, and the failed deployment holds no lock", async () => {
  const db = context.cluster.database;
  const { deployment, buildId } = await runningStackDeployment();
  const plan = savedStackPlan(deployment.id, buildId);
  await context.delivery.recordTofuPlan(plan, testExecutor);
  const rejection = {
    decision: "rejected" as const,
    planDigest: plan.receipt.planDigest,
    reason: "deletes the apex record",
  };
  await expect(
    context.delivery.approveTofuPlan(deployment.id, rejection, {
      id: "bot",
      kind: "machine",
      scopes: ["read", "approve"],
    }),
  ).rejects.toThrow(/Machine credentials cannot approve/u);
  const app = createTestApp(context.delivery, {
    machineCredentials: [],
    writesEnabled: () => Promise.resolve(true),
    enabledEnvironments: () => Promise.resolve(["tofu-cloudflare/prod"]),
  });
  const decide = (body: unknown) =>
    app.request(
      `/api/v1/deployments/${encodeURIComponent(deployment.id)}/plan-approval`,
      {
        method: "POST",
        headers: {
          "Tailscale-User-Login": testOperator.id,
          Origin: "http://delivery.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
  // The decision is explicit: a body without one is refused.
  const undecided = await decide({
    planDigest: rejection.planDigest,
    reason: "no",
  });
  expect(undecided.status).toBe(400);
  const response = await decide(rejection);
  expect(response.status).toBe(200);
  expect(StageSchema.parse(await response.json())).toMatchObject({
    key: "approve/plan",
    status: "failed",
    operationId: plan.receipt.planDigest,
    message: `Rejected by ${testOperator.id}`,
  });
  expect(
    await db.approval.findUniqueOrThrow({
      where: { deploymentId: deployment.id },
    }),
  ).toMatchObject({
    status: "rejected",
    actor: testOperator.id,
    reason: rejection.reason,
    boundFingerprint: fingerprint({
      selection: selectionFingerprint(
        deployment.versionSetRevisionId,
        deployment.pipelineRevisionId,
        deployment.configurationId,
      ),
      planDigest: plan.receipt.planDigest,
      state: plan.receipt.state,
    }),
  });
  // The plan is discarded and never saved again.
  await expect(
    context.delivery.tofuPlan(deployment.id, testExecutor),
  ).rejects.toThrow(/saved platform plan/u);
  await expect(
    context.delivery.recordTofuPlan(plan, testExecutor),
  ).rejects.toThrow(/rejected and discarded/u);
  // One decision per deployment: only the identical rejection repeats.
  await expect(
    context.delivery.approveTofuPlan(
      deployment.id,
      { ...rejection, decision: "approved" },
      testOperator,
    ),
  ).rejects.toThrow(/already been decided/u);
  await expect(
    context.delivery.approveTofuPlan(deployment.id, rejection, testOperator),
  ).resolves.toMatchObject({ key: "approve/plan", status: "failed" });
  // The executor settles its steps (none left running) and finishes failed.
  expect(
    await db.platformLock.count({ where: { deploymentId: deployment.id } }),
  ).toBe(1);
  for (const [key, status] of [
    ["step-plan", "succeeded"],
    ["step-approve", "failed"],
  ] as const)
    await context.delivery.stage(
      deployment.id,
      {
        key,
        status,
        operationId: key === "step-plan" ? stackPlanJob.name : deployment.id,
        message: `${key}: ${status}`,
        evidence: [],
      },
      testExecutor,
    );
  await context.delivery.finish(
    deployment.id,
    {
      status: "failed",
      message: "Saved plan was rejected; nothing was applied",
      recoveryRequired: false,
      evidence: [],
    },
    testExecutor,
  );
  expect(
    await db.platformLock.count({ where: { deploymentId: deployment.id } }),
  ).toBe(0);
  expect(
    await db.targetLock.count({ where: { deploymentId: deployment.id } }),
  ).toBe(0);
  expect(
    await db.environment.findUniqueOrThrow({
      where: { id: "tofu-cloudflare/prod" },
    }),
  ).toMatchObject({ activeDeploymentId: null, acceptedDeploymentId: null });
});

test("an executor cannot record the plan approval its approve step waits on", async () => {
  const { deployment } = await runningStackDeployment();
  const token = "test-plan-stage-executor-credential-0000";
  const app = createTestApp(context.delivery, {
    machineCredentials: [{ token, principal: testExecutor }],
    writesEnabled: () => Promise.resolve(true),
    enabledEnvironments: () => Promise.resolve(["tofu-cloudflare/prod"]),
  });
  const write = (key: string) =>
    app.request(
      `/api/v1/deployments/${encodeURIComponent(deployment.id)}/stages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key,
          status: "succeeded",
          operationId: `sha256:${"7".repeat(64)}`,
          message: "Approved by the executor",
          evidence: [],
        }),
      },
    );
  const refused = await write("approve/plan");
  expect(refused.status).toBe(403);
  expect(
    await context.cluster.database.stage.findUnique({
      where: {
        deploymentId_key: { deploymentId: deployment.id, key: "approve/plan" },
      },
    }),
  ).toBeNull();
  // Ordinary step stages still record through the same route.
  const recorded = await write("step-apply-safety");
  expect(recorded.status).toBe(200);
});

test("an application deployment takes no plan approval", async () => {
  const deployment = await requestOnProd(context, "deploy");
  await expect(
    context.delivery.approveTofuPlan(
      deployment.id,
      {
        decision: "rejected",
        planDigest: `sha256:${"7".repeat(64)}`,
        reason: "looked",
      },
      testOperator,
    ),
  ).rejects.toThrow(/Only a model tofu recipe/u);
});
