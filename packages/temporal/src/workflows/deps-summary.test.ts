import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { DependencyCollectionResult } from "#activities/maintenance/deps-summary/deps-summary.ts";
import type { DependencyChange } from "#shared/deps-summary-types.ts";
import type { ActivityReportInput } from "#activities/reports/report-delivery.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { generateDependencySummary } from "./index.ts";
import { runWithReportWorker } from "./test-support.ts";

const COMMIT_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const TASK_QUEUE = TASK_QUEUES.REPO_AUTOMATION;

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

const COMPLETE_RELEASE_NOTES = {
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
} as const;

type DependencySummaryTestActivities = {
  collectDependencyChanges?: () => DependencyCollectionResult;
  fetchDependencyReleaseNotes: () => unknown;
  proposeMissingReleaseNoteOverrides?: () => unknown;
  synthesizeDependencyChanges?: (changes: never, notes: never) => unknown;
  deliverActivityReport: (input: never) => unknown;
  advanceDependencySummaryCheckpoint: () => unknown;
};

let testEnvironment: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnvironment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnvironment.teardown();
});

async function runDependencySummaryScenario(
  workflowIdPrefix: string,
  activities: DependencySummaryTestActivities,
): Promise<unknown> {
  const reportTaskQueue = `dependency-summary-test-reports-${crypto.randomUUID()}`;
  const worker = await Worker.create({
    connection: testEnvironment.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: new URL("index.ts", import.meta.url).pathname,
    activities: {
      collectDependencyChanges:
        activities.collectDependencyChanges ??
        ((): DependencyCollectionResult => COLLECTION),
      fetchDependencyReleaseNotes: activities.fetchDependencyReleaseNotes,
      proposeMissingReleaseNoteOverrides:
        activities.proposeMissingReleaseNoteOverrides ??
        (() => ({
          remediation: {
            outcome: "no-changes",
            changedFiles: [],
            resolvedCount: 0,
            unresolvedCount: 1,
            summary: "No authoritative override found.",
          },
          resolvedNotes: [],
        })),
      synthesizeDependencyChanges:
        activities.synthesizeDependencyChanges ?? ((): undefined => undefined),
      deliverActivityReport: activities.deliverActivityReport,
      advanceDependencySummaryCheckpoint:
        activities.advanceDependencySummaryCheckpoint,
    },
  });

  return await runWithReportWorker(
    testEnvironment,
    worker,
    activities.deliverActivityReport,
    {
      reportTaskQueue,
      runWorkflow: () =>
        testEnvironment.client.workflow.execute(generateDependencySummary, {
          args: [7, reportTaskQueue],
          taskQueue: TASK_QUEUE,
          workflowId: `${workflowIdPrefix}-${crypto.randomUUID()}`,
        }),
    },
  );
}

