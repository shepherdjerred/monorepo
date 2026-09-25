import { describe, expect, test } from "vitest";
import { WorkflowNotFoundError } from "@temporalio/client";
import type { NotificationIntentKey } from "@scout-for-lol/domain/identity/brands.ts";
import type { ScoutPrematchGameRef } from "#src/contracts-v2.ts";
import {
  scoutPrematchDiscoveryV2InputCodec,
  scoutPrematchDiscoveryV2ResultCodec,
  scoutPrematchGameV2InputCodec,
  scoutPrematchGameV2ResultCodec,
} from "#src/workflow-contracts-v2.ts";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutNotificationV2WorkflowId,
  scoutPrematchGameV2WorkflowId,
} from "#src/identifiers.ts";
import { SCOUT_V2_PREMATCH_DELIVERY_PATCH } from "./prematch-v2.ts";
import {
  scoutPrematchDiscoveryV2Workflow,
  scoutPrematchGameV2Workflow,
} from "./index.ts";
import {
  captured,
  createScoutV2PrematchStore,
  prematchIntentKeyOf,
  prematchMatchIdOf,
  scoutV2PrematchActivityStubs,
  CHANNEL_IDS,
  GAME_REF,
  GUILD_ID,
  OTHER_GAME_REF,
  PREMATCH_RECEIPT_KINDS,
  SAME_GAME_OTHER_ACCOUNT,
  type ScoutV2PrematchStore,
} from "./prematch-v2.test-fixtures.ts";
import {
  applicationFailureOf,
  settleWorkflow,
  useScoutV2WorkflowHarness,
} from "./workflow-harness.test-fixtures.ts";

const harness = useScoutV2WorkflowHarness();

const stage = "dev" as const;
const GAME_MATCH_ID = prematchMatchIdOf(GAME_REF);
const CAPTURE = [
  "archivePrematchSnapshotV2",
  "planPrematchFanOutV2",
  "openPrematchMarketsV2",
];
/** Everything a first capture of a live game applies, in order. */
const FIRST_CAPTURE_EFFECTS = [
  PREMATCH_RECEIPT_KINDS.archive,
  PREMATCH_RECEIPT_KINDS.staging,
  ...CHANNEL_IDS.map((channelId) => `intent:${channelId}`),
  `pool:${GUILD_ID}`,
];

async function captureGame(
  workflowId: string,
  gameRef = GAME_REF,
): Promise<unknown> {
  return await harness.client().workflow.execute(scoutPrematchGameV2Workflow, {
    taskQueue: "scout-dev",
    workflowId,
    args: [scoutPrematchGameV2InputCodec.serialize({ stage, gameRef })],
  });
}

async function discover(workflowId: string): Promise<unknown> {
  return await harness
    .client()
    .workflow.execute(scoutPrematchDiscoveryV2Workflow, {
      taskQueue: "scout-dev",
      workflowId,
      args: [scoutPrematchDiscoveryV2InputCodec.serialize({ stage })],
    });
}

/**
 * Wait out a child discovery abandoned.
 *
 * The poller does not await its children on purpose, so a test that asserted
 * on the store immediately after discovery returned would be racing them.
 */
async function awaitGameChild(gameRef: ScoutPrematchGameRef): Promise<void> {
  await harness
    .client()
    .workflow.getHandle(scoutPrematchGameV2WorkflowId(stage, gameRef))
    .result();
}

describe("the V2 per-game prematch core", () => {
  test("captures the snapshot, then plans the fan-out off what it recorded", async () => {
    const store = createScoutV2PrematchStore();
    await harness.startWorkers(scoutV2PrematchActivityStubs(store));

    const result = await captureGame("prematch-game-happy");

    expect(store.calls).toEqual(CAPTURE);
    // A notification is a promise about a snapshot, so the plan is read after
    // the capture committed and never before it.
    expect(store.applied).toEqual(FIRST_CAPTURE_EFFECTS);
    expect(result).toEqual(
      scoutPrematchGameV2ResultCodec.serialize({
        status: "completed",
        riotMatchId: GAME_MATCH_ID,
        receiptKinds: [
          PREMATCH_RECEIPT_KINDS.archive,
          PREMATCH_RECEIPT_KINDS.staging,
        ],
        // One notification child per minted intent, started after the
        // markets so the message each one builds can carry its buttons.
        childrenStarted: { notifications: 2 },
      }),
    );
  }, 60_000);

  test("re-runs over a capture that already stands without repeating it", async () => {
    const store = captured();
    await harness.startWorkers(scoutV2PrematchActivityStubs(store));

    const result = await captureGame("prematch-game-resume");

    expect(store.calls).toEqual(CAPTURE);
    // Both receipts and both intents were already there, so this run archived
    // nothing, staged nothing and minted nothing.
    expect(store.applied).toEqual([]);
    expect(store.intentKeys).toEqual(
      CHANNEL_IDS.map((channelId) => prematchIntentKeyOf(GAME_REF, channelId)),
    );
    expect(result).toMatchObject({
      data: {
        status: "completed",
        receiptKinds: [
          PREMATCH_RECEIPT_KINDS.archive,
          PREMATCH_RECEIPT_KINDS.staging,
        ],
      },
    });
  }, 60_000);

  test("reports a no-op for a game that ended before the capture ran", async () => {
    const store = createScoutV2PrematchStore({ live: false });
    await harness.startWorkers(scoutV2PrematchActivityStubs(store));

    const result = await captureGame("prematch-game-ended");

    expect(store.applied).toEqual([]);
    // Nothing captured and nobody to tell. Reporting `completed` here would
    // claim a snapshot that does not exist.
    expect(result).toEqual(
      scoutPrematchGameV2ResultCodec.serialize({
        status: "no-op",
        riotMatchId: GAME_MATCH_ID,
        receiptKinds: [],
        childrenStarted: { notifications: 0 },
      }),
    );
  }, 60_000);

  test("refuses a fan-out plan that asks for a lake projection", async () => {
    const store = createScoutV2PrematchStore({ lakeProjection: true });
    await harness.startWorkers(scoutV2PrematchActivityStubs(store));

    // The prematch result has no lake child to report, and the snapshot's lake
    // rows are staged by the capture itself. Dropping the request silently
    // would lose a projection nobody could later prove was skipped.
    const failure = applicationFailureOf(
      await settleWorkflow(captureGame("prematch-game-bad-plan")),
    );

    expect(failure?.type).toBe("BrokenFanOutPlan");
    expect(failure?.nonRetryable).toBe(true);
    expect(failure?.message).toContain("lake projection");
  }, 60_000);
});

