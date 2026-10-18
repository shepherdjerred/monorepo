import { afterEach, beforeEach, expect, test } from "vitest";
import { z } from "zod";
import type { WorkflowHandle } from "@temporalio/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import type { ScoutReconciliationScanResult } from "#src/activity-contracts.ts";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutMatchProcessingWorkflowId,
  scoutPipelineReconciliationWorkflowId,
} from "#src/identifiers.ts";
import {
  scoutMatchProcessingInputCodec,
  scoutPipelineReconciliationInputCodec,
} from "#src/workflow-contracts.ts";
import { SCOUT_GENERATION_RENAME_PATCH } from "./generation-rename.ts";
import {
  createReconciliationStore,
  emptyPending,
  scoutReconciliationStubs,
} from "./durable.test-fixtures.ts";
import {
  createScoutMatchStore,
  MATCH_ID,
  scoutMatchActivityStubs,
} from "./match.test-fixtures.ts";
import { createScoutWorkerPool } from "./worker-pool.test-fixtures.ts";

/**
 * The renamed Workflow and Activity types, behind the retired
 * `scout-generation-rename` gate.
 *
 * Every retained history recorded the gate, so the pre-rename branch is gone
 * and the renamed types are issued unconditionally. The deprecated marker
 * still records where the gate stood, so a rollback to the bundle that gates
 * on it replays these histories instead of issuing pre-rename types.
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

async function startWorkflowWorker(): Promise<void> {
  await workflowWorkers.start(
    await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: "scout-dev",
      workflowsPath,
      maxConcurrentWorkflowTaskExecutions: 4,
    }),
  );
}

async function startActivityWorkers(
  queues: Readonly<Partial<Record<"realtime" | "background" | "lake", object>>>,
): Promise<void> {
  for (const [queue, activities] of Object.entries(queues)) {
    await activityWorkers.start(
      await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: `scout-dev-${queue}`,
        activities,
        maxConcurrentActivityTaskExecutions: 4,
      }),
    );
  }
}

type History = Awaited<ReturnType<WorkflowHandle["fetchHistory"]>>;
type HistoryEvent = NonNullable<History["events"]>[number];

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
 * it continued as, and the deprecation flag of each rename marker it recorded.
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
    renamePatchMarkers: events.flatMap((event) => renamePatchMarkers(event)),
  };
}

/** The deprecation flag of each rename marker this event records. */
function renamePatchMarkers(event: HistoryEvent): boolean[] {
  const marker = event.markerRecordedEventAttributes;
  if (marker?.markerName !== PATCH_MARKER) return [];
  const decoder = new TextDecoder();
  return Object.values(marker.details ?? {}).flatMap((payloads) =>
    (payloads.payloads ?? []).flatMap((payload) => {
      const data = PatchMarkerDataSchema.parse(
        JSON.parse(decoder.decode(payload.data ?? new Uint8Array())),
      );
      return data.id === SCOUT_GENERATION_RENAME_PATCH ? [data.deprecated] : [];
    }),
  );
}

/** The names that still carry the generation suffix. */
function preRenameNames(names: readonly string[]): string[] {
  return names.filter((name) => /V2(?:Workflow)?$/u.test(name));
}

// ─── Histories recorded now ────────────────────────────────────────────────

const matchInput = scoutMatchProcessingInputCodec.serialize({
  stage,
  riotMatchId: MATCH_ID,
  sourcePuuid: LeaguePuuidSchema.parse("s".repeat(78)),
  deliveryMode: "live",
});

async function recordMatchRun(): Promise<History> {
  await startActivityWorkers({
    realtime: scoutMatchActivityStubs(createScoutMatchStore()),
  });
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

test("a match run issues the renamed types behind the deprecated marker", async () => {
  await startWorkflowWorker();
  const recorded = await recordMatchRun();
  const names = namesIn(recorded);

  expect(names.workflowType).toBe("scoutMatchProcessingWorkflow");
  expect(names.activities.length).toBeGreaterThan(0);
  expect(preRenameNames(names.activities)).toEqual([]);
  expect(names.children).toEqual([
    "scoutNotificationWorkflow",
    "scoutLakeProjectionWorkflow",
  ]);
  expect(names.renamePatchMarkers).toEqual([true]);

  await Worker.runReplayHistory({ workflowsPath }, recorded);
}, 120_000);

/** Pages enough that one run's budget runs out and it continues as new. */
function pagesPastOneRun(): ScoutReconciliationScanResult["pending"][] {
  return Array.from({ length: 30 }, () => emptyPending());
}

test("a sweep continues as new under the renamed type behind the deprecated marker", async () => {
  // How the long-lived Workflows stay on the renamed type: the client-match
  // dispatcher singleton and recovery batches take the same path when they
  // continue as new.
  await startWorkflowWorker();
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
    renamePatchMarkers: [true],
  });
  expect(latest.type).toBe("scoutPipelineReconciliationWorkflow");
  await Worker.runReplayHistory({ workflowsPath }, firstRun);
}, 120_000);
