import { expect, test } from "vitest";
import { StageSchema } from "#shared/contract.ts";
import {
  fingerprint,
  selectionFingerprint,
} from "#infrastructure/delivery-records.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { createTestApp } from "#testing/http-app.ts";
import {
  arcadePipeline,
  publishCiRunner,
  requestOnProd,
} from "#testing/model-fixture.ts";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";
import { RecipeDefinitionSchema } from "#shared/model/recipe-contract.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import {
  requestStackDeployment,
  savedStackPlan,
  stackPlanJob,
  startStackPlan,
} from "#testing/tofu-stack-fixture.ts";
import { deploymentDetailV2 } from "#infrastructure/selection/views.ts";

const context = useDeliveryFixture();
/** tofu-cloudflare/prod running a model tofu recipe from its stack archive. */
async function runningStackDeployment() {
  const requested = await requestStackDeployment(context);
  await startStackPlan(context, requested.deployment.id);
  return requested;
}

test("a model tofu deployment records the plan its plan step produced, then takes a human approval of it without renewing the executor's lease", async () => {
  const { deployment, buildId } = await runningStackDeployment();
  const plan = savedStackPlan(deployment.id, buildId);
  await expect(
    context.delivery.recordTofuPlan(
      savedStackPlan(deployment.id, "other-build"),
      testExecutor,
    ),
  ).rejects.toThrow(/frozen source/u);
  await context.delivery.recordTofuPlan(plan, testExecutor);
  // The model detail view shows the saved plan, never its encrypted bytes.
  const view = await deploymentDetailV2(context.delivery, deployment.id);
  expect(view.savedPlan).toEqual(plan.receipt);
  expect(JSON.stringify(view)).not.toContain(plan.encryptedPlan.ciphertext);
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
  // The executor's lease nears its end; the human decision does not renew it (D7).
  const leaseExpiresAt = new Date(Date.now() + 30_000);
  await context.cluster.database.deployment.update({
    where: { id: deployment.id },
    data: { leaseExpiresAt },
  });
  await context.delivery.approveTofuPlan(
    deployment.id,
    {
      decision: "approved",
      planDigest: plan.receipt.planDigest,
      reason: "one DNS record, reviewed",
    },
    testOperator,
  );
  expect(
    await context.cluster.database.deployment.findUniqueOrThrow({
      where: { id: deployment.id },
      select: { leaseExpiresAt: true },
    }),
  ).toEqual({ leaseExpiresAt });
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
  // Deferred platform lock (AI-907): plan + approve never acquired platformLock.
  expect(
    await db.platformLock.count({ where: { deploymentId: deployment.id } }),
  ).toBe(0);
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

test("a model tofu deployment defers the shared platform lock from claim/approve until step-apply starts running (AI-907)", async () => {
  const db = context.cluster.database;
  const { deployment, buildId } = await runningStackDeployment();
  const plan = savedStackPlan(deployment.id, buildId);
  await context.delivery.recordTofuPlan(plan, testExecutor);
  await context.delivery.stage(
    deployment.id,
    {
      key: "step-plan",
      status: "succeeded",
      operationId: stackPlanJob.name,
      message: JSON.stringify({ ...stackPlanJob, requestId: deployment.id }),
      evidence: [],
    },
    testExecutor,
  );
  await context.delivery.stage(
    deployment.id,
    {
      key: "step-approve",
      status: "running",
      operationId: deployment.id,
      message: "step-approve: running",
      evidence: [],
    },
    testExecutor,
  );
  // While parked at step-approve, no shared platform lock is held.
  expect(await db.platformLock.count()).toBe(0);

  // Another sharedLock=platform workload can claim and run concurrently while tofu waits at step-approve.
  await publishCiRunner(context.delivery);
  await db.pipeline.create({
    data: {
      id: "arcade/shared-lock",
      definition: RecipeDefinitionSchema.parse({
        ...recipeFromPipeline(arcadePipeline),
        sharedLock: "platform",
      }),
    },
  });
  await db.environment.update({
    where: { id: "arcade/prod" },
    data: { pipelineRevisionId: "arcade/shared-lock", automatic: false },
  });
  const sharedHolder = await requestOnProd(context, "deploy");
  await context.delivery.claim(sharedHolder.id, testExecutor);
  expect(
    await db.platformLock.findUniqueOrThrow({ where: { id: "platform" } }),
  ).toMatchObject({ deploymentId: sharedHolder.id });

  // Human approves the saved plan; step-approve settles, and step-apply answers BUSY while sharedHolder holds platform.
  await context.delivery.approveTofuPlan(
    deployment.id,
    {
      decision: "approved",
      planDigest: plan.receipt.planDigest,
      reason: "reviewed",
    },
    testOperator,
  );
  await context.delivery.stage(
    deployment.id,
    {
      key: "step-approve",
      status: "succeeded",
      operationId: deployment.id,
      message: "step-approve: succeeded",
      evidence: [],
    },
    testExecutor,
  );
  const applyOperationId = `delivery-${"a".repeat(40)}`;
  await expect(
    context.delivery.stage(
      deployment.id,
      {
        key: "step-apply",
        status: "running",
        operationId: applyOperationId,
        message: "step-apply: running",
        evidence: [],
      },
      testExecutor,
    ),
  ).rejects.toMatchObject({ code: "BUSY" });
  expect(
    await db.stage.findUnique({
      where: {
        deploymentId_key: { deploymentId: deployment.id, key: "step-apply" },
      },
    }),
  ).toBeNull();

  // Once sharedHolder finishes and releases platform, step-apply acquires platformLock cleanly.
  await context.delivery.finish(
    sharedHolder.id,
    {
      status: "succeeded",
      message: "Shared holder accepted",
      observedRevisionId: sharedHolder.versionSetRevisionId,
      recoveryRequired: false,
      evidence: [
        { kind: "reconciliation", summary: "synced" },
        { kind: "acceptance", summary: "healthy" },
      ],
    },
    testExecutor,
  );
  expect(await db.platformLock.count()).toBe(0);

  await context.delivery.stage(
    deployment.id,
    {
      key: "step-apply",
      status: "running",
      operationId: applyOperationId,
      message: "step-apply: running",
      evidence: [],
    },
    testExecutor,
  );
  expect(
    await db.platformLock.findUniqueOrThrow({ where: { id: "platform" } }),
  ).toMatchObject({ deploymentId: deployment.id });
});
