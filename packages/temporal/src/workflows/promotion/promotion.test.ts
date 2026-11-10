import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runWorkflowWithActivityWorker } from "#workflows/test-support.ts";
import { promotionReport } from "#activities/promotion/report.ts";
import { initialPromotionState } from "#shared/promotion/model.ts";
import {
  ReportEnvelopeV1Schema,
  type ReportEnvelopeV1,
} from "#shared/reports/report.ts";

describe("promotion report delivery keys", () => {
  it.each(["reportStormPromotion", "reportStormPromotionAcceptance"])(
    "%s preserves collection while selecting its own delivery key",
    async (workflowType) => {
      const environment = await TestWorkflowEnvironment.createTimeSkipping();
      const collected: ReportEnvelopeV1[] = [];
      const delivered: ReportEnvelopeV1[] = [];
      try {
        await runWorkflowWithActivityWorker(environment, {
          workflowPath: new URL("index.ts", import.meta.url).pathname,
          activityTaskQueue: TASK_QUEUES.PROMOTION_CONTROL,
          activities: {
            collectPromotionDailyReport: () => {
              const report = promotionReport(
                [initialPromotionState("pmc", 900)],
                0,
              );
              collected.push(report);
              return report;
            },
          },
          execute: async () => {
            const writer = await Worker.create({
              connection: environment.nativeConnection,
              taskQueue: TASK_QUEUES.REPORTS,
              activities: {
                deliverReport: (input: unknown) => {
                  const report = ReportEnvelopeV1Schema.parse(input);
                  delivered.push(report);
                  return { reportRunId: report.reportRunId };
                },
              },
            });
            return await writer.runUntil(async () => {
              for (let index = 0; index < 2; index++) {
                const handle = await environment.client.workflow.start(
                  workflowType,
                  {
                    workflowId: `promotion-report-fixture-${crypto.randomUUID()}`,
                    taskQueue: TASK_QUEUES.WORKFLOWS,
                    args: [],
                  },
                );
                const { runId } = await handle.describe();
                const result = await handle.result();
                const original = collected[index];
                if (original === undefined)
                  throw new Error("Missing collected report");
                expect(original.reportRunId).toMatch(
                  /^storm-promotion\/daily\/\d{4}-\d{2}-\d{2}$/u,
                );
                const reportRunId =
                  workflowType === "reportStormPromotionAcceptance"
                    ? `storm-promotion/acceptance/${runId}`
                    : original.reportRunId;
                expect(delivered[index]).toEqual({ ...original, reportRunId });
                expect(result).toEqual({ reportRunId });
                const history = await handle.fetchHistory();
                expect(
                  history.events?.flatMap((event) =>
                    event.activityTaskScheduledEventAttributes === undefined ||
                    event.activityTaskScheduledEventAttributes === null
                      ? []
                      : [
                          event.activityTaskScheduledEventAttributes
                            .activityType?.name,
                        ],
                  ),
                ).toEqual(["collectPromotionDailyReport", "deliverReport"]);
              }
            });
          },
        });
        expect(collected).toHaveLength(2);
        expect(delivered).toHaveLength(2);
        if (workflowType === "reportStormPromotionAcceptance")
          expect(
            new Set(delivered.map((report) => report.reportRunId)).size,
          ).toBe(2);
      } finally {
        await environment.teardown();
      }
    },
    60_000,
  );
});

describe("promotion Workflow effects", () => {
  it("waits durably for the evening deadline and closes the batch after its child settles", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const due = (await environment.currentTimeMs()) + 2 * 60 * 60 * 1000;
    const events: string[] = [];
    try {
      await runWorkflowWithActivityWorker(environment, {
        workflowPath: new URL("index.ts", import.meta.url).pathname,
        activityTaskQueue: TASK_QUEUES.PROMOTION_CONTROL,
        activities: {
          inspectPromotionTick: () => ({
            dueTargetIds: ["pmc"],
            reconcileTargetIds: [],
            alerts: [],
            batchId: "fixture",
            notBefore: { pmc: new Date(due).toISOString() },
          }),
          finishPromotionBatch: () => {
            events.push("finished");
          },
        },
        execute: async () => {
          const writer = await Worker.create({
            connection: environment.nativeConnection,
            taskQueue: TASK_QUEUES.PROMOTION,
            activities: {
              executePromotion: async (input: unknown) => {
                expect(input).toMatchObject({
                  targetId: "pmc",
                  scheduled: true,
                  batchId: "fixture",
                });
                expect(
                  await environment.currentTimeMs(),
                ).toBeGreaterThanOrEqual(due);
                events.push("executed");
                return { status: "verified" };
              },
            },
          });
          return await writer.runUntil(() =>
            environment.client.workflow.execute("dispatchStormPromotion", {
              workflowId: `dispatch-fixture-${crypto.randomUUID()}`,
              taskQueue: TASK_QUEUES.WORKFLOWS,
              args: [],
            }),
          );
        },
      });
      expect(events).toEqual(["executed", "finished"]);
    } finally {
      await environment.teardown();
    }
  }, 60_000);
  it("never retries a browser agent after an ambiguous Activity failure", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    let calls = 0;
    try {
      await expect(
        runWorkflowWithActivityWorker(environment, {
          workflowPath: new URL("index.ts", import.meta.url).pathname,
          activityTaskQueue: TASK_QUEUES.PROMOTION,
          activities: {
            executePromotion: () => {
              calls++;
              throw new Error("Ambiguous remote submission");
            },
          },
          execute: () =>
            environment.client.workflow.execute("runStormPromotion", {
              workflowId: `storm-promotion/test-${crypto.randomUUID()}`,
              taskQueue: TASK_QUEUES.WORKFLOWS,
              args: [{ targetId: "pmc", mode: "run" }],
            }),
        }),
      ).rejects.toThrow("Workflow execution failed");
      expect(calls).toBe(1);
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  it("routes operator control separately from the long-running agent queue", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const received: unknown[] = [];
    try {
      await runWorkflowWithActivityWorker(environment, {
        workflowPath: new URL("index.ts", import.meta.url).pathname,
        activityTaskQueue: TASK_QUEUES.PROMOTION_CONTROL,
        activities: {
          managePromotion: (input: unknown) => {
            received.push(input);
            return [];
          },
        },
        execute: () =>
          environment.client.workflow.execute("manageStormPromotion", {
            workflowId: `promotion-control-${crypto.randomUUID()}`,
            taskQueue: TASK_QUEUES.WORKFLOWS,
            args: [{ operation: "pause", targetId: "pmc" }],
          }),
      });
      expect(received).toEqual([{ operation: "pause", targetId: "pmc" }]);
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
