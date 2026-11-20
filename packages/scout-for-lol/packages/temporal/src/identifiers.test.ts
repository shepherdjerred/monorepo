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
  SCOUT_PRE_RENAME_WORKFLOW_TYPES,
  SCOUT_WORKFLOW_NAMES,
  scoutRenamedWorkflowType,
  scoutPreRenameActivityType,
  scoutChallengeRunRecomputeWorkflowId,
  scoutDuelSeriesWorkflowId,
  scoutCoachReviewWorkflowId,
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
  scoutProbeTaskQueues,
  scoutQueueCanaryProbeRoutes,
  assertScoutQueueCanaryProbe,
} from "./identifiers.ts";

function canaryRoute(reservedProbeSlots: boolean): string[][] {
  return scoutQueueCanaryProbeRoutes("prod", {
    includeGateway: true,
    reservedProbeSlots,
  }).map(({ queueClass, dispatchTaskQueue, servedTaskQueue }) => [
    queueClass,
    dispatchTaskQueue,
    servedTaskQueue,
  ]);
}

describe("Scout Temporal identifiers", () => {
  test("derives one workflow queue and isolated activity queues per stage", () => {
    expect(scoutTaskQueues("beta")).toEqual({
      workflow: "scout-beta",
      realtime: "scout-beta-realtime",
      interactive: "scout-beta-interactive",
      background: "scout-beta-background",
      lake: "scout-beta-lake",
      crawl: "scout-beta-crawl",
      gateway: "scout-beta-gateway",
    });
  });

  test("uses stable product identifiers without random suffixes", () => {
    expect(
      scoutExploreHistoryWorkflowId("beta", "puuid_123", 456, "ranked"),
    ).toBe(scoutExploreHistoryWorkflowId("beta", "puuid_123", 456));
    expect(
      scoutExploreHistoryWorkflowId("beta", "puuid_123", 456, "normal"),
    ).toBe("scout-beta-explore-history-puuid_123-456-normal");
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
    expect(
      scoutCoachReviewWorkflowId(
        "beta",
        "123456789012345678",
        "NA1_5123456789",
      ),
    ).toBe("scout-beta-coach-review-123456789012345678-NA1_5123456789");
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

describe("the generation rename", () => {
  test("issues every pipeline type under its renamed name", () => {
    expect(
      Object.values(SCOUT_WORKFLOW_NAMES).filter((name) =>
        name.endsWith("V2Workflow"),
      ),
    ).toEqual([]);
    expect(SCOUT_PRE_RENAME_WORKFLOW_TYPES).toMatchObject({
      scoutMatchProcessingWorkflow: "scoutMatchProcessingV2Workflow",
      scoutPrematchDiscoveryWorkflow: "scoutPrematchDiscoveryV2Workflow",
    });
  });

  test("compares a recorded pre-rename type under the name issued now", () => {
    for (const [renamed, preRename] of Object.entries(
      SCOUT_PRE_RENAME_WORKFLOW_TYPES,
    )) {
      expect(scoutRenamedWorkflowType(preRename)).toBe(renamed);
      expect(scoutRenamedWorkflowType(renamed)).toBe(renamed);
    }
    expect(scoutRenamedWorkflowType(SCOUT_WORKFLOW_NAMES.reportRun)).toBe(
      "scoutReportRunWorkflow",
    );
  });

  test("names the Activity a pre-patch history scheduled", () => {
    expect(scoutPreRenameActivityType("commitMatchObservation")).toBe(
      "commitMatchObservationV2",
    );
    // Kept their names across the rename, so a history names them as is.
    expect(scoutPreRenameActivityType("readLegacyMatchCompletionV2")).toBe(
      "readLegacyMatchCompletionV2",
    );
    expect(scoutPreRenameActivityType("runPrematchMaintenance")).toBe(
      "runPrematchMaintenance",
    );
    // Not a pipeline Activity, so never renamed.
    expect(scoutPreRenameActivityType("runReport")).toBe("runReport");
  });

  test("gives each slot-budgeted work queue a reserved canary probe queue", () => {
    expect(scoutProbeTaskQueues("prod")).toEqual({
      realtime: "scout-prod-realtime-probe",
      interactive: "scout-prod-interactive-probe",
      background: "scout-prod-background-probe",
      lake: "scout-prod-lake-probe",
    });
  });

  test("routes canary probes to reserved queues only under the patch", () => {
    expect(canaryRoute(true)).toEqual([
      ["realtime", "scout-prod-realtime-probe", "scout-prod-realtime"],
      ["interactive", "scout-prod-interactive-probe", "scout-prod-interactive"],
      ["background", "scout-prod-background-probe", "scout-prod-background"],
      ["lake", "scout-prod-lake-probe", "scout-prod-lake"],
      ["gateway", "scout-prod-gateway", "scout-prod-gateway"],
    ]);
    // Retained pre-patch histories scheduled every probe on its work queue.
    expect(canaryRoute(false)).toEqual([
      ["realtime", "scout-prod-realtime", "scout-prod-realtime"],
      ["interactive", "scout-prod-interactive", "scout-prod-interactive"],
      ["background", "scout-prod-background", "scout-prod-background"],
      ["lake", "scout-prod-lake", "scout-prod-lake"],
      ["gateway", "scout-prod-gateway", "scout-prod-gateway"],
    ]);
  });

  test("refuses a canary probe that does not prove its route", () => {
    const background = scoutQueueCanaryProbeRoutes("prod", {
      includeGateway: false,
      reservedProbeSlots: true,
    }).find((candidate) => candidate.queueClass === "background");
    if (background === undefined) throw new Error("No background route");
    const probe = {
      stage: "prod",
      canaryId: "ai-544",
      queueClass: "background",
      taskQueue: "scout-prod-background",
      probeTaskQueue: "scout-prod-background-probe",
    } as const;
    expect(() => {
      assertScoutQueueCanaryProbe(background, probe);
    }).not.toThrow();
    expect(() => {
      assertScoutQueueCanaryProbe(background, {
        ...probe,
        taskQueue: "scout-prod-realtime",
      });
    }).toThrow(/ran on scout-prod-realtime, expected scout-prod-background/);
    expect(() => {
      assertScoutQueueCanaryProbe(background, {
        ...probe,
        probeTaskQueue: "scout-prod-background",
      });
    }).toThrow(/probe ran on scout-prod-background/);
    expect(() => {
      assertScoutQueueCanaryProbe(background, {
        ...probe,
        queueClass: "lake",
      });
    }).toThrow(/expected scout-prod-background/);
  });
});
