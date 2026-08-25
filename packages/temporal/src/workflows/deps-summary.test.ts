import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { DependencyCollectionResult } from "#activities/deps-summary.ts";
import type { DependencyChange } from "#shared/deps-summary-types.ts";
import type { ActivityReportInput } from "#activities/report-delivery.ts";
import { generateDependencySummary } from "./index.ts";

const TASK_QUEUE = "dependency-summary-test";
const COMMIT_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);

const CHANGE: DependencyChange = {
  name: "owner/tool",
  category: "upstream",
  artifactType: "source",
  datasource: "github-releases",
  registryUrl: undefined,
  packageName: "owner/tool",
  oldValue: "1.0.0",
  newValue: "2.0.0",
  oldVersion: "1.0.0",
  newVersion: "2.0.0",
  kind: "upstream-upgrade",
  commitSha: COMMIT_SHA,
  commitSubject: "chore(deps): update owner/tool to 2.0.0",
  releaseNotesOverride: undefined,
};

const COLLECTION: DependencyCollectionResult = {
  baseSha: COMMIT_SHA,
  headSha: HEAD_SHA,
  usedCheckpoint: true,
  endpointStatesIdentical: false,
  changes: [CHANGE],
};

let testEnvironment: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnvironment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnvironment.teardown();
});

describe("dependency summary delivery checkpoint", () => {
  test("reports missing notes as partial before advancing the checkpoint", async () => {
    const reports: ActivityReportInput[] = [];
    const events: string[] = [];
    const worker = await Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: {
        collectDependencyChanges: (): DependencyCollectionResult => COLLECTION,
        fetchDependencyReleaseNotes: () => ({
          notes: [],
          missing: [
            {
              dependency: CHANGE.name,
              commitSha: CHANGE.commitSha,
              attempts: [
                {
                  source: "merged-pr",
                  url: "https://api.github.com/example",
                  outcome: "unavailable",
                  detail: "No associated merged PR",
                },
                {
                  source: "github-release",
                  url: "https://github.com/owner/tool/releases",
                  outcome: "unavailable",
                  detail: "No release body",
                },
                {
                  source: "catalog-override",
                  url: undefined,
                  outcome: "unavailable",
                  detail: "No explicit override",
                },
              ],
            },
          ],
        }),
        synthesizeDependencyChanges: (): undefined => undefined,
        deliverActivityReport: (report: ActivityReportInput) => {
          reports.push(report);
          events.push(`deliver-${report.execution}`);
          return {
            accepted: true,
            duplicate: false,
            reportRunId: "dependency-summary:run-1",
            acceptedAt: "2026-08-10T16:01:00.000Z",
          };
        },
        advanceDependencySummaryCheckpoint: (): void => {
          events.push("checkpoint");
        },
      },
    });

    await worker.runUntil(
      testEnvironment.client.workflow.execute(generateDependencySummary, {
        args: [7],
        taskQueue: TASK_QUEUE,
        workflowId: `dependency-summary-partial-${crypto.randomUUID()}`,
      }),
    );

    expect(events).toEqual(["deliver-partial", "checkpoint"]);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      execution: "partial",
      verdict: "changed",
      limitations: [expect.stringContaining("release notes unavailable")],
    });
  }, 30_000);

  test("does not advance the checkpoint when delivery is not accepted", async () => {
    const events: string[] = [];
    const worker = await Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: {
        collectDependencyChanges: (): DependencyCollectionResult => COLLECTION,
        fetchDependencyReleaseNotes: () => ({
          notes: [
            {
              dependency: CHANGE.name,
              version: CHANGE.newVersion,
              notes: "Authoritative release notes",
              url: "https://github.com/owner/tool/releases/tag/2.0.0",
              source: "github-release",
            },
          ],
          missing: [],
        }),
        synthesizeDependencyChanges: (): undefined => undefined,
        deliverActivityReport: (): never => {
          events.push("deliver-failed");
          throw new Error("Postal unavailable");
        },
        advanceDependencySummaryCheckpoint: (): void => {
          events.push("checkpoint");
        },
      },
    });

    let failure: unknown;
    try {
      await worker.runUntil(
        testEnvironment.client.workflow.execute(generateDependencySummary, {
          args: [7],
          taskQueue: TASK_QUEUE,
          workflowId: `dependency-summary-delivery-failure-${crypto.randomUUID()}`,
        }),
      );
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(events).not.toContain("checkpoint");
    expect(events.every((event) => event === "deliver-failed")).toBe(true);
  }, 30_000);

  test("retries checkpoint persistence without redelivering the report", async () => {
    let deliveryCalls = 0;
    let checkpointCalls = 0;
    const worker = await Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: {
        collectDependencyChanges: (): DependencyCollectionResult => COLLECTION,
        fetchDependencyReleaseNotes: () => ({
          notes: [
            {
              dependency: CHANGE.name,
              version: CHANGE.newVersion,
              notes: "Authoritative release notes",
              url: "https://github.com/owner/tool/releases/tag/2.0.0",
              source: "github-release",
            },
          ],
          missing: [],
        }),
        synthesizeDependencyChanges: (): undefined => undefined,
        deliverActivityReport: () => {
          deliveryCalls += 1;
          return {
            accepted: true,
            duplicate: false,
            reportRunId: "dependency-summary:run-retry",
            acceptedAt: "2026-08-10T16:01:00.000Z",
          };
        },
        advanceDependencySummaryCheckpoint: (): void => {
          checkpointCalls += 1;
          if (checkpointCalls < 3) {
            throw new Error("temporary checkpoint storage failure");
          }
        },
      },
    });

    await worker.runUntil(
      testEnvironment.client.workflow.execute(generateDependencySummary, {
        args: [7],
        taskQueue: TASK_QUEUE,
        workflowId: `dependency-summary-checkpoint-retry-${crypto.randomUUID()}`,
      }),
    );

    expect(deliveryCalls).toBe(1);
    expect(checkpointCalls).toBe(3);
  }, 30_000);
});

