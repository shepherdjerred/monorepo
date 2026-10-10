import { afterEach, beforeEach, expect, test } from "vitest";
import { z } from "zod";
import { historyFromJSON } from "@temporalio/common/lib/proto-utils.js";
import type { WorkflowHandle } from "@temporalio/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { DeterminismViolationError } from "@temporalio/workflow";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import type { ScoutReconciliationScanResult } from "#src/activity-contracts.ts";
import {
  SCOUT_PRE_RENAME_WORKFLOW_TYPES,
  SCOUT_WORKFLOW_NAMES,
  scoutMatchProcessingWorkflowId,
  scoutPipelineReconciliationWorkflowId,
  withPreRenameActivityNames,
} from "#src/identifiers.ts";
import {
  scoutMatchProcessingInputCodec,
  scoutPipelineReconciliationInputCodec,
} from "#src/workflow-contracts.ts";
import { SCOUT_GENERATION_RENAME_PATCH } from "./generation-rename.ts";
import {
  createLakeStore,
  createReconciliationStore,
  emptyPending,
  LAKE_MATCH_ID,
  scoutLakeStubs,
  scoutReconciliationStubs,
} from "./durable.test-fixtures.ts";
import {
  createScoutMatchStore,
  MATCH_ID,
  scoutMatchActivityStubs,
} from "./match.test-fixtures.ts";
import { createScoutWorkerPool } from "./worker-pool.test-fixtures.ts";
import recordedDispatcher from "./fixtures/client-match-dispatch.mid-run.json" with { type: "json" };
import recordedMatchMidRun from "./fixtures/match-processing.mid-run.json" with { type: "json" };
import recordedMatchFanOut from "./fixtures/match-processing.fan-out-children.json" with { type: "json" };

/**
 * The generation rename, from both sides of the `scout-generation-rename`
 * patch.
 *
 * Replay checks every recorded command by type, so the executions the switch
 * to the renamed types could wedge are the ones recorded before it under the
 * pre-rename types: the client-match dispatcher singleton, which never
 * closes, caught after it started a match child; that child caught with an
 * Activity in flight; and a completed match run whose fan-out started its
 * notification and lake children. Each fixture was recorded by running the
 * pre-rename source against the same Activity stubs these tests use.
 *
 * The rest record histories now. A Workflow worker whose
 * `patchActivationCallback` withholds the patch issues exactly the commands
 * the previous bundle did — pre-rename types and no marker — so it stands in
 * for that bundle, and swapping it for an ordinary worker mid-run is the
 * deploy itself.
 */

const workflowsPath = new URL("index.ts", import.meta.url).pathname;
const stage = "dev" as const;

let environment: TestWorkflowEnvironment;
const workflowWorkers = createScoutWorkerPool();
const activityWorkers = createScoutWorkerPool();

beforeEach(async () => {
  environment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterEach(async () => {
  await workflowWorkers.drain();
  await activityWorkers.drain();
  await environment.teardown();
});

/**
 * One Workflow worker: this bundle as deployed, or this bundle with the
 * rename patch withheld, which is what the previous bundle recorded. The
 * pre-patch worker caches nothing, so swapping it out mid-run hands the next
 * Workflow Task straight to its replacement.
 */
async function startWorkflowWorker(
  generation: "renamed" | "pre-patch",
): Promise<void> {
  await workflowWorkers.start(
    await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: "scout-dev",
      workflowsPath,
      maxConcurrentWorkflowTaskExecutions: 4,
      ...(generation === "pre-patch"
        ? {
            maxCachedWorkflows: 0,
            patchActivationCallback: ({ patchId }) =>
              patchId !== SCOUT_GENERATION_RENAME_PATCH,
          }
        : {}),
    }),
  );
}

/** Activity workers registering both names, as the production ones do. */
async function startActivityWorkers(
  queues: Readonly<Partial<Record<"realtime" | "background" | "lake", object>>>,
): Promise<void> {
  for (const [queue, activities] of Object.entries(queues)) {
    await activityWorkers.start(
      await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: `scout-dev-${queue}`,
        activities: withPreRenameActivityNames(activities),
        maxConcurrentActivityTaskExecutions: 4,
      }),
    );
  }
}

