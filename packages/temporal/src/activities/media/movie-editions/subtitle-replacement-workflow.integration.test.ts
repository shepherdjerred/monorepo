import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { expect, test } from "vitest";
import { createMovieReplacementRoleFixture } from "@shepherdjerred/media/testing/movie-subtitle-replacement-workflow";
import type { SubtitleReplacementInput } from "@shepherdjerred/media/subtitle-replacement";
import { callMovieSubtitleReplacementV2 } from "./subtitle-replacement.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "#activities/media/testing/role-worker.ts";
import { replayMovieReplacementHistory } from "#activities/media/testing/subtitle-replacement-replay.ts";

type Scenario = Awaited<ReturnType<typeof createMovieReplacementRoleFixture>>;

async function startRoles(
  environment: TestWorkflowEnvironment,
  scenario: Scenario,
  roles: { workers: Worker[]; running: Promise<void>[] },
) {
  const network = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "dev",
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    activities: {
      ...scenario.network,
      finishMediaOperation: scenario.finishMediaOperation,
    },
  });
  roles.workers.push(network);
  roles.running.push(network.run());
  const load = () =>
    Promise.resolve({ movieReplacement: scenario.movieReplacement });
  const files = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "dev",
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    activities: {
      prepareSubtitleReplacement: (input: SubtitleReplacementInput) =>
        callMovieSubtitleReplacementV2(
          load,
          "prepareSubtitleReplacement",
          input,
        ),
      applySubtitleReplacement: (input: SubtitleReplacementInput) =>
        callMovieSubtitleReplacementV2(load, "applySubtitleReplacement", input),
      reconcileSubtitleReplacement: (input: SubtitleReplacementInput) =>
        callMovieSubtitleReplacementV2(
          load,
          "reconcileSubtitleReplacement",
          input,
        ),
    },
  });
  roles.workers.push(files);
  roles.running.push(files.run());
}

async function closeRole(input: {
  workers: Worker[];
  running: Promise<void>[];
  workflow: Bun.Subprocess | undefined;
  fixture: Scenario | undefined;
  environment: TestWorkflowEnvironment;
  directory: string;
}) {
  try {
    try {
      for (const worker of input.workers) worker.shutdown();
      await Promise.all(input.running);
    } finally {
      if (input.workflow !== undefined) {
        input.workflow.kill("SIGTERM");
        await input.workflow.exited;
      }
    }
  } finally {
    try {
      await input.fixture?.close();
    } finally {
      await input.environment.teardown();
      await rm(input.directory, { recursive: true, force: true });
    }
  }
}

test("native named caption preparation, interrupted Files swap and owner recovery preserve exact authority and replay all histories", async () => {
  const { temporal, node } = pinnedMovieRuntimes();
  const directory = await mkdtemp(
    path.join(tmpdir(), "media-movie-caption-replacement-role-"),
  );
  const environment = await TestWorkflowEnvironment.createLocal({
    server: {
      executable: { type: "existing-path", path: temporal },
      ip: "127.0.0.1",
      namespace: "dev",
      ui: false,
    },
  });
  let fixture: Scenario | undefined;
  let workflow: Bun.Subprocess | undefined;
  const workers: Worker[] = [];
  const running: Promise<void>[] = [];
  try {
    const descriptions: {
      workflowId: string;
      runId: string;
      status: string;
    }[] = [];
    fixture = await createMovieReplacementRoleFixture(async (workflowId) => {
      const actual = await environment.client.workflow
        .getHandle(workflowId)
        .describe();
      descriptions.push({
        workflowId,
        runId: actual.runId,
        status: actual.status.name,
      });
      return { runId: actual.runId, status: actual.status.name };
    });
    const scenario = fixture;
    const script = new URL(
      "../../../../scripts/media-system/workflow-worker.ts",
      import.meta.url,
    ).pathname;
    const childEnvironment = { PATH: Bun.env["PATH"] ?? "/usr/bin:/bin" };
    workflow = await startMovieWorkflowWorker({
      node,
      script,
      address: environment.address,
      directory,
      childEnvironment,
    });
    await startRoles(environment, scenario, { workers, running });
    const start = async (type: string, input: SubtitleReplacementInput) =>
      environment.client.workflow.start(type, {
        workflowId: `media-operation-${input.operationId}`,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [await scenario.workflowInput(input.operationId)],
      });
    const prepared = await start(
      "prepareSubtitleReplacementWorkflow",
      scenario.prepareInput,
    );
    await environment.client.connection.withDeadline(Date.now() + 15_000, () =>
      prepared.result(),
    );
    const apply = await scenario.approve();
    const before = await scenario.evidence();
    expect(before.row).toMatchObject({ state: "applying", receipt: null });
    scenario.interruptReceipt();
    const applied = await start("applySubtitleReplacementWorkflow", apply);
    await expect(
      environment.client.connection.withDeadline(Date.now() + 25_000, () =>
        applied.result(),
      ),
    ).rejects.toThrow();
    const failedDescription = await applied.describe();
    expect(failedDescription.status.name).toBe("FAILED");
    const interrupted = await scenario.evidence();
    expect(interrupted.row).toMatchObject({
      state: "reconciling",
      reservationActive: true,
      receipt: null,
      snapshot: before.row.snapshot,
    });
    expect(interrupted.target).toBe(interrupted.newChecksum);
    expect(interrupted.publications).toBe(1);
    expect(interrupted.receiptInterruptions).toBeGreaterThanOrEqual(2);
    expect(interrupted.journal).not.toBeNull();
    const recoveryInput = await scenario.recover();
    const preparedDescription = await prepared.describe();
    expect(descriptions).toEqual([
      {
        workflowId: `media-operation-${scenario.prepareInput.operationId}`,
        runId: preparedDescription.runId,
        status: "COMPLETED",
      },
      {
        workflowId: `media-operation-${apply.operationId}`,
        runId: failedDescription.runId,
        status: "FAILED",
      },
    ]);
    const recovered = await start(
      "reconcileSubtitleReplacementWorkflow",
      recoveryInput,
    );
    await environment.client.connection.withDeadline(Date.now() + 15_000, () =>
      recovered.result(),
    );
    const settled = await scenario.evidence();
    expect(settled.row).toMatchObject({
      state: "applied",
      reservationActive: false,
      receipt: { outcome: "installed" },
      snapshot: before.row.snapshot,
    });
    expect(settled.publications).toBe(1);
    expect(settled.journal).toBe(interrupted.journal);
    expect(settled.target).toBe(settled.newChecksum);
    expect(settled.video).toEqual(settled.originalVideo);
    expect(settled.asset).toEqual(settled.originalAsset);
    expect(settled.sourceCommands).toEqual(settled.originalCommands);
    expect(settled.sourcePublications).toEqual(settled.originalPublications);
    expect(settled.choices).toEqual(before.choices);
    expect(settled.requests).toEqual(before.requests);
    expect(settled.adds).toBe(1);
    expect(
      settled.operations.find(
        (operation) => operation.id === recoveryInput.operationId,
      ),
    ).toMatchObject({ status: "completed" });
    for (const [name, handle] of [
      ["caption-prepare", prepared],
      ["caption-failed", applied],
      ["caption-recovery", recovered],
    ] as const) {
      await replayMovieReplacementHistory(await handle.fetchHistory(), {
        node,
        script,
        directory,
        name,
        childEnvironment,
      });
    }
  } finally {
    await closeRole({
      workers,
      running,
      workflow,
      fixture,
      environment,
      directory,
    });
  }
}, 60_000);