describe("a V2 prematch capture killed mid-run", () => {
  test.each([
    {
      name: "inside the capture, after its receipts and intents landed",
      crash: (store: ScoutV2PrematchStore) => {
        store.crashAfterCapture = true;
      },
      heal: (store: ScoutV2PrematchStore) => {
        store.crashAfterCapture = false;
      },
    },
    {
      name: "between the capture and the fan-out plan",
      crash: (store: ScoutV2PrematchStore) => {
        store.failAt = "planPrematchFanOutV2";
      },
      heal: (store: ScoutV2PrematchStore) => {
        store.failAt = null;
      },
    },
  ])(
    "archives once and mints each intent once across a crash $name",
    async (scenario) => {
      const store = createScoutV2PrematchStore();
      scenario.crash(store);
      await harness.startWorkers(scoutV2PrematchActivityStubs(store));

      await expect(captureGame("prematch-crash")).rejects.toThrow();

      // The replacement run resolves the capture from the durable state the dead
      // one left, which is what a replay actually is.
      scenario.heal(store);
      const result = await captureGame("prematch-replay");

      // The multiset, not the count: it states both which effects happened and
      // that none happened twice. A second archive would have stamped a new
      // `capturedAt`, and a second intent would have told a channel twice.
      expect(store.applied).toEqual(FIRST_CAPTURE_EFFECTS);
      expect(new Set(store.applied).size).toBe(store.applied.length);
      expect(store.intentKeys).toEqual(
        CHANNEL_IDS.map((channelId) =>
          prematchIntentKeyOf(GAME_REF, channelId),
        ),
      );
      expect(result).toMatchObject({ data: { status: "completed" } });
    },
    90_000,
  );
});

describe("V2 prematch discovery", () => {
  test("starts one child per distinct live game", async () => {
    const store = createScoutV2PrematchStore();
    await harness.startWorkers(
      scoutV2PrematchActivityStubs(store, [GAME_REF, OTHER_GAME_REF]),
    );

    const result = await discover("prematch-discovery-two-games");
    await awaitGameChild(GAME_REF);
    await awaitGameChild(OTHER_GAME_REF);

    expect(result).toEqual(
      scoutPrematchDiscoveryV2ResultCodec.serialize({
        status: "completed",
        discovered: 2,
        childrenStarted: 2,
        complete: true,
      }),
    );
  }, 90_000);

  test("collapses one game surfaced through two tracked accounts", async () => {
    const store = createScoutV2PrematchStore();
    await harness.startWorkers(
      scoutV2PrematchActivityStubs(store, [GAME_REF, SAME_GAME_OTHER_ACCOUNT]),
    );

    const result = await discover("prematch-discovery-same-game");
    await awaitGameChild(GAME_REF);

    // `scoutPrematchGameV2WorkflowId` drops the puuid, so both references
    // compute one ID and the second start is refused. They are the same
    // snapshot and the same announcement; capturing it twice would archive one
    // game under two runs and tell every channel twice.
    expect(result).toMatchObject({
      data: { discovered: 2, childrenStarted: 1, complete: true },
    });
    expect(store.applied).toEqual(FIRST_CAPTURE_EFFECTS);
    expect(
      store.calls.filter((call) => call === "archivePrematchSnapshotV2"),
    ).toHaveLength(1);
  }, 90_000);

  test("keeps going past a game another execution already owns", async () => {
    const store = createScoutV2PrematchStore();
    await harness.startWorkers(
      scoutV2PrematchActivityStubs(store, [GAME_REF, OTHER_GAME_REF]),
    );
    // A completed execution owns the first game's child ID.
    await captureGame(scoutPrematchGameV2WorkflowId(stage, GAME_REF));

    const result = await discover("prematch-discovery-owned");
    await awaitGameChild(OTHER_GAME_REF);

    // Unlike post-match discovery, a taken ID is the ordinary dedup rather
    // than a chronology to protect: live games are independent, so stopping
    // here would strand every game found after the one already in flight.
    expect(result).toMatchObject({
      data: { discovered: 2, childrenStarted: 1, complete: true },
    });
    expect(
      store.calls.filter((call) => call === "archivePrematchSnapshotV2"),
    ).toHaveLength(2);
  }, 90_000);
});

