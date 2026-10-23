import { expect, test } from "vitest";
import {
  claimedSelfHostedDeployment,
  useDeliveryFixture,
} from "#testing/delivery-fixture.ts";
import { testExecutor } from "#testing/seed.ts";

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
  const successor = { workflowId: "delivery/owner", workflowRunId: "run-2" };
  await context.delivery.claim(
    deployment.id,
    testExecutor,
    undefined,
    successor,
  );
  // The predecessor never settles it after the takeover.
  await expect(finish(owner)).rejects.toThrow(notOwner);
  await expect(finish(successor)).resolves.toMatchObject({ status: "failed" });
  // A replay of the recorded result answers without reproving ownership.
  await expect(finish(successor)).resolves.toMatchObject({ status: "failed" });
});
