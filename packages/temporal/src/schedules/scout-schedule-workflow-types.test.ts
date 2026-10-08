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
 * still-routed build (56f22c5); replace it whenever routing moves.
 */
const ROUTED_BUNDLE_WORKFLOW_TYPES: ReadonlySet<string> = new Set([
  "scoutRealtimePollWorkflow",
  "scoutMatchIngestionWorkflow",
  "scoutPostMatchDiscoveryWorkflow",
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
});
