import { expect, test, vi } from "vitest";
import { deliveryWorkflowId } from "@shepherdjerred/delivery/contract";
import { trmnlRepairClaim } from "./trmnl-repair.ts";

test("repair renews the closed original Workflow proof at the current claimed generation", async () => {
  const inspect = vi.fn(async (id: string) => ({
    workflowId: deliveryWorkflowId(id),
    status: "FAILED" as const,
  }));
  const detail = {
    deployment: {
      kind: "repair-trmnl" as const,
      repairOfDeploymentId: "original/1",
    },
    environment: { generation: 4 },
  };
  const first = await trmnlRepairClaim(detail, inspect);
  expect(first).toMatchObject({
    expectedEnvironmentGeneration: 4,
    sourceWorkflow: {
      workflowId: deliveryWorkflowId("original/1"),
      status: "FAILED",
    },
  });
  detail.environment.generation = 5;
  expect(await trmnlRepairClaim(detail, inspect)).toMatchObject({
    expectedEnvironmentGeneration: 5,
  });
  expect(inspect).toHaveBeenCalledTimes(2);
  expect(Date.parse(first!.observedAt)).toBeGreaterThan(Date.now() - 60_000);
  inspect.mockRejectedValueOnce(
    new Error("Original Workflow is still running"),
  );
  await expect(trmnlRepairClaim(detail, inspect)).rejects.toThrow(
    "still running",
  );
});

test("ordinary releases require no repair proof; missing immutable repair lineage refuses admission", async () => {
  const inspect = vi.fn(async (id: string) => ({
    workflowId: deliveryWorkflowId(id),
    status: "FAILED" as const,
  }));
  await expect(
    trmnlRepairClaim(
      {
        deployment: { kind: "deploy", repairOfDeploymentId: null },
        environment: { generation: 0 },
      },
      inspect,
    ),
  ).resolves.toBeUndefined();
  await expect(
    trmnlRepairClaim(
      {
        deployment: { kind: "repair-trmnl", repairOfDeploymentId: null },
        environment: { generation: 0 },
      },
      inspect,
    ),
  ).rejects.toThrow("immutable prior");
  expect(inspect).not.toHaveBeenCalled();
});
