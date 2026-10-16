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
  scoutPreRenameActivityType,
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
import { recordedUnderRenamedType } from "./recorded-history.test-fixtures.ts";
import { createScoutWorkerPool } from "./worker-pool.test-fixtures.ts";
import recordedDispatcher from "./fixtures/client-match-dispatch.mid-run.json" with { type: "json" };
import recordedMatchMidRun from "./fixtures/match-processing.mid-run.json" with { type: "json" };
import recordedMatchFanOut from "./fixtures/match-processing.fan-out-children.json" with { type: "json" };

/**
 * The generation rename, from both sides of the `scout-generation-rename`
 * patch, against a bundle that no longer registers the pre-rename types.
 *
 * The fixtures were recorded by running the pre-rename source against the
 * same Activity stubs these tests use: the client-match dispatcher singleton
 * caught after it started a match child, that child caught with an Activity in
 * flight, and a completed match run whose fan-out started its notification and
 * lake children. Under the type they were recorded with they no longer replay:
 * this bundle has no Workflow of that name, which is why the release that
 * dropped the aliases waited for every execution of those types to close.
 *
 * The bundle before the patch also ran executions under the renamed types
 * (Schedules and clients issued them first) while still scheduling the
 * pre-rename Activity and child types. Those commands still replay, because
 * the unpatched branch of the gate is unchanged; a fixture under its renamed
 * type stands in for such a history.
 *
 * The rest record histories now. A Workflow worker whose
 * `patchActivationCallback` withholds the patch issues exactly the commands
 * the previous bundle did — pre-rename Activity and child types and no marker
 * — so it stands in for that bundle, and swapping it for an ordinary worker
 * mid-run is the deploy that introduced the patch.
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

/**
 * Every Activity under its pre-rename name as well, as the Activity workers of
 * the release before this one registered them. Only a run recorded with the
 * patch withheld schedules those names.
 */
function withPreviousReleaseActivityNames(
  activities: object,
): Record<string, unknown> {
  const registered: Record<string, unknown> = { ...activities };
  for (const [name, implementation] of Object.entries(activities)) {
    registered[scoutPreRenameActivityType(name)] = implementation;
  }
  return registered;
}

