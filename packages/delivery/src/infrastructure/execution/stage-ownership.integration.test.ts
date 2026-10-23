import { expect, test } from "vitest";
import {
  claimedSelfHostedDeployment,
  useDeliveryFixture,
} from "#testing/delivery-fixture.ts";
import { testExecutor } from "#testing/seed.ts";

const context = useDeliveryFixture();

test("only the owning executor writes stages; a native Job only checkpoints its running stage (D7, D8)", async () => {
  const { deployment, owner } = await claimedSelfHostedDeployment(
    context,
    "stage-ownership",
  );
  const db = context.cluster.database;
  const write = (
    key: string,
    status: "running" | "succeeded",
    executor?: typeof owner,
  ) =>
    context.delivery.stage(
      deployment.id,
      {
        key,
        status,
        operationId: `${key}/operation`,
        message: `${key}: ${status}`,
        evidence: [],
        ...(executor === undefined ? {} : { executor }),
      },
      testExecutor,
    );
  const lease = async () => {
    const row = await db.deployment.findUniqueOrThrow({
      where: { id: deployment.id },
    });
    return row.leaseExpiresAt;
  };
  const notOwner = /Only the executor that owns the deployment/u;
  await expect(write("step-plan", "running", owner)).resolves.toMatchObject({
    key: "step-plan",
  });
  // A write naming no identity, or another one, proves nothing.
  await expect(write("step-sync", "running")).rejects.toThrow(notOwner);
  await expect(
    write("step-sync", "running", {
      workflowId: "delivery/other",
      workflowRunId: "run-9",
    }),
  ).rejects.toThrow(notOwner);
  // The plan step's native Job checkpoints its own running stage without an
  // identity; that proves nothing about the executor, so the lease stays.
  await db.deployment.update({
    where: { id: deployment.id },
    data: { leaseExpiresAt: new Date(Date.now() + 60_000) },
  });
  const before = await lease();
  await expect(write("step-plan", "running")).resolves.toMatchObject({
    key: "step-plan",
    status: "running",
  });
  expect(await lease()).toEqual(before);
  // Settling it is the owner's alone.
  await expect(write("step-plan", "succeeded")).rejects.toThrow(notOwner);
  // Handed off, nothing writes until the successor claims.
  await context.delivery.handOff(deployment.id, owner, testExecutor);
  await expect(write("step-plan", "succeeded", owner)).rejects.toThrow(
    /successor executor claims it/u,
  );
  const successor = { workflowId: "delivery/owner", workflowRunId: "run-2" };
  await context.delivery.claim(
    deployment.id,
    testExecutor,
    undefined,
    successor,
  );
  // The predecessor never writes after the takeover; the successor does.
  await expect(write("step-plan", "succeeded", owner)).rejects.toThrow(
    notOwner,
  );
  await expect(
    write("step-plan", "succeeded", successor),
  ).resolves.toMatchObject({ status: "succeeded" });
  expect(
    await db.stage.count({
      where: { deploymentId: deployment.id, key: "step-sync" },
    }),
  ).toBe(0);
});