describe("dependency summary checkpoint failure reporting", () => {
  test("reports a distinct failure after accepted delivery when checkpoint retries exhaust", async () => {
    const reports: ActivityReportInput[] = [];
    let checkpointCalls = 0;
    const worker = await Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: {
        collectDependencyChanges: (): DependencyCollectionResult => COLLECTION,
        fetchDependencyReleaseNotes: () => ({
          notes: [
            {
              dependency: CHANGE.name,
              version: CHANGE.newVersion,
              notes: "Authoritative release notes",
              url: "https://github.com/owner/tool/releases/tag/2.0.0",
              source: "github-release",
            },
          ],
          missing: [],
        }),
        synthesizeDependencyChanges: (): undefined => undefined,
        deliverActivityReport: (report: ActivityReportInput) => {
          reports.push(report);
          return {
            accepted: true,
            duplicate: false,
            reportRunId:
              report.execution === "failed"
                ? "dependency-summary:run-exhausted:failed"
                : "dependency-summary:run-exhausted",
            acceptedAt: "2026-08-10T16:01:00.000Z",
          };
        },
        advanceDependencySummaryCheckpoint: (): never => {
          checkpointCalls += 1;
          throw new Error("persistent checkpoint storage failure");
        },
      },
    });

    let failure: unknown;
    try {
      await worker.runUntil(
        testEnvironment.client.workflow.execute(generateDependencySummary, {
          args: [7],
          taskQueue: TASK_QUEUE,
          workflowId: `dependency-summary-checkpoint-exhausted-${crypto.randomUUID()}`,
        }),
      );
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(checkpointCalls).toBe(3);
    expect(reports.map((report) => report.execution)).toEqual([
      "complete",
      "failed",
    ]);
  }, 30_000);
});
