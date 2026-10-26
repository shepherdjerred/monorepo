import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { buildSettlementNotificationMessage } from "#src/temporal/notification/settlement-notification.ts";
import {
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { NotificationIntentSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import { expect, test } from "vitest";
const MATCH_ID = RiotMatchIdSchema.parse("NA1_9301");
const CHANNEL_ID = "300000000000000001";
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

test("a retained settlement notification never produces a new send", async () => {
  await expect(
    buildSettlementNotificationMessage(settlementRecord()),
  ).rejects.toThrow("retired");
});
