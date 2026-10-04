import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { DareTargetBinding, RawMatch } from "@scout-for-lol/data";
import {
  clearDareTables,
  createDareLifecycleHarness,
  freezeDareAsMonotone,
} from "#src/betting/dares/dare-integration.test-fixtures.ts";
import {
  loadRiftFixture,
  targetMatchAt,
  type StubbedLake,
} from "#src/betting/dares/dare-test-fixtures.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";

/**
 * The public Dare callout: posting it once, retrying a failed send or edit,
 * rendering pile-ons, and ordering its terminal edit after the result post.
 *
 * Drafts compile real SQL; only lake execution is stubbed.
 */

const lake = vi.hoisted((): StubbedLake => ({
  achieved: false,
  sourceMatchIds: [],
}));

vi.mock("#src/betting/dares/sql/dare-sql.ts", async () => {
  const { stubbedDareSqlModule } =
    await import("#src/betting/dares/dare-test-fixtures.ts");
  return await stubbedDareSqlModule(lake);
});

const { postDareCallout, refreshDareCallout, refreshPendingDareCallouts } =
  await import("#src/betting/dares/presentation/dare-callout.ts");
const { settleDaresForMatch } =
  await import("#src/betting/dares/settlement/dare-settle.ts");

const { prisma: db } = createTestDatabase("bucks-dare-callout");
const SERVER = testGuildId("951");
const CHANNEL = testChannelId("952");
const CHALLENGER = testAccountId("953");
const TARGET = testAccountId("954");
const CONTRIBUTOR = testAccountId("956");
const T0 = new Date("2026-09-01T12:00:00.000Z");
let matchFixture: RawMatch;

const TARGET_BINDING: DareTargetBinding = {
  key: "T1",
  discordId: TARGET,
  playerId: 1,
  alias: "Virmel",
  accounts: [
    { puuid: "virmel-puuid", trackingStartedAt: "2026-01-01T00:00:00.000Z" },
  ],
};

const { makeDraft, intent, consume, makeContribution, fund, activate } =
  createDareLifecycleHarness({
    db,
    serverId: SERVER,
    channelId: CHANNEL,
    challenger: CHALLENGER,
    target: TARGET,
    targetBinding: TARGET_BINDING,
    now: T0,
  });

async function makeMonotone(dareId: number): Promise<void> {
  await freezeDareAsMonotone(db, dareId);
}

function matchAt(matchId: string): RawMatch {
  return targetMatchAt(
    matchFixture,
    matchId,
    new Date(T0.getTime() + 60 * 60 * 1000),
  );
}

beforeAll(async () => {
  matchFixture = await loadRiftFixture();
});

beforeEach(async () => {
  await clearDareTables(db);
  lake.achieved = false;
  lake.sourceMatchIds = [];
  for (const flag of ["betting_enabled", "bucks_dares_enabled"] as const) {
    clearFlagOverrides(flag);
    addFlagOverride(flag, true, { server: SERVER });
  }
});

afterAll(async () => {
  resetFlagOverrides("betting_enabled");
  resetFlagOverrides("bucks_dares_enabled");
  await clearDareTables(db);
  await db.$disconnect();
});

describe("Dare callout delivery", () => {
  test("concurrent funding replays publish one durable public callout", async () => {
    const dareId = await makeDraft();
    await fund(dareId, "fund-callout");
    const sendMessage = vi.fn(() =>
      Promise.resolve({ channelId: CHANNEL, id: "callout-message" }),
    );
    const calloutDependencies = {
      prismaClient: db,
      sendMessage,
      editMessage: vi.fn(() => Promise.resolve()),
    };

    const results = await Promise.all([
      postDareCallout(dareId, calloutDependencies),
      postDareCallout(dareId, calloutDependencies),
    ]);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        nonce: `dare-v2-${dareId.toString()}`,
        enforceNonce: true,
      }),
      CHANNEL,
      SERVER,
    );
    expect(results.map((result) => result.kind).sort()).toEqual([
      "existing",
      "posted",
    ]);
    const dare = await db.bucksDare.findUniqueOrThrow({
      where: { id: dareId },
    });
    expect(JSON.parse(dare.messageRef ?? "null")).toEqual({
      channelId: CHANNEL,
      messageId: "callout-message",
    });
    expect(dare.calloutClaimId).toBeNull();
    expect(dare.calloutClaimedAt).toBeNull();
    expect(dare.calloutRefreshPending).toBe(false);
  });
});