type History = Awaited<ReturnType<WorkflowHandle["fetchHistory"]>>;
type HistoryEvent = NonNullable<History["events"]>[number];

function fixtureHistory(recorded: unknown): History {
  return historyFromJSON(structuredClone(recorded));
}

/** The marker name the TypeScript SDK records `patched` calls under. */
const PATCH_MARKER = "core_patch";

const PatchMarkerDataSchema = z.strictObject({
  id: z.string(),
  deprecated: z.boolean(),
});

function presentName(name: string | null | undefined): string[] {
  return name === undefined || name === null ? [] : [name];
}

/**
 * What a history names: its own type, its Activity and child types, the type
 * it continued as, and whether it recorded the rename patch.
 */
function namesIn(history: History) {
  const events = history.events ?? [];
  return {
    workflowType:
      events[0]?.workflowExecutionStartedEventAttributes?.workflowType?.name,
    activities: events.flatMap((event) =>
      presentName(
        event.activityTaskScheduledEventAttributes?.activityType?.name,
      ),
    ),
    children: events.flatMap((event) =>
      presentName(
        event.startChildWorkflowExecutionInitiatedEventAttributes?.workflowType
          ?.name,
      ),
    ),
    continuedAs: events.flatMap((event) =>
      presentName(
        event.workflowExecutionContinuedAsNewEventAttributes?.workflowType
          ?.name,
      ),
    ),
    renamePatchMarkers: events.filter((event) => recordsRenamePatch(event))
      .length,
  };
}

function recordsRenamePatch(event: HistoryEvent): boolean {
  const marker = event.markerRecordedEventAttributes;
  const decoder = new TextDecoder();
  return (
    marker?.markerName === PATCH_MARKER &&
    Object.values(marker.details ?? {}).some((payloads) =>
      (payloads.payloads ?? []).some(
        (payload) =>
          PatchMarkerDataSchema.parse(
            JSON.parse(decoder.decode(payload.data ?? new Uint8Array())),
          ).id === SCOUT_GENERATION_RENAME_PATCH,
      ),
    )
  );
}

/** The names that still carry the generation suffix. */
function preRenameNames(names: readonly string[]): string[] {
  return names.filter((name) => /V2(?:Workflow)?$/u.test(name));
}

// ─── Histories recorded before the patch ───────────────────────────────────

test("a dispatcher caught mid-run under the pre-rename types replays", async () => {
  const recorded = fixtureHistory(recordedDispatcher);

  // The singleton as it runs in both namespaces today: the old type, with a
  // match child started under the old type and still running.
  expect(namesIn(recorded)).toMatchObject({
    workflowType: "scoutClientMatchDispatchV2Workflow",
    activities: ["readMatchPipelineStateV2"],
    children: ["scoutMatchProcessingV2Workflow"],
    renamePatchMarkers: 0,
  });
  await Worker.runReplayHistory({ workflowsPath }, recorded);
}, 120_000);

