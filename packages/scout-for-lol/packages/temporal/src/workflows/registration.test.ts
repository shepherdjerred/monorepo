import { afterEach, beforeEach, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import {
  RecoveryBatchIdSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  ScoutNotificationIntentKeySchema,
  ScoutPrematchGameRefSchema,
} from "#src/pipeline-contracts.ts";
import {
  scoutLakeProjectionInputCodec,
  scoutClientMatchDispatchInputCodec,
  scoutMatchProcessingInputCodec,
  scoutNotificationInputCodec,
  scoutPipelineReconciliationInputCodec,
  scoutPostMatchDiscoveryInputCodec,
  scoutPrematchDiscoveryInputCodec,
  scoutPrematchGameInputCodec,
  scoutRecoveryBatchInputCodec,
} from "#src/workflow-contracts.ts";
import {
  SCOUT_WORKFLOW_NAMES,
  SCOUT_PIPELINE_WORKFLOW_NAMES,
  scoutLakeProjectionWorkflowId,
  scoutClientMatchDispatchWorkflowId,
  scoutMatchProcessingWorkflowId,
  scoutNotificationWorkflowId,
  scoutPipelineReconciliationWorkflowId,
  scoutPostMatchDiscoveryWorkflowId,
  scoutPrematchGameWorkflowId,
  scoutRecoveryBatchWorkflowId,
} from "#src/identifiers.ts";
import {
  applicationFailureOf,
  settleWorkflow,
} from "./workflow-harness.test-fixtures.ts";

let environment: TestWorkflowEnvironment;

beforeEach(async () => {
  environment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterEach(async () => {
  await environment.teardown();
});

const stage = "dev" as const;
const riotMatchId = RiotMatchIdSchema.parse("NA1_5312279829");
const intentKey = ScoutNotificationIntentKeySchema.parse(
  "notify:NA1_5312279829:guild:1234567890",
);
const recoveryBatchId = RecoveryBatchIdSchema.parse("recovery_01");
const gameRef = ScoutPrematchGameRefSchema.parse({
  puuid: "p".repeat(78),
  platform: "NA1",
  gameId: "5312279829",
});

/**
 * Each V2 type, started the way production will start it: by NAME, with the
 * ID its builder computes and an input its codec serialized. Naming the type
 * as a string rather than importing the function is the point — that is what
 * a Schedule, an operator and a reconciliation sweep all do, and it is the
 * only way the test can tell registration from a local import.
 *
 * `implemented` marks the types whose lane has landed a body. They stay in
 * this list because the list is also the registry cross-check below — every
 * V2 type must appear exactly once — but they are not started here: a type
 * with a body schedules Activities, and asserting how it behaves belongs to
 * the tests that stand up its Activity worker.
 */
const registrations = [
  {
    name: SCOUT_WORKFLOW_NAMES.postMatchDiscovery,
    workflowId: scoutPostMatchDiscoveryWorkflowId(stage, "schedule"),
    input: scoutPostMatchDiscoveryInputCodec.serialize({
      stage,
      trigger: "schedule",
    }),
    implemented: true,
  },
  {
    name: SCOUT_WORKFLOW_NAMES.matchProcessing,
    workflowId: scoutMatchProcessingWorkflowId(stage, riotMatchId),
    input: scoutMatchProcessingInputCodec.serialize({ stage, riotMatchId }),
    implemented: true,
  },
  {
    name: SCOUT_WORKFLOW_NAMES.clientMatchDispatch,
    workflowId: scoutClientMatchDispatchWorkflowId(stage),
    input: scoutClientMatchDispatchInputCodec.serialize({
      stage,
      pending: [],
      lateArrivals: [],
      orderingWatermark: null,
    }),
    implemented: true,
  },
  {
    name: SCOUT_WORKFLOW_NAMES.prematchDiscovery,
    workflowId: `scout-${stage}-prematch-poll-workflow`,
    input: scoutPrematchDiscoveryInputCodec.serialize({ stage }),
    implemented: true,
  },
  {
    name: SCOUT_WORKFLOW_NAMES.prematchGame,
    workflowId: scoutPrematchGameWorkflowId(stage, gameRef),
    input: scoutPrematchGameInputCodec.serialize({ stage, gameRef }),
    implemented: true,
  },
  {
    name: SCOUT_WORKFLOW_NAMES.notification,
    workflowId: scoutNotificationWorkflowId(stage, intentKey),
    input: scoutNotificationInputCodec.serialize({ stage, intentKey }),
    implemented: true,
  },
  {
    name: SCOUT_WORKFLOW_NAMES.lakeProjection,
    workflowId: scoutLakeProjectionWorkflowId(stage, riotMatchId),
    input: scoutLakeProjectionInputCodec.serialize({ stage, riotMatchId }),
    implemented: true,
  },
  {
    name: SCOUT_WORKFLOW_NAMES.recoveryBatch,
    workflowId: scoutRecoveryBatchWorkflowId(stage, recoveryBatchId),
    input: scoutRecoveryBatchInputCodec.serialize({
      stage,
      recoveryBatchId,
    }),
    implemented: true,
  },
  {
    name: SCOUT_WORKFLOW_NAMES.pipelineReconciliation,
    workflowId: scoutPipelineReconciliationWorkflowId(stage, "operator"),
    input: scoutPipelineReconciliationInputCodec.serialize({
      stage,
      trigger: "operator",
    }),
    implemented: true,
  },
] as const;

test("registers all nine V2 types, and every unimplemented one refuses to run", async () => {
  expect(registrations.map((entry) => entry.name)).toEqual([
    ...SCOUT_PIPELINE_WORKFLOW_NAMES,
  ]);
  const unimplemented = registrations.filter((entry) => !entry.implemented);

  const worker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: "scout-dev",
    workflowsPath: new URL("index.ts", import.meta.url).pathname,
    maxConcurrentWorkflowTaskExecutions: 4,
  });

  await worker.runUntil(async () => {
    for (const entry of unimplemented) {
      // A type missing from the bundle fails its workflow task and retries
      // forever, so this settling at all is the registration proof; the
      // assertions are that it stopped, terminally, and said why.
      const failure = applicationFailureOf(
        await settleWorkflow(
          environment.client.workflow.execute(entry.name, {
            taskQueue: "scout-dev",
            workflowId: entry.workflowId,
            args: [entry.input],
          }),
        ),
      );

      expect(failure?.type).toBe("UnimplementedWorkflow");
      expect(failure?.nonRetryable).toBe(true);
      expect(failure?.message).toContain(entry.name);
    }
  });
}, 120_000);
