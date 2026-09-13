import { describe, expect, test } from "vitest";
import {
  RecoveryBatchIdSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  ScoutNotificationIntentKeySchema,
  ScoutPrematchGameRefSchema,
} from "./contracts-v2.ts";
import {
  SCOUT_V2_ACTIVITY_QUEUE_CLASSES,
  SCOUT_V2_WORKFLOW_NAMES,
  scoutChallengeRunRecomputeWorkflowId,
  scoutDuelSeriesWorkflowId,
  scoutHallBaselineWorkflowId,
  scoutIngestionReconciliationGatewayReadyWorkflowId,
  scoutInitialHistoryWorkflowId,
  scoutInteractiveWorkflowId,
  scoutLakeProjectionV2WorkflowId,
  scoutMatchProcessingV2WorkflowId,
  scoutMatchWorkflowId,
  scoutNotificationAttemptNonce,
  scoutNotificationV2WorkflowId,
  scoutPipelineReconciliationV2WorkflowId,
  scoutPostMatchDiscoveryV2WorkflowId,
  scoutPrematchDiscoveryV2WorkflowId,
  scoutPrematchGameV2MatchId,
  scoutPrematchGameV2WorkflowId,
  scoutRecoveryBatchV2WorkflowId,
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
  scoutPostMatchDiscoveryV2WorkflowId("prod", "schedule"),
  scoutMatchProcessingV2WorkflowId("prod", riotMatchId),
  scoutPrematchDiscoveryV2WorkflowId("prod"),
  scoutPrematchGameV2WorkflowId("prod", gameRef),
  scoutNotificationV2WorkflowId("prod", intentKey),
  scoutLakeProjectionV2WorkflowId("prod", riotMatchId),
  scoutRecoveryBatchV2WorkflowId("prod", recoveryBatchId),
  scoutPipelineReconciliationV2WorkflowId("prod", "gateway-ready"),
];

describe("Scout V2 workflow identifiers", () => {
  test("builds a stable id for every V2 workflow type", () => {
    expect(v2WorkflowIds).toEqual([
      "scout-prod-post-match-discovery-v2-schedule",
      "scout-prod-match-v2-NA1_5312279829",
      "scout-prod-prematch-discovery-v2",
      "scout-prod-prematch-game-v2-NA1_5312279829",
      "scout-prod-notification-v2-notify:NA1_5312279829:guild:1234567890",
      "scout-prod-lake-projection-v2-NA1_5312279829",
      "scout-prod-recovery-batch-v2-recovery_2026-09-11_01",
      "scout-prod-pipeline-reconciliation-v2-gateway-ready",
    ]);
    expect(v2WorkflowIds).toHaveLength(SCOUT_V2_WORKFLOW_NAMES.length);
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

  test("separates a V2 execution from its v1 sibling for the same match", () => {
    expect(scoutMatchProcessingV2WorkflowId("prod", riotMatchId)).not.toBe(
      scoutMatchWorkflowId("prod", riotMatchId),
    );
  });

  test("gives one prematch execution per game, not per tracked account", () => {
    const sameGameOtherAccount = ScoutPrematchGameRefSchema.parse({
      ...gameRef,
      puuid: "q".repeat(78),
    });
    expect(scoutPrematchGameV2WorkflowId("prod", sameGameOtherAccount)).toBe(
      scoutPrematchGameV2WorkflowId("prod", gameRef),
    );
  });

  test("composes the match id Riot will assign a live game", () => {
    expect(scoutPrematchGameV2MatchId(gameRef)).toBe("NA1_5312279829");
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
    expect(SCOUT_V2_ACTIVITY_QUEUE_CLASSES.deliverNotificationV2).toBe(
      "realtime",
    );
    expect(SCOUT_V2_ACTIVITY_QUEUE_CLASSES.stageLakeProjectionV2).toBe("lake");
    expect(SCOUT_V2_ACTIVITY_QUEUE_CLASSES.renderNotificationArtifactV2).toBe(
      "background",
    );
    expect(
      SCOUT_V2_ACTIVITY_QUEUE_CLASSES.scanPipelineReconciliationPageV2,
    ).toBe("background");
    // `interactive` belongs to human-facing runs; nothing in the durable
    // pipeline may sit in front of one.
    expect(Object.values(SCOUT_V2_ACTIVITY_QUEUE_CLASSES)).not.toContain(
      "interactive",
    );
  });
});
