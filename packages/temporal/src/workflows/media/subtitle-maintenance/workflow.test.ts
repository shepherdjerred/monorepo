import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { SubtitleMaintenanceJobV1 } from "@shepherdjerred/media/subtitle-maintenance";

const workflowsPath = new URL("workflow.ts", import.meta.url).pathname;
const job: SubtitleMaintenanceJobV1 = {
  operationId: "6f2a44d9-c9fa-48e7-a38b-28259a7aa49d",
  assetId: "d4d278d7-36a0-4110-8722-ad02db650a2a",
  language: "en",
  forced: false,
  recoveryEpoch: 0,
  targetAuthority: "a".repeat(64),
};

test.each([false, true])(
  "actual maintenance Workflow measures speech before install, blocked=%s, and replays",
  async (blocked) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const observed: string[] = [];
    const workflow = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath,
    });
    const network = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_NETWORK,
      activities: {
        listSubtitleMaintenanceV1: async () => ({
          assetIds: [job.assetId],
          nextCursor: null,
        }),
        prepareSubtitleMaintenanceV1: async () => [job],
        findMediaSubtitles: async () => {
          observed.push("find");
          return { status: "found", subtitleId: "candidate", reason: null };
        },
        finishMediaOperation: async (input: {
          status: string;
          reason: string | null;
        }) => {
          observed.push("finish");
          expect(input.status).toBe("completed");
          expect(input.reason).toBe(
            blocked ? "subtitle_speech_requires_review" : null,
          );
        },
      },
    });
    const files = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_FILES,
      activities: {
        prepareSubtitleSpeechV1: async () => {
          observed.push("measure");
          return { status: blocked ? "blocked" : "prepared" };
        },
        installMediaSubtitles: async () => {
          observed.push("install");
          return { status: "installed" };
        },
      },
    });
    const networkRun = network.run();
    const fileRun = files.run();
    try {
      const handle = await environment.client.workflow.start(
        "maintainMediaSubtitlesV1Workflow",
        {
          workflowId: crypto.randomUUID(),
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [{ mode: "wanted" }],
        },
      );
      await workflow.runUntil(handle.result());
      expect(observed).toEqual(
        blocked
          ? ["find", "measure", "finish"]
          : ["find", "measure", "install", "finish"],
      );
      await Worker.runReplayHistory(
        { workflowsPath },
        await handle.fetchHistory(),
      );
    } finally {
      network.shutdown();
      files.shutdown();
      await Promise.all([networkRun, fileRun]);
      await environment.teardown();
    }
  },
  60_000,
);
