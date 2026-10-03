import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordGuildIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import {
  NotificationIntentSchema,
  NotificationIntentStateSchema,
  type NotificationIntentState,
} from "@scout-for-lol/domain/notifications/intent.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";

const stubs = vi.hoisted(() => ({
  prematchGuildOfChannel: vi.fn(),
  recordCoreOutputsDelivered: vi.fn(),
}));
vi.mock("#src/temporal/v2/prematch/prematch-markets.ts", () => ({
  prematchGuildOfChannel: stubs.prematchGuildOfChannel,
}));
vi.mock("#src/analytics/guild-lifecycle.ts", () => ({
  recordCoreOutputsDelivered: stubs.recordCoreOutputsDelivered,
}));

const { afterPostmatchDeliveredV2 } =
  await import("#src/temporal/v2/notification/postmatch-follow-up.ts");

const MATCH_ID = RiotMatchIdSchema.parse("NA1_9301");
const CHANNEL_ID = "300000000000000001";
const GUILD_ID = DiscordGuildIdSchema.parse("100000000000000001");

function postmatchRecord(
  state: NotificationIntentState,
): MatchNotificationIntentRecord {
  return {
    matchId: MATCH_ID,
    intent: NotificationIntentSchema.parse({
      key: NotificationIntentKeySchema.parse(
        `postmatch-discord:${MATCH_ID}:${CHANNEL_ID}`,
      ),
      kind: "postmatch",
      origin: { kind: "live" },
      target: { kind: "channel", channelId: CHANNEL_ID },
      freshnessDeadline: "2099-01-01T00:00:00.000Z",
      createdAt: "2026-09-17T00:00:00.000Z",
      attemptCount: state.kind === "delivered" ? 1 : 0,
      state,
    }),
  };
}

const DELIVERED = NotificationIntentStateSchema.parse({
  kind: "delivered",
  deliveredAt: "2026-09-17T00:05:00.000Z",
  messageId: "400000000000000777",
});

beforeEach(() => {
  vi.clearAllMocks();
  stubs.prematchGuildOfChannel.mockResolvedValue(GUILD_ID);
  stubs.recordCoreOutputsDelivered.mockResolvedValue(undefined);
});

describe("the post-match follow-up", () => {
  test("counts the delivered report against its channel's guild", async () => {
    await afterPostmatchDeliveredV2(postmatchRecord(DELIVERED));

    expect(stubs.prematchGuildOfChannel).toHaveBeenCalledWith(CHANNEL_ID);
    expect(stubs.recordCoreOutputsDelivered).toHaveBeenCalledWith(
      [GUILD_ID],
      "postmatch",
    );
  });

  test("counts nothing for a channel no subscription names any more", async () => {
    stubs.prematchGuildOfChannel.mockResolvedValue(null);

    await afterPostmatchDeliveredV2(postmatchRecord(DELIVERED));

    expect(stubs.recordCoreOutputsDelivered).not.toHaveBeenCalled();
  });

  test("counts nothing for a report that was not delivered", async () => {
    await afterPostmatchDeliveredV2(
      postmatchRecord(NotificationIntentStateSchema.parse({ kind: "ready" })),
    );

    expect(stubs.prematchGuildOfChannel).not.toHaveBeenCalled();
    expect(stubs.recordCoreOutputsDelivered).not.toHaveBeenCalled();
  });
});
