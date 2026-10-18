import { expect, test, vi } from "vitest";
import { NativeArchiveSupersessionTargetSchema } from "#shared/native-recovery/archive.ts";
import { observeSupersededCoordinators } from "./coordinators.ts";

const target = NativeArchiveSupersessionTargetSchema.parse({
  continuationId: crypto.randomUUID(),
  receiptId: crypto.randomUUID(),
  originalCleanupId: crypto.randomUUID(),
  version: 3,
  descriptorHash: "a".repeat(64),
  coordinatorOperationId: crypto.randomUUID(),
  executionHash: null,
});
function execution() {
  const controller = new AbortController();
  return {
    controller,
    signal: controller.signal,
    assertActive: () => controller.signal.throwIfAborted(),
    checkpoint: () => Promise.resolve(),
  };
}

test("historical archive scopes neither describe workflows nor add empty authority", async () => {
  const describeWorkflow = vi.fn(() => Promise.resolve(null));
  expect(
    await observeSupersededCoordinators({ describeWorkflow }, {}, execution()),
  ).toBeUndefined();
  expect(describeWorkflow).not.toHaveBeenCalled();
});

test.each(["RUNNING", "CONTINUED_AS_NEW", "UNKNOWN"] as const)(
  "%s is not stopped coordinator proof",
  async (status) => {
    await expect(
      observeSupersededCoordinators(
        { describeWorkflow: () => Promise.resolve({ status, runId: "run" }) },
        { supersessions: [target] },
        execution(),
      ),
    ).rejects.toThrow("native_archive_previous_workflow_not_closed");
  },
);

test("terminal observation binds the exact old coordinator and run; cancellation discards a late result", async () => {
  const describeWorkflow = vi.fn(() =>
    Promise.resolve({ status: "COMPLETED" as const, runId: "exact-run" }),
  );
  const result = await observeSupersededCoordinators(
    { describeWorkflow },
    { supersessions: [target] },
    execution(),
  );
  expect(describeWorkflow).toHaveBeenCalledWith(
    `media-operation-${target.coordinatorOperationId}`,
  );
  expect(result?.[0]).toMatchObject({
    continuationId: target.continuationId,
    closedCoordinator: {
      operationId: target.coordinatorOperationId,
      workflowId: `media-operation-${target.coordinatorOperationId}`,
      runId: "exact-run",
      status: "COMPLETED",
    },
  });
  const active = execution();
  const pending = Promise.withResolvers<{
    status: "COMPLETED";
    runId: string;
  }>();
  const observing = observeSupersededCoordinators(
    { describeWorkflow: () => pending.promise },
    { supersessions: [target] },
    active,
  );
  active.controller.abort(new Error("expired while describing"));
  pending.resolve({ status: "COMPLETED", runId: "late" });
  await expect(observing).rejects.toThrow("expired while describing");
});
