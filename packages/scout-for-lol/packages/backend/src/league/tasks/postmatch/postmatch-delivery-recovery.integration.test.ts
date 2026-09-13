import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { RawMatchSchema, type RawMatch } from "@scout-for-lol/data";
import { NotificationIntentKeySchema } from "@scout-for-lol/domain/identity/brands.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { loadRawMatchFixture } from "#src/testing/raw-capture-fixtures.ts";
import { testChannelId, testGuildId } from "#src/testing/test-ids.ts";
import { getIntent } from "#src/database/durable/intent-repository.ts";

/**
 * The hole this closes: a report too old to send is not too old to finish
 * recording. The delivery gate returns before `deliverToChannels`, so the
 * completed-claim branch that adopts an unfinished intent is unreachable once
 * a match goes stale — and an intent left behind by a send whose durable
 * writes were lost would strand forever.
 */

const { prisma } = createTestDatabase("postmatch-delivery-recovery");

const CHANNEL = testChannelId("7701");
const GUILD = testGuildId("7701");
const MESSAGE_ID = "300000000000000011";

const deliverToChannels = vi.fn();

/** The channels subscribed RIGHT NOW, which a test can empty out. */
const SUBSCRIBED = [
  {
    channel: CHANNEL,
    serverId: GUILD,
    subscriptions: [
      { subscriptionId: 1, playerId: 1, filters: null, isMuted: false },
    ],
  },
];
let subscribedChannels: typeof SUBSCRIBED = SUBSCRIBED;

vi.doMock("#src/database/index.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  prisma,
  getChannelsSubscribedToPlayers: () => Promise.resolve(subscribedChannels),
}));

// Spied rather than stubbed wholesale: `channelsPassingQueueFilter` runs before
// the staleness gate and must stay real. Reaching this at all would mean the
// stale path tried to send something.
vi.doMock(
  "#src/league/tasks/notification-filters.ts",
  async (importOriginal) => ({
    ...(await importOriginal()),
    deliverToChannels,
  }),
);

const { deliverPostmatchReport } =
  await import("#src/league/tasks/postmatch/match-report-delivery.ts");

let fixture: RawMatch;

/** The committed payload under a fresh id, so each test owns its rows. */
function staleMatch(gameId: number): RawMatch {
  return RawMatchSchema.parse({
    ...fixture,
    metadata: { ...fixture.metadata, matchId: `NA1_${String(gameId)}` },
  });
}

function effectKeyFor(match: RawMatch): string {
  return `postmatch-discord:${match.metadata.matchId}:${CHANNEL}`;
}

async function deliver(match: RawMatch): Promise<number> {
  const delivered = await deliverPostmatchReport({
    matchData: match,
    trackedPlayers: [],
  });
  return delivered.size;
}

beforeEach(async () => {
  fixture = await loadRawMatchFixture();
  deliverToChannels.mockClear();
  subscribedChannels = SUBSCRIBED;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("a report that went stale before its intent was finished", () => {
  test("finishes the intent from the claim, records the real send instants, and sends nothing", async () => {
    // The fixture's game is years old, so every pass over it is past the
    // three-hour deadline — exactly the case where no later pass could ever
    // reach the completed-claim branch.
    const match = staleMatch(7701);
    const sentAt = new Date(match.info.gameCreation + 60 * 60 * 1000);
    const completedAt = new Date(sentAt.getTime() + 1500);
    // The send succeeded and its claim was completed; every durable intent
    // write of that run was lost, so there is no intent row at all.
    await prisma.scoutEffectClaim.create({
      data: {
        key: effectKeyFor(match),
        kind: "discord-channel-message",
        state: "COMPLETED",
        resultId: MESSAGE_ID,
        claimedAt: sentAt,
        completedAt,
      },
    });

    expect(await deliver(match)).toBe(0);

    // Nothing new went out: the report is still too old to send.
    expect(deliverToChannels).not.toHaveBeenCalled();

    const stored = await getIntent(prisma, {
      intentKey: NotificationIntentKeySchema.parse(effectKeyFor(match)),
    });
    // Delivered, carrying the instant the send was actually observed rather
    // than this pass's clock — which is also what lets `beginSend`'s freshness
    // guard accept an adoption running hours past the deadline.
    expect(stored?.intent.state).toEqual({
      kind: "delivered",
      messageId: MESSAGE_ID,
      deliveredAt: completedAt.toISOString(),
    });
    expect(stored?.intent.attemptCount).toBe(1);
  });

  test("adopts the delivery even when every channel has since been unsubscribed", async () => {
    // Recovery must not sit behind a return that depends on CURRENT
    // subscriptions: the send happened when the channel was subscribed, and
    // the claim that proves it does not care who is subscribed now.
    const match = staleMatch(7703);
    const sentAt = new Date(match.info.gameCreation + 60 * 60 * 1000);
    const completedAt = new Date(sentAt.getTime() + 900);
    await prisma.scoutEffectClaim.create({
      data: {
        key: effectKeyFor(match),
        kind: "discord-channel-message",
        state: "COMPLETED",
        resultId: MESSAGE_ID,
        claimedAt: sentAt,
        completedAt,
      },
    });
    subscribedChannels = [];

    expect(await deliver(match)).toBe(0);

    expect(deliverToChannels).not.toHaveBeenCalled();
    const stored = await getIntent(prisma, {
      intentKey: NotificationIntentKeySchema.parse(effectKeyFor(match)),
    });
    expect(stored?.intent.state).toEqual({
      kind: "delivered",
      messageId: MESSAGE_ID,
      deliveredAt: completedAt.toISOString(),
    });
  });

  test("a stale match with no completed claim records nothing and sends nothing", async () => {
    const match = staleMatch(7702);

    expect(await deliver(match)).toBe(0);

    expect(deliverToChannels).not.toHaveBeenCalled();
    expect(
      await getIntent(prisma, {
        intentKey: NotificationIntentKeySchema.parse(effectKeyFor(match)),
      }),
    ).toBeNull();
  });
});
