import { describe, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { runWorkflowWithActivityWorker } from "#workflows/test-support.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type {
  RetentionApplyInput,
  RetentionPlanInput,
  RetentionRunInput,
  RetentionRunResult,
} from "#shared/woodpecker-retention.ts";
import { WOODPECKER_RETENTION_SCHEDULE } from "#schedules/woodpecker-retention-schedule.ts";

import { retentionTestCandidate as candidate } from "#activities/maintenance/woodpecker-retention-test-fixtures.ts";
const workflowPath = new URL("../index.ts", import.meta.url).pathname;

describe("Woodpecker retention Workflow contract", () => {
  test("daily declaration is paused, SKIP and credentialless on the Workflow queue", () => {
    expect(WOODPECKER_RETENTION_SCHEDULE).toMatchObject({
      namespace: "prod",
      taskQueue: TASK_QUEUES.WORKFLOWS,
      overlap: "SKIP",
      timing: { expression: "45 4 * * *", timezone: "America/Los_Angeles" },
      initialPauseNote:
        "Awaiting exact-candidate dry-run review and destructive retention flag approval",
    });
  });
  test.each([false, true])(
    "bounds scanned work and replays exact reviewed plans (reviewed=%s)",
    async (reviewed) => {
      const environment = await TestWorkflowEnvironment.createTimeSkipping();
      const applied: RetentionApplyInput[] = [];
      const planned: RetentionPlanInput[] = [];
      const workflowId = `retention-${crypto.randomUUID()}`;
      const input: RetentionRunInput = reviewed
        ? {
            dryRun: false,
            reviewedPlan: { cutoff: 100, candidates: [candidate] },
          }
        : { dryRun: false };
      try {
        const result = await runWorkflowWithActivityWorker(environment, {
          workflowPath,
          activityTaskQueue: TASK_QUEUES.INFRA,
          activities: {
            initializeWoodpeckerRetention: () =>
              Promise.resolve({
                repos: [candidate.repo],
                cutoff: 200,
                cursor: { repoIndex: 0, page: 1 },
                enabled: false,
              }),
            planWoodpeckerRetentionBatch: (batch: RetentionPlanInput) => {
              planned.push(batch);
              return Promise.resolve({
                candidates: [candidate],
                scanned: 100,
                cursor: { repoIndex: 0, page: batch.cursor.page + 1 },
                protectAllMain: true,
                protectionReasons: ["Unknown owned artifact"],
              });
            },
            applyWoodpeckerRetentionBatch: (batch: RetentionApplyInput) => {
              applied.push(batch);
              return Promise.resolve(
                batch.candidates.map((exact) => ({
                  candidate: exact,
                  outcome: "dry-run",
                })),
              );
            },
          },
          execute: () =>
            environment.client.workflow.execute<
              (...args: [RetentionRunInput]) => Promise<RetentionRunResult>
            >("runWoodpeckerLogRetention", {
              args: [input],
              workflowId,
              taskQueue: TASK_QUEUES.WORKFLOWS,
            }),
        });
        expect(applied[0]?.dryRun).toBe(true);
        expect(applied[0]?.cutoff).toBe(reviewed ? 100 : 200);
        expect(result.scanned).toBe(reviewed ? 0 : 1000);
        expect(planned).toHaveLength(reviewed ? 0 : 10);
        expect(result.continuation?.cursor.page).toBe(
          reviewed ? undefined : 11,
        );
        const history = await environment.client.workflow
          .getHandle(workflowId)
          .fetchHistory();
        await Worker.runReplayHistory({ workflowsPath: workflowPath }, history);
      } finally {
        await environment.teardown();
      }
    },
    60_000,
  );
});
