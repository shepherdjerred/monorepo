import { describe, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { DdnsActivities, DdnsSyncResult } from "#activities/infra/ddns.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runDdnsSyncWorkflow } from "./ddns-workflow.ts";

describe("runDdnsSyncWorkflow", () => {
  test("dispatches syncDdnsRecords onto the infra task queue and returns its result", async () => {
    const testEnv = await TestWorkflowEnvironment.createTimeSkipping();
    try {
      const expected: DdnsSyncResult = {
        observedAt: "2026-11-25T02:00:00.000Z",
        ipv4: "203.0.113.42",
        ipv6: "2001:db8::42",
        targets: [
          {
            target: "ddns.sjer.red",
            action: "unchanged",
            records: [],
          },
          {
            target: "ipv4.ddns.sjer.red",
            action: "unchanged",
            records: [],
          },
        ],
      };

      const activities: DdnsActivities = {
        syncDdnsRecords: () => Promise.resolve(expected),
      };

      const workflowWorker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowsPath: new URL("../index.ts", import.meta.url).pathname,
      });
      const infraWorker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: TASK_QUEUES.INFRA,
        activities,
      });

      const result = await workflowWorker.runUntil(() =>
        infraWorker.runUntil(() =>
          testEnv.client.workflow.execute(runDdnsSyncWorkflow, {
            taskQueue: TASK_QUEUES.WORKFLOWS,
            workflowId: "test-ddns-sync",
          }),
        ),
      );

      expect(result).toEqual(expected);
    } finally {
      await testEnv.teardown();
    }
  }, 30_000);
});
