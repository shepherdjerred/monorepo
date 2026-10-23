import { describe, expect, test } from "vitest";
import {
  fingerprint,
  selectionFingerprint,
} from "#infrastructure/delivery-records.ts";
import { approvalById } from "#infrastructure/selection/views.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import {
  requestStackDeployment,
  savedStackPlan,
  startStackPlan,
} from "#testing/tofu-stack-fixture.ts";

/**
 * D6 and 4.13: a tofu recipe with an approve step takes its one approval at
 * the plan, which satisfies a `required` policy; an override of its
 * selection rules (H4) is cleared separately, before the plan runs.
 */
const context = useDeliveryFixture();
const db = () => context.cluster.database;

/** Records the stack deployment's saved plan and decides it at the approve step. */
async function decidePlan(
  deployment: {
    id: string;
    versionSetRevisionId: string;
    pipelineRevisionId: string;
    configurationId: string;
  },
  buildId: string,
  decision: { decision: "approved" | "rejected"; reason: string },
) {
  const plan = savedStackPlan(deployment.id, buildId);
  await startStackPlan(context, deployment.id);
  await context.delivery.recordTofuPlan(plan, testExecutor);
  const settled = await context.delivery.approveTofuPlan(
    deployment.id,
    { ...decision, planDigest: plan.receipt.planDigest },
    testOperator,
  );
  const row = await db().approval.findUniqueOrThrow({
    where: { deploymentId: deployment.id },
  });
  // The one decision binds the selection, the plan digest and its state.
  expect(row.boundFingerprint).toBe(
    fingerprint({
      selection: selectionFingerprint(
        deployment.versionSetRevisionId,
        deployment.pipelineRevisionId,
        deployment.configurationId,
      ),
      planDigest: plan.receipt.planDigest,
      state: plan.receipt.state,
    }),
  );
  return settled;
}

describe("a required tofu environment", () => {
  test.each([
    ["approved", "granted", "succeeded"],
    ["rejected", "rejected", "failed"],
  ] as const)(
    "takes its one approval at the plan, not at selection: %s",
    async (decision, status, stage) => {
      const { deployment, buildId } = await requestStackDeployment(context, {
        approvalPolicy: "required",
      });
      // The policy is met at the approve step, so the request queues.
      expect(deployment.status).toBe("queued");
      expect(
        await db().approval.findUnique({
          where: { deploymentId: deployment.id },
        }),
      ).toBeNull();
      await expect(
        context.delivery.approve(
          deployment.id,
          { decision: "approve", reason: "looks right" },
          testOperator,
        ),
      ).rejects.toThrow(/plan decision at the approve step/u);
      const settled = await decidePlan(deployment, buildId, {
        decision,
        reason: "one DNS record, reviewed",
      });
      expect(settled).toMatchObject({ key: "approve/plan", status: stage });
      expect(await approvalById(db(), deployment.id)).toMatchObject({
        status,
        override: false,
        actor: testOperator.id,
        reason: "one DNS record, reviewed",
        overrideDecision: null,
      });
    },
  );
});

test("a non-eligible tofu deploy clears its override before the plan runs, then takes its one decision at the plan (H4)", async () => {
  const { deployment, buildId } = await requestStackDeployment(context, {
    approvalPolicy: "required",
    override: true,
  });
  expect(deployment.status).toBe("awaiting_approval");
  expect(await approvalById(db(), deployment.id)).toMatchObject({
    status: "pending",
    override: true,
    overrideDecision: null,
  });
  const clear = {
    decision: "approve" as const,
    reason: "reviewed the old lineage",
    override: true,
  };
  await expect(
    context.delivery.approve(
      deployment.id,
      { ...clear, override: false },
      testOperator,
    ),
  ).rejects.toThrow(/needs an approval marked override/u);
  await expect(
    context.delivery.approve(deployment.id, clear, testOperator),
  ).resolves.toMatchObject({ status: "queued" });
  // Clearing the override repeats; it is not the deployment's decision.
  await expect(
    context.delivery.approve(deployment.id, clear, testOperator),
  ).resolves.toMatchObject({ status: "queued" });
  await expect(
    context.delivery.approve(
      deployment.id,
      { ...clear, decision: "reject" },
      testOperator,
    ),
  ).rejects.toThrow(/already been decided/u);
  expect(await approvalById(db(), deployment.id)).toMatchObject({
    status: "pending",
    override: true,
    actor: null,
    reason: null,
    overrideDecision: { actor: testOperator.id, reason: clear.reason },
  });
  await decidePlan(deployment, buildId, {
    decision: "approved",
    reason: "one DNS record, reviewed",
  });
  expect(await approvalById(db(), deployment.id)).toMatchObject({
    status: "granted",
    override: true,
    actor: testOperator.id,
    reason: "one DNS record, reviewed",
    overrideDecision: { actor: testOperator.id, reason: clear.reason },
  });
});

test("a rejected override ends a non-eligible tofu deploy before any plan", async () => {
  const { deployment } = await requestStackDeployment(context, {
    override: true,
  });
  const canceled = await context.delivery.approve(
    deployment.id,
    { decision: "reject", reason: "the old lineage is unsafe", override: true },
    testOperator,
  );
  expect(canceled.status).toBe("canceled");
  expect(await approvalById(db(), deployment.id)).toMatchObject({
    status: "rejected",
    override: true,
    overrideDecision: null,
  });
});

test("a deploy whose saved plan expired undecided ends failed and expires its pending approval", async () => {
  const { deployment, buildId } = await requestStackDeployment(context, {
    approvalPolicy: "required",
    override: true,
  });
  await context.delivery.approve(
    deployment.id,
    {
      decision: "approve",
      reason: "reviewed the old lineage",
      override: true,
    },
    testOperator,
  );
  const plan = savedStackPlan(deployment.id, buildId);
  await startStackPlan(context, deployment.id);
  await context.delivery.recordTofuPlan(plan, testExecutor);
  // The approve step stops waiting once the plan expired and ends the deploy.
  await context.delivery.finish(
    deployment.id,
    {
      status: "failed",
      message: "Saved plan expired before a decision; nothing was applied",
      evidence: [],
      recoveryRequired: false,
    },
    testExecutor,
  );
  expect(await approvalById(db(), deployment.id)).toMatchObject({
    status: "expired",
    override: true,
    actor: null,
    overrideDecision: { actor: testOperator.id },
  });
  // The ended deploy takes no late decision.
  await expect(
    context.delivery.approveTofuPlan(
      deployment.id,
      {
        decision: "rejected",
        reason: "too late",
        planDigest: plan.receipt.planDigest,
      },
      testOperator,
    ),
  ).rejects.toThrow(/already been decided/u);
});
