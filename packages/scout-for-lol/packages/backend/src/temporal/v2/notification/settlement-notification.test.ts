import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { NotificationIntentSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";

const stubs = vi.hoisted(() => ({
  prepareSettlementAnnouncement: vi.fn(),
  getIntent: vi.fn(),
}));

vi.mock("#src/betting/notify/announce-prepare.ts", () => ({
  prepareSettlementAnnouncement: stubs.prepareSettlementAnnouncement,
}));
vi.mock("#src/database/durable/intent-repository.ts", () => ({
  getIntent: stubs.getIntent,
}));
vi.mock("#src/database/index.ts", () => ({ prisma: {} }));

const { buildSettlementNotificationMessageV2, postmatchReplyTargetV2 } =
  await import("#src/temporal/v2/notification/settlement-notification.ts");

const MATCH_ID = RiotMatchIdSchema.parse("NA1_9301");
const CHANNEL_ID = "300000000000000001";

/** A settlement intent as the minter writes it; the payload is parsed by the arm. */
function settlementRecord(): MatchNotificationIntentRecord {
  return {
    matchId: MATCH_ID,
    intent: NotificationIntentSchema.parse({
      key: NotificationIntentKeySchema.parse(
        `settlement-discord:${MATCH_ID}:${CHANNEL_ID}`,
      ),
      kind: "settlement",
      origin: { kind: "live" },
      announcement: {
        kind: "scout-settlement-announcement",
        version: 1,
        data: {
          summary: {
            matchId: MATCH_ID,
            serverId: "100000000000000001",
            winnersPool: 0,
            losersPool: 0,
            houseCut: 0,
            bets: [],
          },
          includeOutcome: false,
          parlay: {
            matchId: MATCH_ID,
            serverId: "100000000000000001",
            yesResult: true,
            legs: [],
            messageRefs: [],
            bets: [],
          },
          earnings: [],
        },
      },
      target: { kind: "channel", channelId: CHANNEL_ID },
      freshnessDeadline: "2099-01-01T00:00:00.000Z",
      createdAt: "2026-09-17T00:00:00.000Z",
      attemptCount: 0,
      state: { kind: "ready" },
    }),
  };
}

function deliveredPostmatch(messageId: string | undefined): unknown {
  return {
    matchId: MATCH_ID,
    intent: {
      state: {
        kind: "delivered",
        deliveredAt: "2026-09-17T00:05:00.000Z",
        ...(messageId === undefined ? {} : { messageId }),
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stubs.prepareSettlementAnnouncement.mockResolvedValue({
    kind: "message",
    message: { embeds: [], content: "settled" },
    refs: [],
    showOutcome: false,
    unmatchedPositions: [],
    roster: [],
    queueType: null,
  });
  stubs.getIntent.mockResolvedValue(null);
});

describe("the settlement arm", () => {
  test("replies to the delivered post-match report in the same channel", async () => {
    // The durable equivalent of v1's postmatchMessageIds: the delivered
    // POSTMATCH intent's message id, looked up by the v1 key for the same
    // (match, channel).
    stubs.getIntent.mockResolvedValue(deliveredPostmatch("400000000000000777"));

    const message =
      await buildSettlementNotificationMessageV2(settlementRecord());

    expect(stubs.getIntent.mock.calls[0]?.[1]).toEqual({
      intentKey: `postmatch-discord:${MATCH_ID}:${CHANNEL_ID}`,
    });
    expect(message.reply).toEqual({
      messageReference: "400000000000000777",
      failIfNotExists: false,
    });
    expect(message.allowedMentions).toEqual({ parse: [] });
    expect(message.content).toBe("settled");
  });

  test("stands alone when the report was never delivered or has no id", async () => {
    expect(await postmatchReplyTargetV2(MATCH_ID, CHANNEL_ID)).toBeUndefined();
    stubs.getIntent.mockResolvedValue(deliveredPostmatch(undefined));
    expect(await postmatchReplyTargetV2(MATCH_ID, CHANNEL_ID)).toBeUndefined();
    stubs.getIntent.mockResolvedValue({
      matchId: MATCH_ID,
      intent: { state: { kind: "ready" } },
    });
    expect(await postmatchReplyTargetV2(MATCH_ID, CHANNEL_ID)).toBeUndefined();

    const message =
      await buildSettlementNotificationMessageV2(settlementRecord());
    expect(message.reply).toBeUndefined();
  });

  test("hands v1 exactly the announcement the intent carries", async () => {
    await buildSettlementNotificationMessageV2(settlementRecord());

    expect(
      stubs.prepareSettlementAnnouncement.mock.calls[0]?.[0],
    ).toMatchObject({
      summary: { matchId: MATCH_ID, serverId: "100000000000000001" },
      includeOutcome: false,
      parlay: { yesResult: true },
      earnings: [],
    });
  });

  test.each(["pool-missing", "nothing-to-report"] as const)(
    "treats %s as a broken minting contract",
    async (kind) => {
      stubs.prepareSettlementAnnouncement.mockResolvedValue({ kind });
      await expect(
        buildSettlementNotificationMessageV2(settlementRecord()),
      ).rejects.toThrow("has nothing to announce");
    },
  );
});
