import { describe, expect, test } from "vitest";
import type {
  DataDragonUpdateResult,
  DataDragonVersionState,
} from "#shared/data-dragon-types.ts";
import type { ScoutQueueWindowsResult } from "#activities/scout/scout-queue-windows.ts";
import type { ScoutSeasonRefreshResult } from "#activities/scout/scout-season-refresh.ts";
import type { TasknotesCanaryResult } from "#activities/maintenance/tasknotes-canary.ts";
import type { ActivityReportInput } from "#activities/reports/report-delivery.ts";
import { ReportEnvelopeV1Schema } from "#shared/reports/report.ts";
import { dataDragonReport } from "./scout/data-dragon.ts";
import { protobufWatchReport } from "./ci/protobuf-watch.ts";
import { scoutQueueWindowsReport } from "./scout/scout-queue-windows.ts";
import { scoutSeasonReport } from "./scout/scout-season-refresh.ts";
import { tasknotesReport } from "./tasknotes-canary.ts";

const STARTED_AT = "2026-08-10T16:00:00.000Z";
const OBSERVED_AT = "2026-08-10T16:01:00.000Z";

function validate(report: ActivityReportInput): ActivityReportInput {
  const provenance = report.provenance ?? {};
  ReportEnvelopeV1Schema.parse({
    ...report,
    schemaVersion: 1,
    reportRunId: `${report.reportType}:test-run`,
    completedAt: OBSERVED_AT,
    provenance: {
      ...provenance,
      workflowId: "test-workflow",
      runId: "test-run",
    },
  });
  return report;
}

const VERSION_STATE: DataDragonVersionState = {
  currentVersion: "16.15.0",
  latestVersion: "16.15.1",
  updateRequired: true,
};

function dataDragonResult(
  reason: DataDragonUpdateResult["reason"],
  prUrl: string | undefined,
): DataDragonUpdateResult {
  return {
    ...VERSION_STATE,
    mode: "version-check",
    changedFiles: ["version.json"],
    branchName: "chore/data-dragon",
    commitHash: "b".repeat(40),
    prUrl,
    outcome: reason === "pr-created" ? "success" : "skipped",
    reason,
    ...(reason === "pr-created" ? { autoMergeConfigured: true } : {}),
  };
}

function tasknotesResult(
  tasks: number,
  baselineTasks: number | undefined,
): TasknotesCanaryResult {
  return {
    observedAt: OBSERVED_AT,
    engine: { configSource: "vault", tasks, skippedFiles: [] },
    pods: [
      {
        metadata: { name: "tasknotes-1", namespace: "tasknotes" },
        status: {
          phase: "Running",
          containerStatuses: [
            { name: "tasknotes-server", ready: true, restartCount: 0 },
          ],
        },
      },
    ],
    baseline:
      baselineTasks === undefined
        ? undefined
        : {
            schemaVersion: 1,
            tasks: baselineTasks,
            acceptedAt: "2026-08-09T16:01:00.000Z",
            reportRunId: "tasknotes-canary:prior",
          },
    evidence: {
      pods: "{}",
      baseline: baselineTasks === undefined ? undefined : "{}",
    },
  };
}

describe("deterministic report outcome matrices", () => {
  test("TaskNotes distinguishes first baseline, clean, and task-count attention", () => {
    expect(
      validate(tasknotesReport(STARTED_AT, tasknotesResult(100, undefined))),
    ).toMatchObject({ execution: "partial", verdict: "inconclusive" });
    expect(
      validate(tasknotesReport(STARTED_AT, tasknotesResult(100, 100))),
    ).toMatchObject({ execution: "complete", verdict: "clear" });
    expect(
      validate(tasknotesReport(STARTED_AT, tasknotesResult(70, 100))),
    ).toMatchObject({ execution: "complete", verdict: "attention" });
  });

  test("protobuf watch reports stable and migration-ready states", () => {
    const stable = protobufWatchReport(STARTED_AT, {
      observedAt: OBSERVED_AT,
      packageVersion: "1.18.1",
      protobufjsRange: "7.5.8",
      supportsV8: false,
      sourceUrl: "https://registry.npmjs.org/@temporalio/proto/latest",
      evidenceJson: "{}",
    });
    const ready = protobufWatchReport(STARTED_AT, {
      observedAt: OBSERVED_AT,
      packageVersion: "2.0.0",
      protobufjsRange: "^8.0.0",
      supportsV8: true,
      sourceUrl: "https://registry.npmjs.org/@temporalio/proto/latest",
      evidenceJson: "{}",
    });
    expect(validate(stable)).toMatchObject({
      execution: "complete",
      verdict: "pending",
    });
    expect(validate(ready)).toMatchObject({
      execution: "complete",
      verdict: "attention",
    });
  });
});

