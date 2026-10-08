import { describe, expect, test } from "vitest";
import {
  RecoveryBatchIdSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  ScoutNotificationIntentKeySchema,
  ScoutPrematchGameRefSchema,
} from "./pipeline-contracts.ts";
import {
  SCOUT_PIPELINE_ACTIVITY_QUEUE_CLASSES,
  SCOUT_PIPELINE_WORKFLOW_NAMES,
  scoutChallengeRunRecomputeWorkflowId,
  scoutDuelSeriesWorkflowId,
  scoutHallBaselineWorkflowId,
  scoutIngestionReconciliationGatewayReadyWorkflowId,
  scoutExploreHistoryWorkflowId,
  scoutExploreTimelineWorkflowId,
  scoutInitialHistoryWorkflowId,
  scoutInteractiveWorkflowId,
  scoutLakeProjectionWorkflowId,
  scoutClientMatchDispatchWorkflowId,
  scoutMatchProcessingWorkflowId,
  scoutNotificationAttemptNonce,
  scoutNotificationWorkflowId,
  scoutPipelineReconciliationWorkflowId,
  scoutPostMatchDiscoveryWorkflowId,
  scoutPrematchGameMatchId,
  scoutPrematchGameWorkflowId,
  scoutRecoveryBatchWorkflowId,
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
    expect(scoutInitialHistoryWorkflowId("beta", "puuid_123")).toBe(
      "scout-beta-history-puuid_123",
    );
    expect(scoutExploreHistoryWorkflowId("beta", "puuid_123", 456)).toBe(
      "scout-beta-explore-history-puuid_123-456",
    );
    expect(
      scoutExploreTimelineWorkflowId("beta", ["NA1_2", "NA1_1"], 456),
    ).toBe("scout-beta-explore-timeline-NA1_1-NA1_2-456");
    expect(scoutInteractiveWorkflowId("beta", "explore", "run_123")).toBe(
      "scout-beta-explore-run_123",
    );
    expect(scoutReportScheduleReconcilerWorkflowId("prod")).toBe(
      "scout-prod-report-schedule-reconciler",
    );
    expect(scoutIngestionReconciliationGatewayReadyWorkflowId("beta")).toBe(
      "scout-beta-ingestion-reconciliation-gateway-ready",
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

const riotMatchId = RiotMatchIdSchema.parse("NA1_5312279829");
const intentKey = ScoutNotificationIntentKeySchema.parse(
  "notify:NA1_5312279829:guild:1234567890",
);
const recoveryBatchId = RecoveryBatchIdSchema.parse("recovery_2026-09-11_01");
const gameRef = ScoutPrematchGameRefSchema.parse({
  puuid: "p".repeat(78),
  platform: "NA1",
  gameId: "5312279829",
});

const v2WorkflowIds = [
  scoutPostMatchDiscoveryWorkflowId("prod", "schedule"),
  scoutMatchProcessingWorkflowId("prod", riotMatchId),
  scoutClientMatchDispatchWorkflowId("prod"),
  scoutPrematchGameWorkflowId("prod", gameRef),
  scoutNotificationWorkflowId("prod", intentKey),
  scoutLakeProjectionWorkflowId("prod", riotMatchId),
  scoutRecoveryBatchWorkflowId("prod", recoveryBatchId),
  scoutPipelineReconciliationWorkflowId("prod", "gateway-ready"),
];

describe("Scout V2 workflow identifiers", () => {
  test("builds a stable id for every V2 workflow type", () => {
    expect(v2WorkflowIds).toEqual([
      "scout-prod-post-match-discovery-v2-schedule",
      "scout-prod-match-v2-NA1_5312279829",
      "scout-prod-client-match-dispatch-v2",
      "scout-prod-prematch-game-v2-NA1_5312279829",
      "scout-prod-notification-v2-notify:NA1_5312279829:guild:1234567890",
      "scout-prod-lake-projection-v2-NA1_5312279829",
      "scout-prod-recovery-batch-v2-recovery_2026-09-11_01",
      "scout-prod-pipeline-reconciliation-v2-gateway-ready",
    ]);
    // Prematch discovery has no id builder: the Schedule names each action.
    expect(v2WorkflowIds).toHaveLength(
      SCOUT_PIPELINE_WORKFLOW_NAMES.length - 1,
    );
  });

  test("keeps every V2 id selectable by the replay tooling", () => {
    // `scripts/replay-*-histories.ts` filter candidate histories with exactly
    // this pattern. An id outside it starts a workflow the replay gate cannot
    // see, so the whole determinism check silently stops covering it.
    const replayCandidate = /^scout-(?:beta|prod)-[\w.:-]+$/u;
    for (const workflowId of v2WorkflowIds) {
      expect(workflowId).toMatch(replayCandidate);
    }
  });

  test("gives one prematch execution per game, not per tracked account", () => {
    const sameGameOtherAccount = ScoutPrematchGameRefSchema.parse({
      ...gameRef,
      puuid: "q".repeat(78),
    });
    expect(scoutPrematchGameWorkflowId("prod", sameGameOtherAccount)).toBe(
      scoutPrematchGameWorkflowId("prod", gameRef),
    );
  });

  test("composes the match id Riot will assign a live game", () => {
    expect(scoutPrematchGameMatchId(gameRef)).toBe("NA1_5312279829");
  });

  test("names each send attempt distinctly and deterministically", () => {
    expect(scoutNotificationAttemptNonce("run-abc", 2)).toBe("run-abc:2");
    expect(scoutNotificationAttemptNonce("run-abc", 2)).toBe(
      scoutNotificationAttemptNonce("run-abc", 2),
    );
    expect(scoutNotificationAttemptNonce("run-abc", 3)).not.toBe(
      scoutNotificationAttemptNonce("run-abc", 2),
    );
    expect(scoutNotificationAttemptNonce("run-def", 2)).not.toBe(
      scoutNotificationAttemptNonce("run-abc", 2),
    );
  });

  test("routes each V2 activity to exactly one declared queue class", () => {
    expect(SCOUT_PIPELINE_ACTIVITY_QUEUE_CLASSES.deliverNotification).toBe(
      "realtime",
    );
    expect(SCOUT_PIPELINE_ACTIVITY_QUEUE_CLASSES.stageLakeProjection).toBe(
      "lake",
    );
    expect(
      SCOUT_PIPELINE_ACTIVITY_QUEUE_CLASSES.renderNotificationArtifact,
    ).toBe("background");
    expect(
      SCOUT_PIPELINE_ACTIVITY_QUEUE_CLASSES.scanPipelineReconciliationPage,
    ).toBe("background");
    // `interactive` belongs to human-facing runs; nothing in the durable
    // pipeline may sit in front of one.
    expect(Object.values(SCOUT_PIPELINE_ACTIVITY_QUEUE_CLASSES)).not.toContain(
      "interactive",
    );
  });
});
