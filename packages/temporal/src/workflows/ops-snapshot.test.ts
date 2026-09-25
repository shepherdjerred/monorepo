import { describe, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { SOURCE_IDS } from "@shepherdjerred/ops-model/snapshot.ts";
import type {
  OpsCollectorOutcome,
  OpsPublishSummary,
} from "#activities/ops/ops-publish.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  OPS_COLLECTORS,
  runOpsDigest,
  runOpsSnapshot,
} from "./ops-snapshot.ts";
import { runWorkflowWithActivityWorker } from "./test-support.ts";

const workflowPath = new URL("index.ts", import.meta.url).pathname;

const summary: OpsPublishSummary = {
  generatedAt: "2026-09-24T12:00:00.000Z",
  severity: "unknown",
  summary: "1 area needs attention",
  failedSources: ["linear"],
  signals: 0,
  changes: 0,
};

function collectorActivities(attempts: Map<string, number>) {
  return Object.fromEntries(
    OPS_COLLECTORS.map(([source, name]) => [
      name,
      () => {
        attempts.set(source, (attempts.get(source) ?? 0) + 1);
        if (source === "linear") {
          throw new Error("linear: HTTP 401");
        }
        return Promise.resolve({
          status: {
            source,
            ok: true,
            observedAt: "2026-09-24T12:00:00.000Z",
            durationMs: 1,
          },
          signals: [],
          metrics: [],
          changes: [],
        });
      },
    ]),
  );
}

describe("ops snapshot workflow", () => {
  test("the collector list covers every source exactly once", () => {
    expect(OPS_COLLECTORS.map(([source]) => source).toSorted()).toEqual(
      [...SOURCE_IDS].toSorted(),
    );
  });

  test("isolates a failing source and publishes the rest", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const attempts = new Map<string, number>();
    const published: OpsCollectorOutcome[][] = [];
    try {
      const result = await runWorkflowWithActivityWorker(environment, {
        activityTaskQueue: TASK_QUEUES.INFRA,
        workflowPath,
        activities: {
          ...collectorActivities(attempts),
          assembleAndPublishOpsSnapshot: (input: {
            outcomes: OpsCollectorOutcome[];
          }) => {
            published.push(input.outcomes);
            return Promise.resolve(summary);
          },
        },
        execute: () =>
          environment.client.workflow.execute(runOpsSnapshot, {
            args: [],
            taskQueue: TASK_QUEUES.WORKFLOWS,
            workflowId: `test-ops-snapshot-${crypto.randomUUID()}`,
          }),
      });
      expect(result).toEqual(summary);
      const outcomes = published[0] ?? [];
      expect(outcomes).toHaveLength(SOURCE_IDS.length);
      expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
        { source: "linear", ok: false, error: "linear: HTTP 401" },
      ]);
      expect(attempts.get("linear")).toBe(2);
      expect(attempts.get("alerts")).toBe(1);
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  test("a publish failure fails the run after bounded retries", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    let publishAttempts = 0;
    try {
      await expect(
        runWorkflowWithActivityWorker(environment, {
          activityTaskQueue: TASK_QUEUES.INFRA,
          workflowPath,
          activities: {
            ...collectorActivities(new Map()),
            assembleAndPublishOpsSnapshot: () => {
              publishAttempts += 1;
              throw new Error("POST returned HTTP 503");
            },
          },
          execute: () =>
            environment.client.workflow.execute(runOpsSnapshot, {
              args: [],
              taskQueue: TASK_QUEUES.WORKFLOWS,
              workflowId: `test-ops-snapshot-fail-${crypto.randomUUID()}`,
            }),
        }),
      ).rejects.toThrow("Workflow execution failed");
      expect(publishAttempts).toBe(3);
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  test("the digest workflow triggers its kind on the infra queue", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const kinds: string[] = [];
    try {
      await expect(
        runWorkflowWithActivityWorker(environment, {
          activityTaskQueue: TASK_QUEUES.INFRA,
          workflowPath,
          activities: {
            triggerOpsDigest: (kind: string) => {
              kinds.push(kind);
              return Promise.resolve({ kind });
            },
          },
          execute: () =>
            environment.client.workflow.execute(runOpsDigest, {
              args: [{ kind: "daily" }],
              taskQueue: TASK_QUEUES.WORKFLOWS,
              workflowId: `test-ops-digest-${crypto.randomUUID()}`,
            }),
        }),
      ).resolves.toEqual({ kind: "daily" });
      expect(kinds).toEqual(["daily"]);
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