/** Wait for one intent's notification child and report its type. */
async function notificationChildOf(
  key: NotificationIntentKey,
): Promise<string> {
  const handle = harness
    .client()
    .workflow.getHandle(scoutNotificationV2WorkflowId(stage, key));
  await handle.result();
  const description = await handle.describe();
  return description.type;
}

async function hasNotificationChild(
  key: NotificationIntentKey,
): Promise<boolean> {
  try {
    await harness
      .client()
      .workflow.getHandle(scoutNotificationV2WorkflowId(stage, key))
      .describe();
    return true;
  } catch (error) {
    if (error instanceof WorkflowNotFoundError) return false;
    throw error;
  }
}

describe("V2 prematch delivery", () => {
  const keys = CHANNEL_IDS.map((channelId) =>
    prematchIntentKeyOf(GAME_REF, channelId),
  );

  test("starts one notification child per minted intent, after the markets", async () => {
    const store = createScoutV2PrematchStore();
    await harness.startWorkers(scoutV2PrematchActivityStubs(store));

    const result = await captureGame("prematch-delivery-children");

    expect(result).toMatchObject({
      data: { status: "completed", childrenStarted: { notifications: 2 } },
    });
    for (const key of keys) {
      expect(await notificationChildOf(key)).toBe(
        SCOUT_WORKFLOW_NAMES.notificationV2,
      );
    }
    expect(store.delivered.toSorted()).toEqual(keys.toSorted());
    // The pool stood before either child was started.
    expect(store.calls.indexOf("openPrematchMarketsV2")).toBeGreaterThan(
      store.calls.indexOf("planPrematchFanOutV2"),
    );
  }, 90_000);

  test("delivers each intent once across a v1 → V2 flip and a second capture", async () => {
    // v1 announced the first channel under the shared intent key before the
    // flag flipped; V2 then captures the same game twice.
    const [v1Key, v2Key] = keys;
    if (v1Key === undefined || v2Key === undefined) throw new Error("keys");
    const store = createScoutV2PrematchStore({ delivered: [v1Key] });
    await harness.startWorkers(scoutV2PrematchActivityStubs(store));

    const first = await captureGame("prematch-delivery-flip-1");
    await notificationChildOf(v2Key);
    const second = await captureGame("prematch-delivery-flip-2");

    expect(first).toMatchObject({
      data: { childrenStarted: { notifications: 1 } },
    });
    // The second run finds both intents delivered and starts nothing.
    expect(second).toMatchObject({
      data: { childrenStarted: { notifications: 0 } },
    });
    expect(await hasNotificationChild(v1Key)).toBe(false);
    // One child read, for the one intent V2 owed: nobody was told twice.
    expect(store.childReads).toEqual([v2Key]);
  }, 90_000);

  test("opens the game's pool once across repeated captures", async () => {
    const store = createScoutV2PrematchStore();
    await harness.startWorkers(scoutV2PrematchActivityStubs(store));

    await captureGame("prematch-delivery-pool-1");
    await captureGame("prematch-delivery-pool-2");

    expect(store.pools).toEqual([GUILD_ID]);
    expect(
      store.applied.filter((effect) => effect.startsWith("pool:")),
    ).toEqual([`pool:${GUILD_ID}`]);
  }, 90_000);

  test("announces the game even when its markets could not be opened", async () => {
    const store = createScoutV2PrematchStore({ marketsFail: true });
    await harness.startWorkers(scoutV2PrematchActivityStubs(store));

    const result = await captureGame("prematch-delivery-no-market");

    expect(store.pools).toEqual([]);
    expect(result).toMatchObject({
      data: { status: "completed", childrenStarted: { notifications: 2 } },
    });
  }, 90_000);

  test("opens no market for a game that ended before the capture ran", async () => {
    const store = createScoutV2PrematchStore({ live: false });
    await harness.startWorkers(scoutV2PrematchActivityStubs(store));

    await captureGame("prematch-delivery-ended");

    expect(store.calls).not.toContain("openPrematchMarketsV2");
  }, 60_000);

  test("the delivery patch id is the one recorded histories will name", () => {
    expect(SCOUT_V2_PREMATCH_DELIVERY_PATCH).toBe("scout-v2-prematch-delivery");
  });
});
