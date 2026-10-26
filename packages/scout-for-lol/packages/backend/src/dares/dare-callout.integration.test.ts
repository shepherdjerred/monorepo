import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import {
  clearDareTables,
  createDareLifecycleHarness,
  freezeDareAsMonotone,
} from "#src/dares/dare-integration.test-fixtures.ts";
import {
  loadRiftFixture,
  targetMatchAt,
  type StubbedLake,
} from "#src/dares/dare-test-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";
import type { DareTargetBinding, RawMatch } from "@scout-for-lol/data";
import {
  DiscordMessageIdSchema,
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

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

vi.mock("#src/dares/sql/dare-sql.ts", async () => {
  const { stubbedDareSqlModule } =
    await import("#src/dares/dare-test-fixtures.ts");
  return await stubbedDareSqlModule(lake);
});

const { postDareCallout, refreshDareCallout, refreshPendingDareCallouts } =
  await import("#src/dares/presentation/dare-callout.ts");
const { settleDaresForMatch } =
  await import("#src/dares/settlement/dare-settle.ts");

const { prisma: db } = createTestDatabase("bucks-dare-callout");
const SERVER = testGuildId("951");
const CHANNEL = testChannelId("952");
const CHALLENGER = testAccountId("953");
const TARGET = testAccountId("954");
const T0 = new Date("2026-09-01T12:00:00.000Z");
let matchFixture: RawMatch;

const TARGET_BINDING: DareTargetBinding = {
  key: "T1",
  discordId: TARGET,
  playerId: 1,
  alias: "Virmel",
  accounts: [
    {
      puuid: LeaguePuuidSchema.parse(
        "virmel-puuid000000000000000000000000000000000000000000000000000000000000000000",
      ),
      trackingStartedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

const { makeDraft, intent, consume, publish, activate } =
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

function matchAt(matchId: RiotMatchId): RawMatch {
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
  for (const flag of ["dares_enabled", "dares_enabled"] as const) {
    clearFlagOverrides(flag);
    addFlagOverride(flag, true, { server: SERVER });
  }
});

afterAll(async () => {
  resetFlagOverrides("dares_enabled");
  resetFlagOverrides("dares_enabled");
  await clearDareTables(db);
  await db.$disconnect();
});

describe("Dare callout delivery", () => {
  test("concurrent publishing replays publish one durable public callout", async () => {
    const dareId = await makeDraft();
    await publish(dareId, "publish-callout");
    const sendMessage = vi.fn(() =>
      Promise.resolve({ channelId: CHANNEL, id: "845308994376438227" }),
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
    const dare = await db.dare.findUniqueOrThrow({
      where: { id: dareId },
    });
    expect(JSON.parse(dare.messageRef ?? "null")).toEqual({
      channelId: CHANNEL,
      messageId: DiscordMessageIdSchema.parse("845308994376438227"),
    });
    expect(dare.calloutClaimId).toBeNull();
    expect(dare.calloutClaimedAt).toBeNull();
    expect(dare.calloutRefreshPending).toBe(false);
  });
});

describe("Dare callout retries", () => {
  test("persists a failed callout edit for a later retry", async () => {
    const dareId = await makeDraft();
    await publish(dareId, "publish-callout-edit");
    const dependencies = {
      prismaClient: db,
      sendMessage: vi.fn(() =>
        Promise.resolve({ channelId: CHANNEL, id: "845308994376438301" }),
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
      await db.dare.findUniqueOrThrow({
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
      await db.dare.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true },
      }),
    ).toEqual({ calloutRefreshPending: false });
  });

  test("does not clear refresh work created during a callout edit", async () => {
    const dareId = await makeDraft();
    await publish(dareId, "publish-concurrent-callout-edit");
    const dependencies = {
      prismaClient: db,
      sendMessage: vi.fn(() =>
        Promise.resolve({ channelId: CHANNEL, id: "845308994376438302" }),
      ),
      editMessage: vi.fn(async () => {
        await db.dare.update({
          where: { id: dareId },
          data: {
            calloutRefreshPending: true,
            calloutRefreshVersion: { increment: 1 },
          },
        });
      }),
    };
    await postDareCallout(dareId, dependencies);
    await db.dare.update({
      where: { id: dareId },
      data: {
        calloutRefreshPending: true,
        calloutRefreshVersion: { increment: 1 },
      },
    });

    await refreshDareCallout(dareId, dependencies);

    expect(
      await db.dare.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true },
      }),
    ).toEqual({ calloutRefreshPending: true });
  });

  test("propagates a failed initial callout send for retry", async () => {
    const dareId = await makeDraft();
    await publish(dareId, "publish-callout-send-failure");
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
      await db.dare.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true, messageRef: true },
      }),
    ).toEqual({ calloutRefreshPending: true, messageRef: null });

    const retrySender = vi.fn(() =>
      Promise.resolve({ channelId: CHANNEL, id: "845679748751241622" }),
    );
    await expect(
      refreshPendingDareCallouts({
        ...dependencies,
        sendMessage: retrySender,
      }),
    ).resolves.toEqual([dareId]);
    expect(retrySender).toHaveBeenCalledTimes(1);
    expect(
      await db.dare.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true, messageRef: true },
      }),
    ).toEqual({
      calloutRefreshPending: false,
      messageRef: JSON.stringify({
        channelId: CHANNEL,
        messageId: DiscordMessageIdSchema.parse("845679748751241622"),
      }),
    });
  });
});

/** An achieved Dare whose public callout exists and still shows it live. */
const CALLOUT_MESSAGE_IDS = {
  owed: "845308994376438401",
  suppressed: "845308994376438402",
};

const CALLOUT_MATCH_IDS = {
  owed: RiotMatchIdSchema.parse("NA1_810011"),
  suppressed: RiotMatchIdSchema.parse("NA1_810012"),
};

async function resolvedWithPublicCallout(key: keyof typeof CALLOUT_MATCH_IDS) {
  const dareId = await makeDraft();
  await activate(dareId, key);
  const editMessage = vi.fn(() => Promise.resolve());
  const dependencies = {
    prismaClient: db,
    sendMessage: vi.fn(() =>
      Promise.resolve({ channelId: CHANNEL, id: CALLOUT_MESSAGE_IDS[key] }),
    ),
    editMessage,
  };
  await postDareCallout(dareId, dependencies);
  await makeMonotone(dareId);
  const match = matchAt(CALLOUT_MATCH_IDS[key]);
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
      await db.dare.findUniqueOrThrow({
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
      await db.dare.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true },
      }),
    ).toEqual({ calloutRefreshPending: false });
  });
});
