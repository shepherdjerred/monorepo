import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { RawMatchSchema, type RawMatch } from "@scout-for-lol/data";
import { NotificationIntentKeySchema } from "@scout-for-lol/domain/identity/brands.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { loadRawMatchFixture } from "#src/testing/raw-capture-fixtures.ts";
import { testChannelId, testGuildId } from "#src/testing/test-ids.ts";
import { getIntent } from "#src/database/durable/intent-repository.ts";
import { z } from "zod";

/** What `deliverToChannels` was actually asked to deliver to. */
const DeliveryCallSchema = z.object({
  channels: z.array(z.object({ channel: z.string() })),
});

/**
 * The hole these close: whether a report may still be SENT and whether a send
 * already made still needs RECORDING are different questions, and every exit in
 * `deliverPostmatchReport` answers only the first. An intent left unfinished by
 * a send whose durable writes were lost is reachable from the delivery pass
 * only while its channel is still eligible, and from no pass at all once the
 * match is three hours old — so recovery runs before all of it.
 */

const { prisma } = createTestDatabase("postmatch-delivery-recovery");

const CHANNEL = testChannelId("7701");
const GUILD = testGuildId("7701");
const MESSAGE_ID = "300000000000000011";

const deliverToChannels = vi.fn();
const generateMatchReport = vi.fn();

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
}));
vi.doMock("#src/database/subscribed-channels.ts", async (importOriginal) => ({
  ...(await importOriginal()),
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

// Only so a FRESH match can reach the delivery step without rendering a report.
vi.doMock(
  "#src/league/tasks/postmatch/match-report-generator.ts",
  async (importOriginal) => ({
    ...(await importOriginal()),
    generateMatchReport,
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

/** The same, played an hour ago — well inside the three-hour send window. */
function freshMatch(gameId: number): RawMatch {
  return RawMatchSchema.parse({
    ...fixture,
    metadata: { ...fixture.metadata, matchId: `NA1_${String(gameId)}` },
    info: { ...fixture.info, gameCreation: Date.now() - 60 * 60 * 1000 },
  });
}

/**
 * A send this match made an hour into its delivery window, already claimed
 * complete — the shape every case here starts from: the Discord message went
 * out and the claim proves it, while the intent writes of that run did not
 * land. Returns the instant the claim records as the delivery, which is what
 * an adoption has to reproduce.
 */
async function seedCompletedSend(match: RawMatch, key: string): Promise<Date> {
  const sentAt = new Date(match.info.gameCreation + 60 * 60 * 1000);
  const completedAt = new Date(sentAt.getTime() + 700);
  await prisma.scoutEffectClaim.create({
    data: {
      key,
      kind: "discord-channel-message",
      state: "COMPLETED",
      resultId: MESSAGE_ID,
      claimedAt: sentAt,
      completedAt,
    },
  });
  return completedAt;
}

/** The intent for `key` was finished from its claim, at the claim's instant. */
async function expectAdoptedAsDelivered(
  key: string,
  deliveredAt: Date,
): Promise<void> {
  const stored = await getIntent(prisma, {
    intentKey: NotificationIntentKeySchema.parse(key),
  });
  expect(stored?.intent.state).toEqual({
    kind: "delivered",
    messageId: MESSAGE_ID,
    deliveredAt: deliveredAt.toISOString(),
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
  deliverToChannels.mockResolvedValue({
    deliveredGuildIds: new Set(),
    messageIdsByChannel: new Map(),
  });
  generateMatchReport.mockClear();
  generateMatchReport.mockResolvedValue({ content: "report" });
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
    const completedAt = await seedCompletedSend(match, effectKeyFor(match));

    expect(await deliver(match)).toBe(0);

    // Nothing new went out: the report is still too old to send.
    expect(deliverToChannels).not.toHaveBeenCalled();
    // Delivered, carrying the instant the send was actually observed rather
    // than this pass's clock — which is also what lets `beginSend`'s freshness
    // guard accept an adoption running hours past the deadline.
    await expectAdoptedAsDelivered(effectKeyFor(match), completedAt);
    const stored = await getIntent(prisma, {
      intentKey: NotificationIntentKeySchema.parse(effectKeyFor(match)),
    });
    expect(stored?.intent.attemptCount).toBe(1);
  });

  test("adopts the delivery even when every channel has since been unsubscribed", async () => {
    // Recovery must not sit behind a return that depends on CURRENT
    // subscriptions: the send happened when the channel was subscribed, and
    // the claim that proves it does not care who is subscribed now.
    const match = staleMatch(7703);
    const completedAt = await seedCompletedSend(match, effectKeyFor(match));
    subscribedChannels = [];

    expect(await deliver(match)).toBe(0);

    expect(deliverToChannels).not.toHaveBeenCalled();
    await expectAdoptedAsDelivered(effectKeyFor(match), completedAt);
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

describe("a still-sendable report whose earlier delivery is unfinished", () => {
  test("adopts a claim for a channel that is no longer subscribed", async () => {
    // On a FRESH replay the delivery pass visits only currently eligible
    // channels, so a channel unsubscribed since its report went out is never
    // revisited — and once the match is three hours old no pass reaches
    // delivery at all. Recovery is the only thing that can still finish it.
    const match = freshMatch(7704);
    const departed = testChannelId("7799");
    const departedKey = `postmatch-discord:${match.metadata.matchId}:${departed}`;
    const completedAt = await seedCompletedSend(match, departedKey);

    await deliverPostmatchReport({ matchData: match, trackedPlayers: [] });

    // Finished from its claim, at the instant that send really happened.
    await expectAdoptedAsDelivered(departedKey, completedAt);

    // Nothing was sent to it: the delivery pass only ever saw the channel that
    // is still subscribed, which is otherwise unaffected.
    expect(deliverToChannels).toHaveBeenCalledTimes(1);
    const sentTo = DeliveryCallSchema.parse(
      deliverToChannels.mock.calls[0]?.[0],
    );
    expect(sentTo.channels.map((entry) => entry.channel)).toEqual([CHANNEL]);
  });
});