describe("deterministic maintenance report outcomes", () => {
  test("Data Dragon reports current, changed, skipped, and incomplete publication", () => {
    expect(
      validate(
        dataDragonReport(STARTED_AT, "version-check", VERSION_STATE, undefined),
      ),
    ).toMatchObject({ execution: "complete", verdict: "clear" });
    expect(
      validate(
        dataDragonReport(
          STARTED_AT,
          "version-check",
          VERSION_STATE,
          dataDragonResult(
            "pr-created",
            "https://github.com/shepherdjerred/monorepo/pull/1",
          ),
        ),
      ),
    ).toMatchObject({ execution: "complete", verdict: "changed" });
    expect(
      validate(
        dataDragonReport(
          STARTED_AT,
          "version-check",
          VERSION_STATE,
          dataDragonResult("image-only-diff", undefined),
        ),
      ),
    ).toMatchObject({ execution: "complete", verdict: "attention" });
    expect(
      validate(
        dataDragonReport(
          STARTED_AT,
          "version-check",
          VERSION_STATE,
          dataDragonResult("pr-created", undefined),
        ),
      ),
    ).toMatchObject({ execution: "partial", verdict: "attention" });
  });

  test("Scout season requires sources, sentinel agreement, tests, and PR evidence", () => {
    const current: ScoutSeasonRefreshResult = {
      outcome: "no-drift",
      reason: "No drift",
      changedFiles: [],
      branchName: undefined,
      commitHash: undefined,
      prUrl: undefined,
      diff: undefined,
      durationSeconds: 1,
      costUsd: undefined,
      numTurns: 1,
      sourceUrls: [
        "https://www.leagueoflegends.com/a",
        "https://wiki.leagueoflegends.com/b",
      ],
      requiredDates: ["2026-09-22"],
      unsupportedDates: [],
      sourceEvidenceComplete: true,
      sentinelAgreement: true,
      validationPassed: true,
    };
    expect(validate(scoutSeasonReport(STARTED_AT, current))).toMatchObject({
      execution: "complete",
      verdict: "clear",
    });
    expect(
      validate(
        scoutSeasonReport(STARTED_AT, {
          ...current,
          outcome: "pr-created",
          reason: "Drift validated",
          changedFiles: ["seasons.ts"],
          prUrl: "https://github.com/shepherdjerred/monorepo/pull/2",
        }),
      ),
    ).toMatchObject({ execution: "complete", verdict: "changed" });
    expect(
      validate(
        scoutSeasonReport(STARTED_AT, {
          ...current,
          sentinelAgreement: false,
          reason: "Sentinel disagrees with diff",
        }),
      ),
    ).toMatchObject({ execution: "partial", verdict: "inconclusive" });
  });

  test("queue warnings retain fingerprint and consecutive-run evidence", () => {
    const result: ScoutQueueWindowsResult = {
      changedFiles: [],
      branchName: undefined,
      commitHash: undefined,
      prUrl: undefined,
      autoMergeRequested: false,
      autoMergeConfigured: undefined,
      editCount: 0,
      warningCount: 1,
      warningSummaries: ["Queue evidence is sparse"],
      warningFingerprint: "d".repeat(64),
      warningConsecutiveRuns: 4,
      editSummaries: [],
      outcome: "no-diff-warned",
    };
    const report = validate(scoutQueueWindowsReport(STARTED_AT, result));
    expect(report).toMatchObject({
      execution: "complete",
      verdict: "attention",
    });
    expect(report.findings[0]?.detail).toContain("consecutiveRuns=4");
  });
});
