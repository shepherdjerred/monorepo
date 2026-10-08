import { expect, test } from "vitest";
import { historyFromJSON } from "@temporalio/common/lib/proto-utils.js";
import type { WorkflowHandle } from "@temporalio/client";
import { Worker } from "@temporalio/worker";
import { DeterminismViolationError } from "@temporalio/workflow";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  SCOUT_RENAMED_WORKFLOW_TYPES,
  SCOUT_WORKFLOW_NAMES,
  scoutMatchProcessingWorkflowId,
} from "#src/identifiers.ts";
import { scoutMatchProcessingInputCodec } from "#src/workflow-contracts.ts";
import { scoutMatchProcessingWorkflow } from "./index.ts";
import {
  createScoutMatchStore,
  MATCH_ID,
  scoutMatchActivityStubs,
} from "./match.test-fixtures.ts";
import { useScoutWorkflowHarness } from "./workflow-harness.test-fixtures.ts";
import recordedDispatcher from "./fixtures/client-match-dispatch.mid-run.json" with { type: "json" };
import recordedMatchMidRun from "./fixtures/match-processing.mid-run.json" with { type: "json" };
import recordedMatchFanOut from "./fixtures/match-processing.fan-out-children.json" with { type: "json" };

/**
 * Histories recorded under the pre-rename Workflow and Activity types,
 * replayed against the renamed bundle, and what that bundle issues now.
 *
 * Replay checks every recorded command by type, so these are the executions
 * the rename could wedge: the client-match dispatcher singleton, which never
 * closes, caught after it started a match child; that child caught with an
 * Activity in flight; and a completed match run whose fan-out started its
 * notification and lake children. Each fixture was recorded by running the
 * pre-rename source against the same Activity stubs these tests use.
 *
 * In this release the bundle registers both names but still issues the old
 * ones, so a run recorded now matches what the pre-rename bundle records —
 * which is what lets the two run side by side.
 */

const harness = useScoutWorkflowHarness();
const workflowsPath = new URL("index.ts", import.meta.url).pathname;

type History = Awaited<ReturnType<WorkflowHandle["fetchHistory"]>>;

function fixtureHistory(recorded: unknown): History {
  return historyFromJSON(structuredClone(recorded));
}

/** What a history names: its own type, its Activity types and child types. */
function namesIn(history: History) {
  const events = history.events ?? [];
  return {
    workflowType:
      events[0]?.workflowExecutionStartedEventAttributes?.workflowType?.name,
    activities: events.flatMap((event) => {
      const name =
        event.activityTaskScheduledEventAttributes?.activityType?.name;
      return name === undefined || name === null ? [] : [name];
    }),
    children: events.flatMap((event) => {
      const name =
        event.startChildWorkflowExecutionInitiatedEventAttributes?.workflowType
          ?.name;
      return name === undefined || name === null ? [] : [name];
    }),
  };
}

test("a dispatcher caught mid-run under the pre-rename types replays", async () => {
  const recorded = fixtureHistory(recordedDispatcher);

  // The singleton as it runs in both namespaces today: the old type, with a
  // match child started under the old type and still running.
  expect(namesIn(recorded)).toEqual({
    workflowType: "scoutClientMatchDispatchV2Workflow",
    activities: ["readMatchPipelineStateV2"],
    children: ["scoutMatchProcessingV2Workflow"],
  });
  await Worker.runReplayHistory({ workflowsPath }, recorded);
}, 120_000);

test("a match run caught with a pre-rename Activity in flight replays", async () => {
  const recorded = fixtureHistory(recordedMatchMidRun);

  expect(namesIn(recorded)).toEqual({
    workflowType: "scoutMatchProcessingV2Workflow",
    activities: [
      "readMatchPipelineStateV2",
      "archiveMatchArtifactsV2",
      "commitMatchObservationV2",
    ],
    children: [],
  });

  await Worker.runReplayHistory({ workflowsPath }, recorded);
}, 120_000);

test("a match run whose fan-out started pre-rename children replays", async () => {
  const recorded = fixtureHistory(recordedMatchFanOut);

  expect(namesIn(recorded).children).toEqual([
    "scoutNotificationV2Workflow",
    "scoutLakeProjectionV2Workflow",
  ]);
  await Worker.runReplayHistory({ workflowsPath }, recorded);
}, 120_000);

test("the dispatcher fixture fails replay once its child names the new type", async () => {
  // The negative control: a bundle that issued the renamed child type where
  // the history recorded the old one would wedge this execution.
  const renamed =
    SCOUT_RENAMED_WORKFLOW_TYPES[SCOUT_WORKFLOW_NAMES.matchProcessing];
  const tampered = historyFromJSON(
    JSON.parse(
      JSON.stringify(recordedDispatcher).replace(
        `"name":"${SCOUT_WORKFLOW_NAMES.matchProcessing}"`,
        `"name":"${renamed}"`,
      ),
    ),
  );
  expect(namesIn(tampered).children).toEqual([renamed]);

  await expect(
    Worker.runReplayHistory({ workflowsPath }, tampered),
  ).rejects.toBeInstanceOf(DeterminismViolationError);
}, 120_000);

const matchInput = scoutMatchProcessingInputCodec.serialize({
  stage: "dev",
  riotMatchId: MATCH_ID,
  sourcePuuid: LeaguePuuidSchema.parse("s".repeat(78)),
  deliveryMode: "live",
});

test("a run recorded now issues the pre-rename types, as the old bundle does", async () => {
  await harness.startWorkers(scoutMatchActivityStubs(createScoutMatchStore()));
  const handle = await harness
    .client()
    .workflow.start(SCOUT_WORKFLOW_NAMES.matchProcessing, {
      taskQueue: "scout-dev",
      workflowId: scoutMatchProcessingWorkflowId("dev", MATCH_ID),
      args: [matchInput],
    });
  await handle.result();
  const recorded = await handle.fetchHistory();
  const names = namesIn(recorded);

  expect(names.workflowType).toBe("scoutMatchProcessingV2Workflow");
  expect(names.activities.filter((name) => !name.endsWith("V2"))).toEqual([]);
  expect(names.children).toEqual([
    "scoutNotificationV2Workflow",
    "scoutLakeProjectionV2Workflow",
  ]);

  await Worker.runReplayHistory({ workflowsPath }, recorded);
}, 120_000);

test("the renamed Workflow type is registered too", async () => {
  // The follow-up switches issuance to the new names, so every bundle in this
  // release must already resolve them.
  await harness.startWorkers(scoutMatchActivityStubs(createScoutMatchStore()));
  const handle = await harness
    .client()
    .workflow.start(scoutMatchProcessingWorkflow, {
      taskQueue: "scout-dev",
      workflowId: scoutMatchProcessingWorkflowId("dev", MATCH_ID),
      args: [matchInput],
    });
  await handle.result();
  const recorded = await handle.fetchHistory();

  expect(namesIn(recorded).workflowType).toBe(
    SCOUT_RENAMED_WORKFLOW_TYPES[SCOUT_WORKFLOW_NAMES.matchProcessing],
  );
}, 120_000);
