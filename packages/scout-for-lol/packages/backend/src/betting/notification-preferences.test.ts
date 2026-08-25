import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { executeBb } from "#src/discord/commands/bb.ts";
import { formatBucksNotificationPreferences } from "#src/discord/commands/bb-notifications.ts";
import type { BbCommandInteraction } from "#src/discord/commands/bb-interaction.ts";
import {
  getBucksNotificationPreferences,
  markBucksSettlementDmHintShown,
  updateBucksNotificationPreferences,
} from "#src/betting/notification-preferences.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";

const { prisma: db } = createTestDatabase("bucks-notification-preferences");
const SERVER = DiscordGuildIdSchema.parse("1337623164146155593");
const USER = bucksTestDiscordId(20);

beforeEach(async () => {
  await db.bucksNotificationPreference.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("Bryan Bucks notification preferences", () => {
  test("defaults both categories to enabled without a row", async () => {
    await expect(
      getBucksNotificationPreferences(
        { serverId: SERVER, discordId: USER },
        db,
      ),
    ).resolves.toEqual({
      ownBetSettlementDms: true,
      betsOnPlayerSettlementDms: true,
      settlementDmHintShownAt: null,
    });
  });

  test("records the settlement hint without changing notification settings", async () => {
    await markBucksSettlementDmHintShown(
      { serverId: SERVER, discordId: USER },
      db,
    );

    const preferences = await getBucksNotificationPreferences(
      { serverId: SERVER, discordId: USER },
      db,
    );
    expect(preferences.ownBetSettlementDms).toBe(true);
    expect(preferences.betsOnPlayerSettlementDms).toBe(true);
    expect(preferences.settlementDmHintShownAt).toEqual(expect.any(Date));
  });

  test("updates one category without changing the other", async () => {
    await expect(
      updateBucksNotificationPreferences(
        {
          serverId: SERVER,
          discordId: USER,
          updates: { ownBetSettlementDms: false },
        },
        db,
      ),
    ).resolves.toEqual({
      ownBetSettlementDms: false,
      betsOnPlayerSettlementDms: true,
      settlementDmHintShownAt: null,
    });

    await expect(
      updateBucksNotificationPreferences(
        {
          serverId: SERVER,
          discordId: USER,
          updates: { betsOnPlayerSettlementDms: false },
        },
        db,
      ),
    ).resolves.toEqual({
      ownBetSettlementDms: false,
      betsOnPlayerSettlementDms: false,
      settlementDmHintShownAt: null,
    });
  });

  test("formats status-only and changed responses", () => {
    expect(
      formatBucksNotificationPreferences(
        {
          ownBetSettlementDms: true,
          betsOnPlayerSettlementDms: false,
          settlementDmHintShownAt: null,
        },
        {},
      ),
    ).toContain("Use `your_bets` or `bets_on_you`");
    expect(
      formatBucksNotificationPreferences(
        {
          ownBetSettlementDms: false,
          betsOnPlayerSettlementDms: true,
          settlementDmHintShownAt: null,
        },
        { ownBetSettlementDms: false },
      ),
    ).toContain("Updated: your bets off.");
  });

  test("runs /bb notifications privately and updates independent settings", async () => {
    const values = new Map<string, boolean>([
      ["your_bets", false],
      ["bets_on_you", true],
    ]);
    const interaction = fakeNotificationsInteraction({
      yourBets: "off",
      betsOnYou: "on",
    });
    await executeBb(interaction, {
      isPolicyEnabled: async () => true,
      getNotificationPreferences: async () => ({
        ownBetSettlementDms: values.get("your_bets") ?? true,
        betsOnPlayerSettlementDms: values.get("bets_on_you") ?? true,
        settlementDmHintShownAt: null,
      }),
      updateNotificationPreferences: async ({ updates }) => {
        if (updates.ownBetSettlementDms !== undefined) {
          values.set("your_bets", updates.ownBetSettlementDms);
        }
        if (updates.betsOnPlayerSettlementDms !== undefined) {
          values.set("bets_on_you", updates.betsOnPlayerSettlementDms);
        }
        return {
          ownBetSettlementDms: values.get("your_bets") ?? true,
          betsOnPlayerSettlementDms: values.get("bets_on_you") ?? true,
          settlementDmHintShownAt: null,
        };
      },
    });

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining("Updated: your bets off"),
    });
  });
});

function fakeNotificationsInteraction(input: {
  yourBets: string;
  betsOnYou: string;
}): BbCommandInteraction {
  return {
    id: "bb-notifications-test",
    guildId: SERVER,
    user: { id: USER },
    options: {
      getSubcommand: () => "notifications",
      getString: (name: string) =>
        name === "your_bets" ? input.yourBets : input.betsOnYou,
      getInteger: () => 1,
    },
    replied: false,
    deferred: false,
    reply: vi.fn(() => Promise.resolve(undefined)),
    deferReply: vi.fn(() => Promise.resolve(undefined)),
    editReply: vi.fn(() => Promise.resolve(undefined)),
    followUp: vi.fn(() => Promise.resolve(undefined)),
  };
}
