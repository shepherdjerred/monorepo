import { expect } from "vitest";
import { z } from "zod";
import type { TestWorkflowEnvironment } from "@temporalio/testing";
import type { createPerEpisodeNativeRecoveryFixtureV1 } from "@shepherdjerred/media/testing/per-episode-native-recovery";
import type { NativeCompensationActivityInput } from "@shepherdjerred/media/native-compensation";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { nativeSeriesPackPaidV1 } from "./native-recovery-phases.ts";

type Fixture = Awaited<
  ReturnType<typeof createPerEpisodeNativeRecoveryFixtureV1>
>;

/** An actual outbox starts the previous root without a Workflow poller. The
 * SDK therefore proves RUNNING and later its exact terminated run; no direct
 * operation-status write or fabricated terminal observation authorizes retry. */
export async function retryNativeSeriesPackCoordinatorV1(
  scenario: Fixture,
  environment: TestWorkflowEnvironment,
  input: {
    phase: "physical" | "publication";
    effect: NativeCompensationActivityInput;
  },
  charges: { method: string; paid: number }[],
) {
  const { effect, phase } = input;
  const before =
    await scenario.db.nativePublicationCompensationContinuation.findUniqueOrThrow(
      {
        where: { id: effect.continuationId },
      },
    );
  const beforeCommands = await scenario.db.operation.count();
  const workflowType =
    phase === "physical"
      ? "compensateSeriesPackNativePublicationV1Workflow"
      : "publishSeriesPackNativeCompensationV1Workflow";
  const dispatched = await scenario.dispatch(async (start) => {
    if (start.input["operationId"] !== effect.operationId)
      throw new Error("Unrelated commands remain queued");
    expect(start.workflowType).toBe(workflowType);
    expect(start.input).toEqual(effect);
    await environment.client.connection.withDeadline(Date.now() + 20_000, () =>
      environment.client.workflow.start(start.workflowType, {
        workflowId: start.workflowId,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [start.input],
      }),
    );
  });
  expect(dispatched.dispatched).toBe(1);
  const handle = environment.client.workflow.getHandle(
    `media-operation-${effect.operationId}`,
  );
  const running = await handle.describe();
  expect(running.status.name).toBe("RUNNING");
  await expect(
    scenario.nativeRetry(before.id, crypto.randomUUID(), before.version),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    scenario.nativeUnknownRetry(before.id, before.version),
  ).rejects.toMatchObject({ status: 409 });
  expect(await scenario.db.operation.count()).toBe(beforeCommands);
  await environment.client.workflow
    .getHandle(running.workflowId, running.runId, { followRuns: false })
    .terminate("Exact owned native recovery retry acceptance");
  const closed = await handle.describe();
  expect(closed).toMatchObject({ runId: running.runId });
  expect(closed.status.name).toBe("TERMINATED");
  await expect(
    scenario.nativeRetry(before.id, crypto.randomUUID(), before.version + 1),
  ).rejects.toMatchObject({ status: 409 });
  expect(await scenario.db.operation.count()).toBe(beforeCommands);
  const key = crypto.randomUUID();
  const queued = await nativeSeriesPackPaidV1(
    `owner_${phase}_retry`,
    charges,
    () => scenario.nativeRetry(before.id, key, before.version),
  );
  expect(await scenario.nativeRetry(before.id, key, before.version)).toEqual(
    queued,
  );
  const operationId = z.uuid().parse(queued.operationId);
  expect(operationId).not.toBe(effect.operationId);
  expect(await scenario.db.operation.count()).toBe(beforeCommands + 1);
  const command = await scenario.db.operation.findUniqueOrThrow({
    where: { id: operationId },
    include: { outbox: true },
  });
  expect(command.result).toMatchObject({
    seriesPackNativeRetryV1: {
      phase,
      continuationId: before.id,
      descriptorHash: before.descriptorHash,
      previousVersion: before.version,
      operationId,
      previousWorkflowClosed: {
        operationId: effect.operationId,
        workflowId: running.workflowId,
        runId: running.runId,
        status: "TERMINATED",
      },
    },
  });
  expect(command.outbox?.dispatchedAt).toBeNull();
  expect(command.outbox?.availableAt.getTime()).toBeLessThanOrEqual(Date.now());
  const after =
    await scenario.db.nativePublicationCompensationContinuation.findUniqueOrThrow(
      {
        where: { id: before.id },
      },
    );
  expect(after).toMatchObject({
    version: before.version + 1,
    descriptor: before.descriptor,
    descriptorHash: before.descriptorHash,
    executionEvidence: before.executionEvidence,
    completion: before.completion,
    createdAt: before.createdAt,
    [phase === "physical"
      ? "coordinatorOperationId"
      : "publicationCoordinatorOperationId"]: operationId,
  });
  await expect(
    scenario.db.operation.update({
      where: { id: operationId },
      data: { result: {} },
    }),
  ).rejects.toThrow("immutable");
  await expect(
    scenario.db.nativePublicationCompensationContinuation.update({
      where: { id: before.id },
      data:
        phase === "physical"
          ? {
              coordinatorOperationId: effect.operationId,
              version: { increment: 1 },
            }
          : {
              publicationCoordinatorOperationId: effect.operationId,
              version: { increment: 1 },
            },
    }),
  ).rejects.toThrow();
  return { ...effect, operationId };
}
