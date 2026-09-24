import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { ScoutMatchRefV2 } from "#src/contracts-v2.ts";
import {
  SCOUT_V2_ACTIVITY_QUEUE_CLASSES,
  scoutSilentPostmatchBackfillV2WorkflowId,
} from "#src/identifiers.ts";
import {
  scoutSilentPostmatchBackfillV2InputCodec,
  scoutSilentPostmatchBackfillV2ResultCodec,
  type ScoutSilentPostmatchBackfillV2Result,
} from "#src/silent-postmatch-backfill-v2.ts";
import { scoutSilentPostmatchBackfillV2Workflow } from "./index.ts";
import {
  applicationFailureOf,
  settleWorkflow,
} from "./workflow-harness.test-fixtures.ts";
import { createScoutWorkerPool } from "./worker-pool.test-fixtures.ts";

/**
 * The silent post-match backfill Workflow, against a store that stands in for
 * the object store and the render receipts.
 *
 * Every V2 Activity is registered on every queue, and every one but the
 * backfill records its call and throws. So the proof that the backfill mints
 * nothing and delivers nothing is not an assertion about the code path it
 * took; it is that nothing else was reachable to call, and the history shows
 * no other Activity scheduled and no child started.
 *
 * Mutation proof: make the Workflow also call
 * `realtimeV2Activities(input.stage).mintPostmatchNotificationIntentsV2(ref)`
 * (or start a `scoutNotificationV2Workflow` child) for each match, and
 * "renders and attests" fails on the forbidden calls and the history.
 */

const stage = "dev" as const;
const matchId = (id: number): RiotMatchId =>
  RiotMatchIdSchema.parse(`NA1_${id.toString()}`);

type Store = {
  objects: Map<string, string>;
  renderReceipts: Set<RiotMatchId>;
  forbiddenCalls: string[];
  notOwned: Set<RiotMatchId>;
  failing: Set<RiotMatchId>;
};

function createStore(): Store {
  return {
    objects: new Map(),
    renderReceipts: new Set(),
    forbiddenCalls: [],
    notOwned: new Set(),
    failing: new Set(),
  };
}

/** The backfill's contract, as the backend keeps it, over the store. */
function backfillStub(store: Store) {
  return (
    input: ScoutMatchRefV2,
  ): Promise<ScoutSilentPostmatchBackfillV2Result> => {
    const { riotMatchId } = input;
    if (store.failing.has(riotMatchId)) {
      throw ApplicationFailure.nonRetryable(
        `render failed for ${riotMatchId}`,
        "MissingDomainRecord",
      );
    }
    if (store.renderReceipts.has(riotMatchId)) {
      return Promise.resolve({
        outcome: "skipped",
        reason: "already-rendered",
      });
    }
    if (store.notOwned.has(riotMatchId)) {
      return Promise.resolve({ outcome: "skipped", reason: "not-v2-owned" });
    }
    store.objects.set(`games/2026/09/22/${riotMatchId}/report.png`, "png");
    store.renderReceipts.add(riotMatchId);
    return Promise.resolve({ outcome: "rendered" });
  };
}

/** Every V2 Activity; all but the backfill are forbidden and record it. */
function activitiesFor(
  store: Store,
): Record<string, (input: unknown) => unknown> {
  const all: Record<string, (input: unknown) => unknown> = {};
  for (const name of Object.keys(SCOUT_V2_ACTIVITY_QUEUE_CLASSES)) {
    all[name] = () => {
      store.forbiddenCalls.push(name);
      throw ApplicationFailure.nonRetryable(
        `${name} must never run from the silent backfill`,
        "ForbiddenInSilentBackfill",
      );
    };
  }
  const allowed = backfillStub(store);
  all["backfillSilentPostmatchArtifactV2"] = async (input) =>
    await allowed(parseRef(input));
  return all;
}

function parseRef(input: unknown): ScoutMatchRefV2 {
  if (
    typeof input === "object" &&
    input !== null &&
    "riotMatchId" in input &&
    typeof input.riotMatchId === "string"
  ) {
    return { stage, riotMatchId: RiotMatchIdSchema.parse(input.riotMatchId) };
  }
  throw new TypeError(
    "the backfill Activity was given something other than a match ref",
  );
}

let environment: TestWorkflowEnvironment;
const workers = createScoutWorkerPool();

