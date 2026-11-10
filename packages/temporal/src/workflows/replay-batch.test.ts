import { randomUUID } from "node:crypto";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { replayTemporalHistoryBatch } from "@shepherdjerred/root-scripts/temporal-replay.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

const fixture = (name: string) =>
  new URL(`replay-fixtures/${name}`, import.meta.url).pathname;

describe("candidate history replay with one bundle", () => {
  let environment: TestWorkflowEnvironment | undefined;

  beforeAll(async () => {
    environment = await TestWorkflowEnvironment.createTimeSkipping();
  }, 60_000);

  afterAll(async () => {
    if (environment === undefined)
      throw new Error("Temporal test environment was never created");
    await environment.teardown();
  });

  it("reports every history and fails the run when one history is nondeterministic", async () => {
    if (environment === undefined)
      throw new Error("Temporal test environment is unavailable");
    const client = environment.client;
    const taskQueue = `replay-batch-${randomUUID()}`;
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue,
      workflowsPath: fixture("replay-batch-before.ts"),
      activities: { completeReplayBatchProbe: (step: string) => step },
    });
    const types = [
      "replayBatchStableProbe",
      "replayBatchChangedProbe",
      "replayBatchStableProbe",
    ] as const;
    const executions = await worker.runUntil(async () => {
      const started = [];
      for (const type of types) {
        const handle = await client.workflow.start(type, {
          taskQueue,
          workflowId: `${type}-${randomUUID()}`,
        });
        await handle.result();
        started.push({
          workflowId: handle.workflowId,
          runId: z.uuid().parse(handle.firstExecutionRunId),
        });
      }
      return started;
    });
    const histories = await Promise.all(
      executions.map(async ({ workflowId, runId }, index) => ({
        workflowId,
        // The last target asks for the latest run, as a bare Workflow ID does.
        runId: index === executions.length - 1 ? undefined : runId,
        history: await client.workflow
          .getHandle(workflowId, runId)
          .fetchHistory(),
      })),
    );
    const lines: string[] = [];
    const log = (line: string) => {
      lines.push(line);
    };

    const outcomes = await replayTemporalHistoryBatch({
      histories,
      workflowsPath: fixture("replay-batch-before.ts"),
      log,
    });
    expect(outcomes).toEqual(
      executions.map(({ workflowId, runId }) => ({
        workflowId,
        runId,
        error: undefined,
      })),
    );

    lines.length = 0;
    const [, changed] = executions;
    if (changed === undefined) throw new Error("Missing changed execution");
    await expect(
      replayTemporalHistoryBatch({
        histories,
        workflowsPath: fixture("replay-batch-after.ts"),
        log,
      }),
    ).rejects.toThrow(
      `Replay failed for 1 of 3 histories: ${changed.workflowId}/${changed.runId} (DeterminismViolationError`,
    );
    expect(
      lines.map((line) =>
        z
          .object({
            kind: z.literal("temporal-replay-history"),
            workflowId: z.string(),
            runId: z.uuid(),
            outcome: z.enum(["passed", "failed"]),
          })
          .parse(JSON.parse(line)),
      ),
    ).toEqual(
      executions.map(({ workflowId, runId }, index) => ({
        kind: "temporal-replay-history",
        workflowId,
        runId,
        outcome: index === 1 ? "failed" : "passed",
      })),
    );
  }, 60_000);
});