describe("Dare callout retries", () => {
  test("persists a failed callout edit for a later retry", async () => {
    const dareId = await makeDraft();
    await fund(dareId, "fund-callout-edit");
    const dependencies = {
      prismaClient: db,
      sendMessage: vi.fn(() =>
        Promise.resolve({ channelId: CHANNEL, id: "callout-edit-message" }),
      ),
      editMessage: vi.fn(() =>
        Promise.reject(new Error("Discord edit failed")),
      ),
    };
    await postDareCallout(dareId, dependencies);
    const acceptIntent = await intent({
      dareId,
      actor: TARGET,
      action: "accept",
      key: "accept-before-callout-edit",
    });
    await consume(acceptIntent, TARGET);

    await expect(refreshDareCallout(dareId, dependencies)).rejects.toThrow(
      "Discord edit failed",
    );
    expect(dependencies.editMessage).toHaveBeenCalledTimes(1);
    expect(
      await db.bucksDare.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true },
      }),
    ).toEqual({ calloutRefreshPending: true });

    const retryEditor = vi.fn(() => Promise.resolve());
    await expect(
      refreshPendingDareCallouts({
        ...dependencies,
        editMessage: retryEditor,
      }),
    ).resolves.toEqual([dareId]);
    expect(retryEditor).toHaveBeenCalledTimes(1);
    expect(
      await db.bucksDare.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true },
      }),
    ).toEqual({ calloutRefreshPending: false });
  });

  test("does not clear refresh work created during a callout edit", async () => {
    const dareId = await makeDraft();
    await fund(dareId, "fund-concurrent-callout-edit");
    const dependencies = {
      prismaClient: db,
      sendMessage: vi.fn(() =>
        Promise.resolve({ channelId: CHANNEL, id: "concurrent-edit-message" }),
      ),
      editMessage: vi.fn(async () => {
        await db.bucksDare.update({
          where: { id: dareId },
          data: {
            calloutRefreshPending: true,
            calloutRefreshVersion: { increment: 1 },
          },
        });
      }),
    };
    await postDareCallout(dareId, dependencies);
    await db.bucksDare.update({
      where: { id: dareId },
      data: {
        calloutRefreshPending: true,
        calloutRefreshVersion: { increment: 1 },
      },
    });

    await refreshDareCallout(dareId, dependencies);

    expect(
      await db.bucksDare.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true },
      }),
    ).toEqual({ calloutRefreshPending: true });
  });

  test("propagates a failed initial callout send for retry", async () => {
    const dareId = await makeDraft();
    await fund(dareId, "fund-callout-send-failure");
    const dependencies = {
      prismaClient: db,
      sendMessage: vi.fn(() =>
        Promise.reject(new Error("Discord send failed")),
      ),
      editMessage: vi.fn(() => Promise.resolve()),
    };

    await expect(postDareCallout(dareId, dependencies)).rejects.toThrow(
      "Discord send failed",
    );
    expect(dependencies.sendMessage).toHaveBeenCalledTimes(1);
    expect(
      await db.bucksDare.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true, messageRef: true },
      }),
    ).toEqual({ calloutRefreshPending: true, messageRef: null });

    const retrySender = vi.fn(() =>
      Promise.resolve({ channelId: CHANNEL, id: "retried-callout-message" }),
    );
    await expect(
      refreshPendingDareCallouts({
        ...dependencies,
        sendMessage: retrySender,
      }),
    ).resolves.toEqual([dareId]);
    expect(retrySender).toHaveBeenCalledTimes(1);
    expect(
      await db.bucksDare.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true, messageRef: true },
      }),
    ).toEqual({
      calloutRefreshPending: false,
      messageRef: JSON.stringify({
        channelId: CHANNEL,
        messageId: "retried-callout-message",
      }),
    });
  });
});