beforeEach(async () => {
  environment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterEach(async () => {
  await workers.drain();
  await environment.teardown();
});

async function startWorkers(store: Store): Promise<void> {
  const activities = activitiesFor(store);
  for (const taskQueue of [
    "scout-dev",
    "scout-dev-realtime",
    "scout-dev-background",
    "scout-dev-lake",
  ]) {
    await workers.start(
      await Worker.create({
        connection: environment.nativeConnection,
        taskQueue,
        ...(taskQueue === "scout-dev"
          ? { workflowsPath: new URL("index.ts", import.meta.url).pathname }
          : { activities }),
      }),
    );
  }
}

async function backfill(workflowId: string, riotMatchIds: RiotMatchId[]) {
  const handle = await environment.client.workflow.start(
    scoutSilentPostmatchBackfillV2Workflow,
    {
      taskQueue: "scout-dev",
      workflowId,
      args: [
        scoutSilentPostmatchBackfillV2InputCodec.serialize({
          stage,
          riotMatchIds,
        }),
      ],
    },
  );
  const settled = await settleWorkflow(handle.result());
  const history = await handle.fetchHistory();
  const events = history.events ?? [];
  return {
    settled,
    scheduledActivities: events.flatMap((event) => {
      const name =
        event.activityTaskScheduledEventAttributes?.activityType?.name;
      return name === undefined || name === null ? [] : [name];
    }),
    childrenStarted: events.filter(
      (event) =>
        event.startChildWorkflowExecutionInitiatedEventAttributes != null,
    ).length,
  };
}

describe("the silent post-match backfill", () => {
  test("renders and attests each match, mints no intent, and starts nothing else", async () => {
    const store = createStore();
    store.notOwned.add(matchId(3));
    await startWorkers(store);

    const run = await backfill(
      scoutSilentPostmatchBackfillV2WorkflowId(stage, "test"),
      [matchId(1), matchId(2), matchId(3)],
    );

    expect(
      scoutSilentPostmatchBackfillV2ResultCodec.parse(run.settled),
    ).toEqual({
      status: "completed",
      requested: 3,
      rendered: 2,
      reused: 0,
      skipped: 1,
      failed: 0,
      outcomes: [
        { riotMatchId: matchId(1), outcome: "rendered" },
        { riotMatchId: matchId(2), outcome: "rendered" },
        { riotMatchId: matchId(3), outcome: "skipped", reason: "not-v2-owned" },
      ],
    });
    // The artifact and its receipt, for exactly the owned matches.
    expect([...store.objects.keys()].toSorted()).toEqual([
      `games/2026/09/22/${matchId(1)}/report.png`,
      `games/2026/09/22/${matchId(2)}/report.png`,
    ]);
    expect([...store.renderReceipts].toSorted()).toEqual([
      matchId(1),
      matchId(2),
    ]);
    // Nothing that could announce it: no minter, no send, no child.
    expect(store.forbiddenCalls).toEqual([]);
    expect(new Set(run.scheduledActivities)).toEqual(
      new Set(["backfillSilentPostmatchArtifactV2"]),
    );
    expect(run.childrenStarted).toBe(0);
  });

  test("a rerun of the same list renders nothing twice", async () => {
    const store = createStore();
    await startWorkers(store);
    const matches = [matchId(11), matchId(12), matchId(13)];

    await backfill(
      scoutSilentPostmatchBackfillV2WorkflowId(stage, "first"),
      matches,
    );
    const objectsAfterFirst = new Map(store.objects);
    const receiptsAfterFirst = new Set(store.renderReceipts);
    const rerun = await backfill(
      scoutSilentPostmatchBackfillV2WorkflowId(stage, "second"),
      matches,
    );

    expect(
      scoutSilentPostmatchBackfillV2ResultCodec.parse(rerun.settled),
    ).toMatchObject({
      rendered: 0,
      skipped: 3,
      failed: 0,
    });
    expect(store.objects).toEqual(objectsAfterFirst);
    expect(store.renderReceipts).toEqual(receiptsAfterFirst);
    expect(store.forbiddenCalls).toEqual([]);
  });

  test("a match that cannot render fails the run after every other match ran", async () => {
    const store = createStore();
    store.failing.add(matchId(21));
    await startWorkers(store);

    const run = await backfill(
      scoutSilentPostmatchBackfillV2WorkflowId(stage, "failing"),
      [matchId(21), matchId(22), matchId(23)],
    );

    const failure = applicationFailureOf(run.settled);
    expect(failure?.type).toBe("SilentBackfillIncomplete");
    expect(failure?.nonRetryable).toBe(true);
    expect(failure?.message).toContain(matchId(21));
    expect([...store.renderReceipts].toSorted()).toEqual([
      matchId(22),
      matchId(23),
    ]);
    expect(store.forbiddenCalls).toEqual([]);
  });
});

describe("the backfill input", () => {
  test("refuses an empty list and a repeated match", () => {
    expect(() =>
      scoutSilentPostmatchBackfillV2InputCodec.serialize({
        stage,
        riotMatchIds: [],
      }),
    ).toThrow();
    expect(() =>
      scoutSilentPostmatchBackfillV2InputCodec.serialize({
        stage,
        riotMatchIds: [matchId(1), matchId(1)],
      }),
    ).toThrow(/must not repeat/u);
  });
});
