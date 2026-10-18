import { describe, expect, test } from "vitest";
import type {
  DataDragonUpdateResult,
  DataDragonVersionState,
} from "#shared/data-dragon-types.ts";
import type { ScoutQueueWindowsResult } from "#activities/scout/scout-queue-windows.ts";
import { queueWarningFinding } from "#activities/scout/scout-queue-windows-report.ts";
import { notificationCondition } from "#activities/reports/report-notification-policy.ts";
import type { ScoutSeasonRefreshResult } from "#activities/scout/scout-season-refresh.ts";
import type { TasknotesCanaryResult } from "#activities/maintenance/tasknotes-canary.ts";
import type { ActivityReportInput } from "#activities/reports/report-delivery.ts";
import { ReportEnvelopeV1Schema } from "#shared/reports/report.ts";
import { dataDragonReport } from "./scout/data-dragon.ts";
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
    expect(report.findings[0]?.id).toBeUndefined();

    const observation = (total: number) => {
      const finding = queueWarningFinding({
        kind: "unknown-queue-id",
        queueId: "9999",
        total,
        message: `${String(total)} matches for unknown queue 9999`,
      });
      return ReportEnvelopeV1Schema.parse({
        ...scoutQueueWindowsReport(STARTED_AT, {
          ...result,
          warningSummaries: [finding.summary],
          warningFindings: [finding],
          warningConsecutiveRuns: total,
        }),
        schemaVersion: 1,
        reportRunId: `queue:test-${String(total)}`,
        completedAt: OBSERVED_AT,
        provenance: {
          workflowId: "queue-test",
          runId: `test-${String(total)}`,
        },
      });
    };
    const first = observation(10);
    const later = observation(20);
    expect(first.findings).not.toEqual(later.findings);
    expect(notificationCondition(first)).toEqual(notificationCondition(later));
  });
});

const SPARSE_QUEUES = ["aram mayhem", "classic", "classic aram mayhem"];
const sparseFindings = SPARSE_QUEUES.map((queue) =>
  queueWarningFinding({
    kind: "sparse-no-close",
    queue,
    total: 0,
    message: `${queue}: no matches in 28 days`,
  }),
);
const WIKI = "https://wiki.leagueoflegends.com/en-us/ARAM:_Mayhem";
const PATCH =
  "https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-19-notes/";

function sparseResult(
  livenessChecks: ScoutQueueWindowsResult["livenessChecks"],
): ScoutQueueWindowsResult {
  return {
    changedFiles: [],
    branchName: undefined,
    commitHash: undefined,
    prUrl: undefined,
    autoMergeRequested: false,
    autoMergeConfigured: undefined,
    editCount: 0,
    warningCount: sparseFindings.length,
    warningSummaries: sparseFindings.map((finding) => finding.summary),
    warningFindings: sparseFindings,
    warningFingerprint: "e".repeat(64),
    warningConsecutiveRuns: 3,
    editSummaries: [],
    ...(livenessChecks === undefined ? {} : { livenessChecks }),
    outcome: "no-diff-warned",
  };
}

function check(
  index: number,
  status: "live" | "ended" | "unknown",
  extra: { endedOn?: string; errorClass?: string; sources?: string[] } = {},
) {
  return {
    findingId: sparseFindings[index]?.id ?? "",
    queue: SPARSE_QUEUES[index] ?? "",
    status,
    rationale: `${status} rationale`,
    sources: extra.sources ?? [WIKI],
    ...(extra.endedOn === undefined ? {} : { endedOn: extra.endedOn }),
    ...(extra.errorClass === undefined ? {} : { errorClass: extra.errorClass }),
  };
}

function envelope(report: ActivityReportInput) {
  return ReportEnvelopeV1Schema.parse({
    ...validate(report),
    schemaVersion: 1,
    reportRunId: "queue:liveness",
    completedAt: OBSERVED_AT,
    provenance: { workflowId: "queue-test", runId: "liveness" },
  });
}

