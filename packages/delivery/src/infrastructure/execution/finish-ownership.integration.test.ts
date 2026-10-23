import { expect, test } from "vitest";
import {
  claimedSelfHostedDeployment,
  useDeliveryFixture,
} from "#testing/delivery-fixture.ts";
import { testExecutor } from "#testing/seed.ts";
import { deliverySuccessorWorkflowId } from "#shared/contract.ts";

const context = useDeliveryFixture();

const failed = {
  status: "failed" as const,
  message: "Deployment stopped",
  recoveryRequired: false,
  evidence: [],
};

test("only the owning executor finishes, and a handoff waits for its successor (D7, D8)", async () => {
  const { deployment, owner } = await claimedSelfHostedDeployment(
    context,
    "finish-ownership",
  );
  const finish = (executor?: typeof owner) =>
    context.delivery.finish(
      deployment.id,
      { ...failed, ...(executor === undefined ? {} : { executor }) },
      testExecutor,
    );
  const notOwner = /Only the executor that owns the deployment/u;
  // The shared execute credential alone, or another identity, proves nothing.
  await expect(finish()).rejects.toThrow(notOwner);
  await expect(
    finish({ workflowId: "delivery/other", workflowRunId: "run-9" }),
  ).rejects.toThrow(notOwner);
  // Handed off, the deployment waits for its successor's claim, even from
  // the outgoing executor.
  await context.delivery.handOff(deployment.id, owner, testExecutor);
  await expect(finish(owner)).rejects.toThrow(/successor executor claims it/u);
  // Only the successor Workflow takes a handoff, through its own claim (D8).
  const successor = {
    workflowId: deliverySuccessorWorkflowId(deployment.id),
    workflowRunId: "successor-1",
  };
  await context.delivery.claimHandoff(deployment.id, successor, testExecutor);
  // The predecessor never settles it after the takeover.
  await expect(finish(owner)).rejects.toThrow(notOwner);
  await expect(finish(successor)).resolves.toMatchObject({ status: "failed" });
  // A replay of the recorded result answers without reproving ownership.
  await expect(finish(successor)).resolves.toMatchObject({ status: "failed" });
});