async function startActivityWorkers(
  queues: Readonly<Partial<Record<"realtime" | "background" | "lake", object>>>,
  generation: "renamed" | "previous-release" = "renamed",
): Promise<void> {
  for (const [queue, activities] of Object.entries(queues)) {
    await activityWorkers.start(
      await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: `scout-dev-${queue}`,
        activities:
          generation === "previous-release"
            ? withPreviousReleaseActivityNames(activities)
            : activities,
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

test("a history under a pre-rename type no longer replays", async () => {
  const recorded = fixtureHistory(recordedDispatcher);

  // The singleton as it ran before the rename: the old type, with a match
  // child started under the old type and still running. An execution like
  // this one is what the alias removal had to wait out.
  expect(namesIn(recorded)).toMatchObject({
    workflowType: "scoutClientMatchDispatchV2Workflow",
    activities: ["readMatchPipelineStateV2"],
    children: ["scoutMatchProcessingV2Workflow"],
    renamePatchMarkers: 0,
  });
  await expect(
    Worker.runReplayHistory({ workflowsPath }, recorded),
  ).rejects.toThrow(
    /scoutClientMatchDispatchV2Workflow.*no such function is exported/u,
  );
}, 120_000);

test("a dispatcher's pre-patch commands under the renamed type replay", async () => {
  const recorded = recordedUnderRenamedType(
    recordedDispatcher,
    SCOUT_WORKFLOW_NAMES.clientMatchDispatch,
  );

  expect(namesIn(recorded)).toMatchObject({
    workflowType: "scoutClientMatchDispatchWorkflow",
    activities: ["readMatchPipelineStateV2"],
    children: ["scoutMatchProcessingV2Workflow"],
    renamePatchMarkers: 0,
  });
  await Worker.runReplayHistory({ workflowsPath }, recorded);
}, 120_000);

test("a match run's pre-patch Activity in flight under the renamed type replays", async () => {
  const recorded = recordedUnderRenamedType(
    recordedMatchMidRun,
    SCOUT_WORKFLOW_NAMES.matchProcessing,
  );

  expect(namesIn(recorded)).toMatchObject({
    workflowType: "scoutMatchProcessingWorkflow",
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

test("a match run's pre-patch fan-out children under the renamed type replay", async () => {
  const recorded = recordedUnderRenamedType(
    recordedMatchFanOut,
    SCOUT_WORKFLOW_NAMES.matchProcessing,
  );

  expect(namesIn(recorded).children).toEqual([
    "scoutNotificationV2Workflow",
    "scoutLakeProjectionV2Workflow",
  ]);
  await Worker.runReplayHistory({ workflowsPath }, recorded);
}, 120_000);

test("a pre-patch history fails replay once its child names the new type", async () => {
  // The negative control: a bundle that issued the renamed child type where
  // the history recorded the old one, with no patch to tell them apart,
  // would wedge this execution.
  const preRename =
    SCOUT_PRE_RENAME_WORKFLOW_TYPES[SCOUT_WORKFLOW_NAMES.matchProcessing];
  const tampered = recordedUnderRenamedType(
    JSON.parse(
      JSON.stringify(recordedDispatcher).replace(
        `"name":"${preRename}"`,
        `"name":"${SCOUT_WORKFLOW_NAMES.matchProcessing}"`,
      ),
    ),
    SCOUT_WORKFLOW_NAMES.clientMatchDispatch,
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

async function recordMatchRun(
  generation: "renamed" | "previous-release",
): Promise<History> {
  await startActivityWorkers(
    { realtime: scoutMatchActivityStubs(createScoutMatchStore()) },
    generation,
  );
  const handle = await environment.client.workflow.start(
    SCOUT_WORKFLOW_NAMES.matchProcessing,
    {
      taskQueue: "scout-dev",
      workflowId: scoutMatchProcessingWorkflowId(stage, MATCH_ID),
      args: [matchInput],
    },
  );
  await handle.result();
  return await handle.fetchHistory();
}

test("a match run recorded now issues the renamed types behind the patch", async () => {
  await startWorkflowWorker("renamed");
  const recorded = await recordMatchRun("renamed");
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

test("with the patch withheld a run issues the pre-rename types and replays", async () => {
  // What the bundle before the patch recorded for a run the Schedules
  // started under the renamed type, and the proof that such a history
  // replays on this one. Its children name types this bundle does not run,
  // which is why no such execution may still be open when it deploys.
  await startWorkflowWorker("pre-patch");
  const recorded = await recordMatchRun("previous-release");
  const names = namesIn(recorded);

  expect(names.workflowType).toBe("scoutMatchProcessingWorkflow");
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

test("a run the patch reached mid-flight replays across the switch", async () => {
  // A reconciliation sweep caught with its second scan in flight when the
  // bundle that introduced the patch replaced the one before it. Everything
  // it issued before keeps the old names on replay; everything after carries
  // the renamed ones, behind one marker.
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
  await startActivityWorkers(
    {
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
    },
    "previous-release",
  );
  await startWorkflowWorker("pre-patch");

  const handle = await environment.client.workflow.start(
    SCOUT_WORKFLOW_NAMES.pipelineReconciliation,
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
    workflowType: "scoutPipelineReconciliationWorkflow",
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

test("a sweep continues as new under the renamed type behind the patch", async () => {
  // How the long-lived Workflows stay on the renamed type: the client-match
  // dispatcher singleton and recovery batches take the same path when they
  // continue as new.
  await startWorkflowWorker("renamed");
  await startActivityWorkers({
    background: scoutReconciliationStubs(
      createReconciliationStore({ pages: pagesPastOneRun() }),
    ),
  });
  const workflowId = scoutPipelineReconciliationWorkflowId(stage, "schedule");
  const handle = await environment.client.workflow.start(
    SCOUT_WORKFLOW_NAMES.pipelineReconciliation,
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

  expect(namesIn(firstRun)).toMatchObject({
    workflowType: "scoutPipelineReconciliationWorkflow",
    continuedAs: ["scoutPipelineReconciliationWorkflow"],
    renamePatchMarkers: 1,
  });
  expect(latest.type).toBe("scoutPipelineReconciliationWorkflow");
  await Worker.runReplayHistory({ workflowsPath }, firstRun);
}, 120_000);