describe("dependency summary delivery checkpoint", () => {
  test("reports missing notes as partial before advancing the checkpoint", async () => {
    const reports: ActivityReportInput[] = [];
    const events: string[] = [];
    const deliverActivityReport = (report: ActivityReportInput) => {
      reports.push(report);
      events.push(`deliver-${report.execution}`);
      return {
        accepted: true,
        duplicate: false,
        reportRunId: "dependency-summary:run-1",
        acceptedAt: "2026-08-10T16:01:00.000Z",
      };
    };
    await runDependencySummaryScenario("dependency-summary-partial", {
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
      deliverActivityReport,
      advanceDependencySummaryCheckpoint: (): void => {
        events.push("checkpoint");
      },
    });

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
    const deliverActivityReport = (): never => {
      events.push("deliver-failed");
      throw new Error("Postal unavailable");
    };
    let failure: unknown;
    try {
      await runDependencySummaryScenario(
        "dependency-summary-delivery-failure",
        {
          fetchDependencyReleaseNotes: () => COMPLETE_RELEASE_NOTES,
          deliverActivityReport,
          advanceDependencySummaryCheckpoint: (): void => {
            events.push("checkpoint");
          },
        },
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
    const deliverActivityReport = () => {
      deliveryCalls += 1;
      return {
        accepted: true,
        duplicate: false,
        reportRunId: "dependency-summary:run-retry",
        acceptedAt: "2026-08-10T16:01:00.000Z",
      };
    };
    await runDependencySummaryScenario("dependency-summary-checkpoint-retry", {
      fetchDependencyReleaseNotes: () => COMPLETE_RELEASE_NOTES,
      deliverActivityReport,
      advanceDependencySummaryCheckpoint: (): void => {
        checkpointCalls += 1;
        if (checkpointCalls < 3) {
          throw new Error("temporary checkpoint storage failure");
        }
      },
    });

    expect(deliveryCalls).toBe(1);
    expect(checkpointCalls).toBe(3);
  }, 30_000);
});

describe("dependency summary checkpoint failure reporting", () => {
  test("reports a distinct failure after accepted delivery when checkpoint retries exhaust", async () => {
    const reports: ActivityReportInput[] = [];
    let checkpointCalls = 0;
    const deliverActivityReport = (report: ActivityReportInput) => {
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
    };
    let failure: unknown;
    try {
      await runDependencySummaryScenario(
        "dependency-summary-checkpoint-exhausted",
        {
          fetchDependencyReleaseNotes: () => COMPLETE_RELEASE_NOTES,
          deliverActivityReport,
          advanceDependencySummaryCheckpoint: (): never => {
            checkpointCalls += 1;
            throw new Error("persistent checkpoint storage failure");
          },
        },
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

describe("dependency summary release-note details", () => {
  test("cuts release notes on grapheme boundaries inside the workflow sandbox", async () => {
    const reports: ActivityReportInput[] = [];
    const notes = `${"x".repeat(999)}🚀 Features`;
    await runDependencySummaryScenario("dependency-summary-grapheme-notes", {
      fetchDependencyReleaseNotes: () => ({
        notes: [{ ...COMPLETE_RELEASE_NOTES.notes[0], notes }],
        missing: [],
      }),
      deliverActivityReport: (report: ActivityReportInput) => {
        reports.push(report);
        return {
          accepted: true,
          duplicate: false,
          reportRunId: "dependency-summary:run-grapheme",
          acceptedAt: "2026-08-10T16:01:00.000Z",
        };
      },
      advanceDependencySummaryCheckpoint: (): undefined => undefined,
    });

    const detail = reports[0]?.findings[0]?.detail;
    expect(detail).toBe(
      `${"x".repeat(999)} (https://github.com/owner/tool/releases/tag/2.0.0)`,
    );
    expect(detail?.isWellFormed()).toBe(true);
  }, 30_000);

  test("merges proposed release-note overrides into synthesis and report while isolating proposal errors", async () => {
    const reports: ActivityReportInput[] = [];
    let synthesizedNotesCount = 0;
    await runDependencySummaryScenario("dependency-summary-override-pr", {
      fetchDependencyReleaseNotes: () => ({
        notes: [],
        missing: [
          {
            dependency: CHANGE.name,
            commitSha: CHANGE.commitSha,
            attempts: [],
          },
        ],
      }),
      proposeMissingReleaseNoteOverrides: () => ({
        remediation: {
          outcome: "pr-created",
          prUrl: "https://github.com/shepherdjerred/monorepo/pull/901",
          branchName: "chore/deps-release-notes-abcd1234",
          commitSha: "abcd1234",
          autoMergeEnabled: false,
          changedFiles: ["packages/version-catalog/src/catalog.json"],
          resolvedCount: 1,
          unresolvedCount: 0,
          summary: "Proposed 1 releaseNotesOverride.",
        },
        resolvedNotes: [
          {
            dependency: CHANGE.name,
            version: CHANGE.newVersion,
            notes: "Verified upstream changelog summary.",
            url: "https://example.com/owner/tool/v2.0.0",
            source: "catalog-override",
          },
        ],
      }),
      synthesizeDependencyChanges: (
        _changes: never,
        notes: readonly unknown[],
      ) => {
        synthesizedNotesCount = notes.length;
        return "Updated owner/tool to 2.0.0.";
      },
      deliverActivityReport: (report: ActivityReportInput) => {
        reports.push(report);
        return {
          accepted: true,
          duplicate: false,
          reportRunId: "dependency-summary:run-pr",
          acceptedAt: "2026-08-10T16:01:00.000Z",
        };
      },
      advanceDependencySummaryCheckpoint: (): undefined => undefined,
    });

    expect(synthesizedNotesCount).toBe(1);
    expect(reports[0]).toMatchObject({
      execution: "complete",
      verdict: "changed",
      synthesis: "Updated owner/tool to 2.0.0.",
      remediation: {
        outcome: "pr-created",
        prUrl: "https://github.com/shepherdjerred/monorepo/pull/901",
        autoMergeEnabled: false,
      },
    });

    const fallbackReports: ActivityReportInput[] = [];
    await runDependencySummaryScenario("dependency-summary-override-error", {
      fetchDependencyReleaseNotes: () => ({
        notes: [],
        missing: [
          {
            dependency: CHANGE.name,
            commitSha: CHANGE.commitSha,
            attempts: [],
          },
        ],
      }),
      proposeMissingReleaseNoteOverrides: (): never => {
        throw new Error("Codex unavailable");
      },
      deliverActivityReport: (report: ActivityReportInput) => {
        fallbackReports.push(report);
        return {
          accepted: true,
          duplicate: false,
          reportRunId: "dependency-summary:run-err",
          acceptedAt: "2026-08-10T16:01:00.000Z",
        };
      },
      advanceDependencySummaryCheckpoint: (): undefined => undefined,
    });

    expect(fallbackReports[0]).toMatchObject({
      execution: "partial",
      verdict: "changed",
      remediation: { outcome: "partial" },
    });
  }, 45_000);

  test("preserves existing v2 release notes when merging a proposed v3 override for the same dependency", async () => {
    const v3Sha = "c".repeat(40);
    const v3Change: DependencyChange = {
      ...CHANGE,
      oldValue: "2.0.0",
      newValue: "3.0.0",
      oldVersion: "2.0.0",
      newVersion: "3.0.0",
      commitSha: v3Sha,
      commitSubject: "chore(deps): update owner/tool to 3.0.0",
    };
    const reports: ActivityReportInput[] = [];

    await runDependencySummaryScenario("dependency-summary-multi-version", {
      collectDependencyChanges: () => ({
        ...COLLECTION,
        changes: [CHANGE, v3Change],
      }),
      fetchDependencyReleaseNotes: () => ({
        notes: [...COMPLETE_RELEASE_NOTES.notes],
        missing: [{ dependency: CHANGE.name, commitSha: v3Sha, attempts: [] }],
      }),
      proposeMissingReleaseNoteOverrides: () => ({
        remediation: {
          outcome: "pr-created",
          prUrl: "https://github.com/shepherdjerred/monorepo/pull/902",
          branchName: "chore/deps-release-notes-beef1234",
          commitSha: "beef1234",
          autoMergeEnabled: false,
          changedFiles: ["packages/version-catalog/src/catalog.json"],
          resolvedCount: 1,
          unresolvedCount: 0,
          summary: "Proposed v3 releaseNotesOverride.",
        },
        resolvedNotes: [
          {
            dependency: CHANGE.name,
            version: "3.0.0",
            notes: "v3.0.0 changelog summary.",
            url: "https://example.com/owner/tool/v3.0.0",
            source: "catalog-override",
          },
        ],
      }),
      deliverActivityReport: (report: ActivityReportInput) => {
        reports.push(report);
        return {
          accepted: true,
          duplicate: false,
          reportRunId: "dependency-summary:run-multi",
          acceptedAt: "2026-08-10T16:01:00.000Z",
        };
      },
      advanceDependencySummaryCheckpoint: (): undefined => undefined,
    });

    expect(reports[0]).toMatchObject({ execution: "complete" });
    expect(reports[0]?.findings[0]?.detail).toContain(
      "Authoritative release notes",
    );
    expect(reports[0]?.findings[1]?.detail).toContain(
      "v3.0.0 changelog summary.",
    );
  }, 30_000);
});