describe("Dare callout contributor delivery", () => {
  test("renders pile-ons and allows contributor mentions on post and refresh", async () => {
    const dareId = await makeDraft({ openingStake: 10 });
    await fund(dareId, "fund-callout-contributor");
    await makeContribution(dareId, CONTRIBUTOR, 5, "contributor-callout-first");

    const sendMessage = vi.fn(() =>
      Promise.resolve({
        channelId: CHANNEL,
        id: "contributor-callout-message",
      }),
    );
    const editMessage = vi.fn(() => Promise.resolve());
    const dependencies = { prismaClient: db, sendMessage, editMessage };

    await postDareCallout(dareId, dependencies);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(`<@${CONTRIBUTOR}> — **5 BB**`),
        allowedMentions: expect.objectContaining({
          users: expect.arrayContaining([CONTRIBUTOR]),
        }),
      }),
      CHANNEL,
      SERVER,
    );

    await makeContribution(
      dareId,
      CONTRIBUTOR,
      5,
      "contributor-callout-second",
    );
    await refreshDareCallout(dareId, dependencies);

    expect(editMessage).toHaveBeenCalledWith({
      channelId: CHANNEL,
      messageId: "contributor-callout-message",
      options: expect.objectContaining({
        content: expect.stringContaining(`<@${CONTRIBUTOR}> — **10 BB**`),
        allowedMentions: {
          parse: [],
          users: expect.arrayContaining([CONTRIBUTOR]),
        },
      }),
    });
  });
});

/** An achieved Dare whose public callout exists and still shows it live. */
async function resolvedWithPublicCallout(key: string) {
  const dareId = await makeDraft();
  await activate(dareId, key);
  const editMessage = vi.fn(() => Promise.resolve());
  const dependencies = {
    prismaClient: db,
    sendMessage: vi.fn(() =>
      Promise.resolve({ channelId: CHANNEL, id: `callout-${key}` }),
    ),
    editMessage,
  };
  await postDareCallout(dareId, dependencies);
  await makeMonotone(dareId);
  const match = matchAt(`NA1_DARE_RESULT_${key.toUpperCase()}`);
  lake.achieved = true;
  lake.sourceMatchIds = [match.metadata.matchId];
  await expect(settleDaresForMatch(match, db)).resolves.toMatchObject([
    { dareId, resolution: "achieved" },
  ]);
  return { dareId, dependencies, editMessage };
}

async function resultPostState(dareId: number): Promise<string | undefined> {
  const row = await db.matchNotificationIntent.findFirst({
    where: {
      subjectKind: "dare",
      subjectId: dareId.toString(),
      targetKind: "channel",
    },
    select: { state: true },
  });
  return row?.state;
}

describe("Dare callout and the result post", () => {
  test("leaves the terminal edit to the result post that will deliver", async () => {
    const { dareId, dependencies, editMessage } =
      await resolvedWithPublicCallout("owed");
    expect(await resultPostState(dareId)).toBe("pending");

    await expect(
      refreshPendingDareCallouts({
        ...dependencies,
        isPolicyEnabled: () => Promise.resolve(true),
      }),
    ).resolves.toEqual([]);
    expect(editMessage).not.toHaveBeenCalled();
    expect(
      await db.bucksDare.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true },
      }),
    ).toEqual({ calloutRefreshPending: true });

    // Once the post is out (its follow-up edits the callout), nothing holds
    // the scan back any more.
    await db.matchNotificationIntent.updateMany({
      where: { subjectKind: "dare", subjectId: dareId.toString() },
      data: { state: "delivered", deliveredAt: new Date() },
    });
    await expect(
      refreshPendingDareCallouts({
        ...dependencies,
        isPolicyEnabled: () => Promise.resolve(true),
      }),
    ).resolves.toEqual([dareId]);
    expect(editMessage).toHaveBeenCalledTimes(1);
  });

  test("edits at once when the guild will suppress the result post", async () => {
    const { dareId, dependencies, editMessage } =
      await resolvedWithPublicCallout("suppressed");

    await expect(
      refreshPendingDareCallouts({
        ...dependencies,
        isPolicyEnabled: () => Promise.resolve(false),
      }),
    ).resolves.toEqual([dareId]);
    expect(editMessage).toHaveBeenCalledTimes(1);
    expect(
      await db.bucksDare.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true },
      }),
    ).toEqual({ calloutRefreshPending: false });
  });
});