describe("Scout queue-window liveness", () => {
  test("results without liveness checks keep their pre-liveness report", () => {
    const report = validate(
      scoutQueueWindowsReport(STARTED_AT, sparseResult(undefined)),
    );
    expect(report.verdict).toBe("attention");
    expect(report.checks.map((item) => item.id)).toEqual([
      "match-evidence",
      "proposal-publication",
      "auto-merge-configuration",
    ]);
    expect(report.evidence.map((item) => item.id)).toEqual([
      "queue-window-result",
    ]);
    expect(report.limitations).toEqual([]);
    expect(report.actions).toEqual([]);
    expect(report.headline).toBe(
      `3 warnings with fingerprint ${"e".repeat(64)} (3 consecutive runs).`,
    );
    expect(
      report.findings.map((finding) => [finding.state, finding.severity]),
    ).toEqual([
      ["active", "warning"],
      ["active", "warning"],
      ["active", "warning"],
    ]);
  });

  test("all sparse queues verified live produce a clear, non-actionable report", () => {
    const report = envelope(
      scoutQueueWindowsReport(
        STARTED_AT,
        sparseResult([check(0, "live"), check(1, "live"), check(2, "live")]),
      ),
    );
    expect(report).toMatchObject({ execution: "complete", verdict: "clear" });
    expect(report.headline).toBe(
      "Match evidence produced no queue-window changes. 3 sparse queues were verified live by web search.",
    );
    expect(
      report.findings.map((finding) => [finding.state, finding.severity]),
    ).toEqual([
      ["observing", "info"],
      ["observing", "info"],
      ["observing", "info"],
    ]);
    expect(report.findings[0]?.detail).toContain("Verified live by web search");
    expect(report.findings[0]?.detail).toContain(WIKI);
    expect(report.checks.find((item) => item.id === "queue-liveness")).toEqual({
      id: "queue-liveness",
      label: "Liveness verification (web search)",
      required: false,
      status: "passed",
      summary: "Passed 3 / Problem 0 / Not checked 0",
      evidenceReceiptIds: ["queue-liveness"],
    });
    expect(report.limitations).toEqual([
      "Sparse-queue liveness is model-assessed from web search; a verified-live queue is informational, not proof of match volume.",
    ]);
    expect(notificationCondition(report).actionable).toBe(false);
  });

  test("an ended verdict stays active and proposes closing the window", () => {
    const report = envelope(
      scoutQueueWindowsReport(
        STARTED_AT,
        sparseResult([
          check(0, "live"),
          check(1, "ended", { endedOn: "2026-09-24", sources: [PATCH] }),
          check(2, "live"),
        ]),
      ),
    );
    expect(report.verdict).toBe("attention");
    expect(report.headline).toBe(
      `1 warnings with fingerprint ${"e".repeat(64)} (3 consecutive runs). 2 sparse queues were verified live by web search.`,
    );
    expect(report.findings[1]).toMatchObject({
      state: "active",
      severity: "warning",
    });
    expect(report.findings[1]?.detail).toContain("liveness=ended");
    expect(report.actions).toEqual([
      `Set \`end\` for classic in queue-windows.json (LLM cites ended 2026-09-24: ${PATCH}).`,
    ]);
    expect(
      report.checks.find((item) => item.id === "queue-liveness")?.summary,
    ).toBe("Passed 2 / Problem 1 / Not checked 0");
    expect(notificationCondition(report).actionable).toBe(true);
  });

  test("a failed liveness call keeps the warning and marks the check failed", () => {
    const report = envelope(
      scoutQueueWindowsReport(
        STARTED_AT,
        sparseResult([
          check(0, "live"),
          check(1, "unknown", { errorClass: "AI_APICallError", sources: [] }),
          check(2, "unknown", { sources: [] }),
        ]),
      ),
    );
    expect(report).toMatchObject({
      execution: "complete",
      verdict: "attention",
    });
    expect(
      report.checks.find((item) => item.id === "queue-liveness"),
    ).toMatchObject({
      status: "failed",
      required: false,
      summary: "Passed 1 / Problem 1 / Not checked 1",
    });
    expect(
      report.evidence.find((item) => item.id === "queue-liveness")?.status,
    ).toBe("failure");
    expect(report.findings[1]?.detail).toContain("(AI_APICallError)");
    expect(
      report.findings.filter((finding) => finding.state === "active"),
    ).toHaveLength(2);
  });

  test("a verified-live queue does not change the active-warning condition", () => {
    const withLive = envelope(
      scoutQueueWindowsReport(
        STARTED_AT,
        sparseResult([check(0, "live"), check(1, "ended"), check(2, "live")]),
      ),
    );
    const differentRationale = envelope(
      scoutQueueWindowsReport(
        STARTED_AT,
        sparseResult([
          { ...check(0, "live"), rationale: "new wording" },
          check(1, "ended"),
          check(2, "live"),
        ]),
      ),
    );
    expect(notificationCondition(withLive)).toEqual(
      notificationCondition(differentRationale),
    );
  });

  test("no sparse warnings records a skipped liveness check", () => {
    const report = validate(
      scoutQueueWindowsReport(STARTED_AT, {
        ...sparseResult([]),
        warningCount: 0,
        warningSummaries: [],
        warningFindings: [],
        warningFingerprint: undefined,
        warningConsecutiveRuns: 0,
        outcome: "no-diff",
      }),
    );
    expect(report.verdict).toBe("clear");
    expect(
      report.checks.find((item) => item.id === "queue-liveness"),
    ).toMatchObject({ status: "skipped", required: false });
    expect(report.limitations).toEqual([]);
  });
});
