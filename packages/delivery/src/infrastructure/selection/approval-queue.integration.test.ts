import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import {
  requestStackDeployment,
  savedStackPlan,
  startStackPlan,
} from "#testing/tofu-stack-fixture.ts";
import { approvalQueue } from "./views.ts";

const context = useDeliveryFixture();

test("a saved plan waiting on its decision is in the approval queue until decided (H6)", async () => {
  const { deployment, buildId } = await requestStackDeployment(context);
  await startStackPlan(context, deployment.id);
  const plan = savedStackPlan(deployment.id, buildId);
  await context.delivery.recordTofuPlan(plan, testExecutor);
  const stage = (key: string, status: "running" | "succeeded") =>
    context.delivery.stage(
      deployment.id,
      {
        key,
        status,
        operationId:
          key === "step-plan" ? plan.receipt.nativeJob.name : deployment.id,
        message: key,
        evidence: [],
      },
      testExecutor,
    );
  await stage("step-plan", "succeeded");
  const queued = async () => {
    const items = await approvalQueue(context.cluster.database);
    return items.find((item) => item.id === deployment.id);
  };
  // Planned, but the approve step has not started waiting yet.
  expect(await queued()).toBeUndefined();
  await stage("step-approve", "running");
  expect(await queued()).toMatchObject({
    status: "running",
    approval: null,
    awaitingPlanDecision: true,
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
  // Decided, it moves to the recently decided approvals.
  expect(await queued()).toMatchObject({
    awaitingPlanDecision: false,
    approval: { status: "granted" },
  });
});
