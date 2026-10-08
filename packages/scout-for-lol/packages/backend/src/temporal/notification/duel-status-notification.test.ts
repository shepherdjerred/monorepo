import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotificationIntentSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import type { DuelNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { duelStatusAnnouncementCodec } from "#src/progression/duels/status-message.ts";

const stubs = vi.hoisted(() => ({
  findUnique: vi.fn(),
  rolloutAllowed: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: { duelSeries: { findUnique: stubs.findUnique } },
}));
vi.mock("#src/progression/duels/access.ts", () => ({
  duelRolloutAllowed: stubs.rolloutAllowed,
}));

const { buildDuelStatusNotificationMessage, duelStatusSuppression } =
  await import("#src/temporal/notification/duel-status-notification.ts");

const DUEL_ID = "00000000-0000-4000-8000-000000000902";
const GUILD_ID = "100000000000000902";
const CHANNEL_ID = "300000000000000902";
const ACCOUNT_ID = "200000000000000902";

function duelRecord(guildId = GUILD_ID): DuelNotificationIntentRecord {
  return {
    duelId: DUEL_ID,
    intent: NotificationIntentSchema.parse({
      key: `duel-status:duel-invited:${DUEL_ID}`,
      kind: "duel-status",
      origin: { kind: "live" },
      target: { kind: "channel", channelId: CHANNEL_ID },
      freshnessDeadline: "2026-10-07T00:00:00.000Z",
      createdAt: "2026-09-30T00:00:00.000Z",
      attemptCount: 0,
      announcement: duelStatusAnnouncementCodec.serialize({
        guildId: DiscordGuildIdSchema.parse(guildId),
        payload: {
          kind: "invited",
          seriesId: DUEL_ID,
          mentionDiscordIds: [DiscordAccountIdSchema.parse(ACCOUNT_ID)],
        },
      }),
      state: { kind: "ready" },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stubs.findUnique.mockResolvedValue({
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
  });
  stubs.rolloutAllowed.mockResolvedValue(true);
});

describe("Duel V2 notification", () => {
  test("renders the legacy copy with explicit mention permissions", async () => {
    const message = await buildDuelStatusNotificationMessage(
      duelRecord(),
      GUILD_ID,
    );
    expect(message.content).toBe(`<@${ACCOUNT_ID}>`);
    expect(message.allowedMentions).toEqual({ parse: [], users: [ACCOUNT_ID] });
    expect(message.embeds?.[0]).toMatchObject({
      data: { title: "Duel challenge" },
    });
  });

  test("refuses a target channel from another series or guild", async () => {
    stubs.findUnique.mockResolvedValue({
      guildId: GUILD_ID,
      channelId: "300000000000000999",
    });
    await expect(
      buildDuelStatusNotificationMessage(duelRecord(), GUILD_ID),
    ).rejects.toThrow("no longer agree");
    stubs.findUnique.mockResolvedValue({
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
    });
    await expect(
      buildDuelStatusNotificationMessage(duelRecord(), "100000000000000999"),
    ).rejects.toThrow("no longer agree");
  });

  test("suppresses a status after the Duel rollout is disabled", async () => {
    stubs.rolloutAllowed.mockResolvedValue(false);
    expect(await duelStatusSuppression(duelRecord())).toBe("feature-disabled");
  });
});
