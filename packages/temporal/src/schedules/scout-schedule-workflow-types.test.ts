import * as scoutWorkflows from "@scout-for-lol/temporal/workflows";
import { describe, expect, test } from "vitest";
import { SCHEDULES } from "./schedule-definitions.ts";

/**
 * The Workflow types the Scout Schedules start must resolve on every bundle
 * that can run them.
 *
 * The Schedules deploy with this central worker, independently of the Scout
 * images: beta routes Workflow tasks to a Worker Deployment build, and prod's
 * embedded poller runs the prod backend image until it is promoted. A type
 * that any of those bundles does not export stops the Schedule in that
 * namespace. `ROUTED_BUNDLE_WORKFLOW_TYPES` is the export list of the oldest
 * build that may still be routed: the release that switched issuance to the
 * renamed pipeline types, which still exported the pre-rename aliases beside
 * them. Replace it whenever routing moves.
 *
 * That build is a deploy precondition rather than a fact this test can check:
 * the Schedules issue the renamed types, and an older build routed in either
 * namespace would not resolve them — or, for `scoutPostMatchDiscoveryWorkflow`,
 * would resolve the retired v1 Workflow of that name.
 */
const ROUTED_BUNDLE_WORKFLOW_TYPES: ReadonlySet<string> = new Set([
  "scoutPostMatchDiscoveryWorkflow",
  "scoutMatchProcessingWorkflow",
  "scoutClientMatchDispatchWorkflow",
  "scoutPrematchDiscoveryWorkflow",
  "scoutPrematchGameWorkflow",
  "scoutNotificationWorkflow",
  "scoutLakeProjectionWorkflow",
  "scoutRecoveryBatchWorkflow",
  "scoutPipelineReconciliationWorkflow",
  "scoutSilentPostmatchBackfillWorkflow",
  "scoutInitialHistoryWorkflow",
  "scoutExploreHistoryWorkflow",
  "scoutExploreTimelineWorkflow",
  "scoutIngestionReconciliationWorkflow",
  "scoutBackgroundJobWorkflow",
  "scoutDetachedWorkWorkflow",
  "scoutReportLakeWorkflow",
  "scoutReportRunWorkflow",
  "scoutReportScheduleReconcilerWorkflow",
  "scoutInteractiveRunWorkflow",
  "scoutQueueCanaryWorkflow",
  "scoutHallBaselineWorkflow",
  "scoutChallengeRunRecomputeWorkflow",
  "scoutDuelSeriesWorkflow",
  "scoutPostMatchDiscoveryV2Workflow",
  "scoutMatchProcessingV2Workflow",
  "scoutClientMatchDispatchV2Workflow",
  "scoutPrematchDiscoveryV2Workflow",
  "scoutPrematchGameV2Workflow",
  "scoutNotificationV2Workflow",
  "scoutLakeProjectionV2Workflow",
  "scoutRecoveryBatchV2Workflow",
  "scoutPipelineReconciliationV2Workflow",
  "scoutSilentPostmatchBackfillV2Workflow",
]);

const scoutSchedules = SCHEDULES.filter((schedule) =>
  /^scout-(?:beta|prod)$/u.test(schedule.taskQueue),
);
const bundleExports = new Set(Object.keys(scoutWorkflows));

describe("Scout Schedule Workflow types", () => {
  test("covers the Scout Schedules", () => {
    expect(scoutSchedules.length).toBeGreaterThan(0);
  });

  test.each(scoutSchedules.map((schedule) => [schedule.id, schedule]))(
    "%s names a type this bundle and the routed bundle both export",
    (_id, schedule) => {
      expect(bundleExports.has(schedule.workflowType)).toBe(true);
      expect(ROUTED_BUNDLE_WORKFLOW_TYPES.has(schedule.workflowType)).toBe(
        true,
      );
    },
  );

  test("issue the renamed pipeline types, never the pre-rename ones", () => {
    expect(
      scoutSchedules
        .map((schedule) => schedule.workflowType)
        .filter((workflowType) => workflowType.endsWith("V2Workflow")),
    ).toEqual([]);
    expect(
      new Set(scoutSchedules.map((schedule) => schedule.workflowType)),
    ).toEqual(
      new Set([
        "scoutPrematchDiscoveryWorkflow",
        "scoutPostMatchDiscoveryWorkflow",
        "scoutPipelineReconciliationWorkflow",
        "scoutIngestionReconciliationWorkflow",
        "scoutBackgroundJobWorkflow",
        "scoutReportScheduleReconcilerWorkflow",
        "scoutReportLakeWorkflow",
      ]),
    );
  });
});
