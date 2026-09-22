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
} from "#src/contracts-v2.ts";
import {
  scoutLakeProjectionV2InputCodec,
  scoutClientMatchDispatchV2InputCodec,
  scoutMatchProcessingV2InputCodec,
  scoutNotificationV2InputCodec,
  scoutPipelineReconciliationV2InputCodec,
  scoutPostMatchDiscoveryV2InputCodec,
  scoutPrematchDiscoveryV2InputCodec,
  scoutPrematchGameV2InputCodec,
  scoutRecoveryBatchV2InputCodec,
} from "#src/workflow-contracts-v2.ts";
import {
  SCOUT_WORKFLOW_NAMES,
  SCOUT_V2_WORKFLOW_NAMES,
  scoutLakeProjectionV2WorkflowId,
  scoutClientMatchDispatchV2WorkflowId,
  scoutMatchProcessingV2WorkflowId,
  scoutNotificationV2WorkflowId,
  scoutPipelineReconciliationV2WorkflowId,
  scoutPostMatchDiscoveryV2WorkflowId,
  scoutPrematchDiscoveryV2WorkflowId,
  scoutPrematchGameV2WorkflowId,
  scoutRecoveryBatchV2WorkflowId,
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
    name: SCOUT_WORKFLOW_NAMES.postMatchDiscoveryV2,
    workflowId: scoutPostMatchDiscoveryV2WorkflowId(stage, "schedule"),
    input: scoutPostMatchDiscoveryV2InputCodec.serialize({
      stage,
      trigger: "schedule",
    }),
    implemented: true,
  },
  {
    name: SCOUT_WORKFLOW_NAMES.matchProcessingV2,
    workflowId: scoutMatchProcessingV2WorkflowId(stage, riotMatchId),
    input: scoutMatchProcessingV2InputCodec.serialize({ stage, riotMatchId }),
    implemented: true,
  },
  {
    name: SCOUT_WORKFLOW_NAMES.clientMatchDispatchV2,
    workflowId: scoutClientMatchDispatchV2WorkflowId(stage),
    input: scoutClientMatchDispatchV2InputCodec.serialize({
      stage,
      pending: [],
      lateArrivals: [],
      orderingWatermark: null,
    }),
    implemented: true,
  },
  {
    name: SCOUT_WORKFLOW_NAMES.prematchDiscoveryV2,
    workflowId: scoutPrematchDiscoveryV2WorkflowId(stage),
    input: scoutPrematchDiscoveryV2InputCodec.serialize({ stage }),
    implemented: true,
  },
  {
    name: SCOUT_WORKFLOW_NAMES.prematchGameV2,
    workflowId: scoutPrematchGameV2WorkflowId(stage, gameRef),
    input: scoutPrematchGameV2InputCodec.serialize({ stage, gameRef }),
    implemented: true,
  },
  {
    name: SCOUT_WORKFLOW_NAMES.notificationV2,
    workflowId: scoutNotificationV2WorkflowId(stage, intentKey),
    input: scoutNotificationV2InputCodec.serialize({ stage, intentKey }),
    implemented: true,
  },
  {
    name: SCOUT_WORKFLOW_NAMES.lakeProjectionV2,
    workflowId: scoutLakeProjectionV2WorkflowId(stage, riotMatchId),
    input: scoutLakeProjectionV2InputCodec.serialize({ stage, riotMatchId }),
    implemented: true,
  },
  {
    name: SCOUT_WORKFLOW_NAMES.recoveryBatchV2,
    workflowId: scoutRecoveryBatchV2WorkflowId(stage, recoveryBatchId),
    input: scoutRecoveryBatchV2InputCodec.serialize({
      stage,
      recoveryBatchId,
    }),
    implemented: true,
  },
  {
    name: SCOUT_WORKFLOW_NAMES.pipelineReconciliationV2,
    workflowId: scoutPipelineReconciliationV2WorkflowId(stage, "operator"),
    input: scoutPipelineReconciliationV2InputCodec.serialize({
      stage,
      trigger: "operator",
    }),
    implemented: true,
  },
] as const;

test("registers all nine V2 types, and every unimplemented one refuses to run", async () => {
  expect(registrations.map((entry) => entry.name)).toEqual([
    ...SCOUT_V2_WORKFLOW_NAMES,
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
