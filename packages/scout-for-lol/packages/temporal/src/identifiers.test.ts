import { describe, expect, test } from "vitest";
import {
  scoutChallengeRunRecomputeWorkflowId,
  scoutDuelSeriesWorkflowId,
  scoutHallBaselineWorkflowId,
  scoutInitialHistoryWorkflowId,
  scoutInteractiveWorkflowId,
  scoutMatchWorkflowId,
  scoutReportScheduleId,
  scoutReportScheduleReconcilerWorkflowId,
  scoutTaskQueues,
} from "./identifiers.ts";

describe("Scout Temporal identifiers", () => {
  test("derives one workflow queue and isolated activity queues per stage", () => {
    expect(scoutTaskQueues("beta")).toEqual({
      workflow: "scout-beta",
      realtime: "scout-beta-realtime",
      interactive: "scout-beta-interactive",
      background: "scout-beta-background",
      lake: "scout-beta-lake",
    });
  });

  test("uses stable product identifiers without random suffixes", () => {
    expect(scoutMatchWorkflowId("prod", "NA1_123")).toBe(
      "scout-prod-match-NA1_123",
    );
    expect(scoutInitialHistoryWorkflowId("beta", "puuid_123")).toBe(
      "scout-beta-history-puuid_123",
    );
    expect(scoutInteractiveWorkflowId("beta", "explore", "run_123")).toBe(
      "scout-beta-explore-run_123",
    );
    expect(scoutReportScheduleReconcilerWorkflowId("prod")).toBe(
      "scout-prod-report-schedule-reconciler",
    );
    expect(scoutReportScheduleId("beta", "report_123")).toBe(
      "scout-beta-report-report_123",
    );
    expect(scoutHallBaselineWorkflowId("beta", "guild_123", 4)).toBe(
      "scout-beta-hall-guild_123-4",
    );
    expect(scoutChallengeRunRecomputeWorkflowId("prod", "run_123", 7)).toBe(
      "scout-prod-challenge-run_123-7",
    );
    expect(scoutDuelSeriesWorkflowId("dev", "series_123")).toBe(
      "scout-dev-duel-series-series_123",
    );
  });
});