test("a match run caught with a pre-rename Activity in flight replays", async () => {
  const recorded = fixtureHistory(recordedMatchMidRun);

  expect(namesIn(recorded)).toMatchObject({
    workflowType: "scoutMatchProcessingV2Workflow",
    activities: [
      "readMatchPipelineStateV2",
      "archiveMatchArtifactsV2",
      "commitMatchObservationV2",
    ],
    children: [],
    renamePatchMarkers: 0,
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
  // the history recorded the old one, with no patch to tell them apart,
  // would wedge this execution.
  const preRename =
    SCOUT_PRE_RENAME_WORKFLOW_TYPES[SCOUT_WORKFLOW_NAMES.matchProcessing];
  const tampered = historyFromJSON(
    JSON.parse(
      JSON.stringify(recordedDispatcher).replace(
        `"name":"${preRename}"`,
        `"name":"${SCOUT_WORKFLOW_NAMES.matchProcessing}"`,
      ),
    ),
  );
  expect(namesIn(tampered).children).toEqual([
    SCOUT_WORKFLOW_NAMES.matchProcessing,
  ]);

  await expect(
    Worker.runReplayHistory({ workflowsPath }, tampered),
  ).rejects.toBeInstanceOf(DeterminismViolationError);
}, 120_000);

// ─── Histories recorded now ────────────────────────────────────────────────

const matchInput = scoutMatchProcessingInputCodec.serialize({
  stage,
  riotMatchId: MATCH_ID,
  sourcePuuid: LeaguePuuidSchema.parse("s".repeat(78)),
  deliveryMode: "live",
});

async function recordMatchRun(workflowType: string): Promise<History> {
  await startActivityWorkers({
    realtime: scoutMatchActivityStubs(createScoutMatchStore()),
  });
  const handle = await environment.client.workflow.start(workflowType, {
    taskQueue: "scout-dev",
    workflowId: scoutMatchProcessingWorkflowId(stage, MATCH_ID),
    args: [matchInput],
  });
  await handle.result();
  return await handle.fetchHistory();
}

test("a match run recorded now issues the renamed types behind the patch", async () => {
  await startWorkflowWorker("renamed");
  const recorded = await recordMatchRun(SCOUT_WORKFLOW_NAMES.matchProcessing);
  const names = namesIn(recorded);

  expect(names.workflowType).toBe("scoutMatchProcessingWorkflow");
  expect(names.activities.length).toBeGreaterThan(0);
  expect(preRenameNames(names.activities)).toEqual([]);
  expect(names.children).toEqual([
    "scoutNotificationWorkflow",
    "scoutLakeProjectionWorkflow",
  ]);
  expect(names.renamePatchMarkers).toBe(1);

  await Worker.runReplayHistory({ workflowsPath }, recorded);
}, 120_000);

test("a run the Schedule started under the pre-rename type issues the renamed types too", async () => {
  // Schedules and clients switch with this release, but a start already in
  // flight under the old type still lands on this bundle.
  await startWorkflowWorker("renamed");
  const recorded = await recordMatchRun(
    SCOUT_PRE_RENAME_WORKFLOW_TYPES[SCOUT_WORKFLOW_NAMES.matchProcessing],
  );
  const names = namesIn(recorded);

  expect(names.workflowType).toBe("scoutMatchProcessingV2Workflow");
  expect(preRenameNames(names.activities)).toEqual([]);
  expect(names.children).toEqual([
    "scoutNotificationWorkflow",
    "scoutLakeProjectionWorkflow",
  ]);
  await Worker.runReplayHistory({ workflowsPath }, recorded);
}, 120_000);

test("with the patch withheld a run issues the pre-rename types and replays as renamed", async () => {
  // What the previous bundle recorded for the same run, and the proof that
  // such a history replays on this one.
  await startWorkflowWorker("pre-patch");
  const recorded = await recordMatchRun(
    SCOUT_PRE_RENAME_WORKFLOW_TYPES[SCOUT_WORKFLOW_NAMES.matchProcessing],
  );
  const names = namesIn(recorded);

  expect(names.renamePatchMarkers).toBe(0);
  expect(names.activities.length).toBeGreaterThan(0);
  expect(preRenameNames(names.activities)).toEqual(names.activities);
  expect(names.children).toEqual([
    "scoutNotificationV2Workflow",
    "scoutLakeProjectionV2Workflow",
  ]);

  await Worker.runReplayHistory({ workflowsPath }, recorded);
}, 120_000);

const SECOND_LAKE_MATCH_ID = RiotMatchIdSchema.parse("NA1_9104");

function lakePage(
  riotMatchId: typeof LAKE_MATCH_ID,
): ScoutReconciliationScanResult["pending"] {
  return { ...emptyPending(), lakeProjections: [riotMatchId] };
}

test("an open run deployed onto mid-flight switches to the renamed types from there on", async () => {
  // A reconciliation sweep, started under the old type and caught with its
  // second scan in flight when the bundle changes underneath it. Everything
  // it issued before the deploy keeps the old names on replay; everything
  // after carries the renamed ones, behind one marker.
  const store = createReconciliationStore({
    pages: [
      lakePage(LAKE_MATCH_ID),
      lakePage(SECOND_LAKE_MATCH_ID),
      emptyPending(),
    ],
  });
  const stubs = scoutReconciliationStubs(store);
  const secondScanStarted = Promise.withResolvers<true>();
  const releaseSecondScan = Promise.withResolvers<true>();
  await startActivityWorkers({
    background: {
      scanPipelineReconciliationPage: async (input: { trigger: string }) => {
        if (store.scanned === 1) {
          secondScanStarted.resolve(true);
          await releaseSecondScan.promise;
        }
        return stubs.scanPipelineReconciliationPage(input);
      },
    },
    lake: scoutLakeStubs(createLakeStore()),
  });
  await startWorkflowWorker("pre-patch");

  const handle = await environment.client.workflow.start(
    SCOUT_PRE_RENAME_WORKFLOW_TYPES[
      SCOUT_WORKFLOW_NAMES.pipelineReconciliation
    ],
    {
      taskQueue: "scout-dev",
      workflowId: scoutPipelineReconciliationWorkflowId(stage, "operator"),
      args: [
        scoutPipelineReconciliationInputCodec.serialize({
          stage,
          trigger: "operator",
        }),
      ],
    },
  );
  await secondScanStarted.promise;
  await workflowWorkers.drain();
  await startWorkflowWorker("renamed");
  releaseSecondScan.resolve(true);
  await handle.result();
  const recorded = await handle.fetchHistory();

  expect(namesIn(recorded)).toMatchObject({
    workflowType: "scoutPipelineReconciliationV2Workflow",
    activities: [
      "scanPipelineReconciliationPageV2",
      "scanPipelineReconciliationPageV2",
      "scanPipelineReconciliationPage",
    ],
    children: ["scoutLakeProjectionV2Workflow", "scoutLakeProjectionWorkflow"],
    renamePatchMarkers: 1,
  });
  await Worker.runReplayHistory({ workflowsPath }, recorded);
}, 120_000);

/** Pages enough that one run's budget runs out and it continues as new. */
function pagesPastOneRun(): ScoutReconciliationScanResult["pending"][] {
  return Array.from({ length: 30 }, () => emptyPending());
}

async function sweepUnderPreRenameType(): Promise<{
  firstRun: History;
  latestType: string;
}> {
  await startActivityWorkers({
    background: scoutReconciliationStubs(
      createReconciliationStore({ pages: pagesPastOneRun() }),
    ),
  });
  const workflowId = scoutPipelineReconciliationWorkflowId(stage, "schedule");
  const handle = await environment.client.workflow.start(
    SCOUT_PRE_RENAME_WORKFLOW_TYPES[
      SCOUT_WORKFLOW_NAMES.pipelineReconciliation
    ],
    {
      taskQueue: "scout-dev",
      workflowId,
      args: [
        scoutPipelineReconciliationInputCodec.serialize({
          stage,
          trigger: "schedule",
        }),
      ],
    },
  );
  await handle.result();
  const firstRun = await environment.client.workflow
    .getHandle(workflowId, handle.firstExecutionRunId)
    .fetchHistory();
  const latest = await environment.client.workflow
    .getHandle(workflowId)
    .describe();
  return { firstRun, latestType: latest.type };
}

test("a run under the pre-rename type continues as new under the renamed type", async () => {
  // How the long-lived Workflows leave the old type: the client-match
  // dispatcher singleton and recovery batches take the same path when they
  // continue as new.
  await startWorkflowWorker("renamed");
  const { firstRun, latestType } = await sweepUnderPreRenameType();

  expect(namesIn(firstRun)).toMatchObject({
    workflowType: "scoutPipelineReconciliationV2Workflow",
    continuedAs: ["scoutPipelineReconciliationWorkflow"],
    renamePatchMarkers: 1,
  });
  expect(latestType).toBe("scoutPipelineReconciliationWorkflow");
  await Worker.runReplayHistory({ workflowsPath }, firstRun);
}, 120_000);

test("with the patch withheld a run continues as new under the type it ran as", async () => {
  await startWorkflowWorker("pre-patch");
  const { firstRun, latestType } = await sweepUnderPreRenameType();

  expect(namesIn(firstRun)).toMatchObject({
    continuedAs: ["scoutPipelineReconciliationV2Workflow"],
    renamePatchMarkers: 0,
  });
  expect(latestType).toBe("scoutPipelineReconciliationV2Workflow");
}, 120_000);
