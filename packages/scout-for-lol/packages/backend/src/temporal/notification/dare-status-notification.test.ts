import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  BucksAmountSchema,
  DarePayoutSchema,
  DarePotTotalSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { DareNotificationIntentRecordSchema } from "#src/database/durable/intent-row.ts";
import { dareStatusAnnouncementCodec } from "#src/betting/dares/presentation/notify/dare-status-message.ts";

const stubs = vi.hoisted(() => ({
  findUnique: vi.fn(),
  isPolicyEnabled: vi.fn(),
  getPreferences: vi.fn(),
  refreshCallout: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: { bucksDare: { findUnique: stubs.findUnique } },
}));
vi.mock("#src/configuration/flags.ts", () => ({
  isPolicyEnabled: stubs.isPolicyEnabled,
}));
vi.mock("#src/betting/notify/notification-preferences.ts", () => ({
  getBucksNotificationPreferences: stubs.getPreferences,
}));
vi.mock("#src/betting/dares/presentation/dare-callout.ts", () => ({
  refreshDareCallout: stubs.refreshCallout,
}));

const {
  afterDareStatusDelivered,
  buildDareStatusNotificationMessage,
  dareStatusSuppression,
} = await import("#src/temporal/notification/dare-status-notification.ts");

const GUILD_ID = "100000000000000902";
const ACCOUNT_ID = "200000000000000902";

function record(category: "lifecycle" | "progress" = "progress") {
  return DareNotificationIntentRecordSchema.parse({
    dareId: 902,
    intent: {
      key: "dare-status:test:recipient:200000000000000902",
      kind: "dare-status",
      origin: { kind: "live" },
      target: { kind: "dm", accountId: ACCOUNT_ID },
      freshnessDeadline: "2026-10-07T00:00:00.000Z",
      createdAt: "2026-09-30T00:00:00.000Z",
      attemptCount: 0,
      announcement: dareStatusAnnouncementCodec.serialize({
        dareId: 902,
        revision: 1,
        guildId: DiscordGuildIdSchema.parse(GUILD_ID),
        category,
        kind: "advanced",
        summary: "One win remains.",
      }),
      state: { kind: "ready" },
    },
  });
}

const CHANNEL_ID = "300000000000000902";
const CHALLENGER_ID = DiscordAccountIdSchema.parse("200000000000000903");
const PAYEE_ID = DiscordAccountIdSchema.parse("200000000000000904");

function resultRecord(target: "channel" | "dm" = "channel") {
  return DareNotificationIntentRecordSchema.parse({
    dareId: 902,
    intent: {
      key: "dare-result:902:revision:1",
      kind: "dare-status",
      origin: { kind: "live" },
      target:
        target === "channel"
          ? { kind: "channel", channelId: CHANNEL_ID }
          : { kind: "dm", accountId: ACCOUNT_ID },
      freshnessDeadline: "2026-10-07T00:00:00.000Z",
      createdAt: "2026-09-30T00:00:00.000Z",
      attemptCount: 0,
      announcement: dareStatusAnnouncementCodec.serialize({
        dareId: 902,
        revision: 1,
        guildId: DiscordGuildIdSchema.parse(GUILD_ID),
        category: "lifecycle",
        kind: "achieved",
        summary: "Virmel wins on Twisted Fate",
        result: {
          resolution: "achieved",
          challengerDiscordId: CHALLENGER_ID,
          plainLanguage: "Virmel wins on Twisted Fate",
          potTotal: DarePotTotalSchema.parse(30),
          payouts: [
            {
              discordId: PAYEE_ID,
              alias: "Virmel",
              net: DarePayoutSchema.parse(28),
              fee: BucksAmountSchema.parse(2),
            },
          ],
          refunds: [],
          voidReason: null,
        },
      }),
      state: { kind: "ready" },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stubs.findUnique.mockResolvedValue({ serverId: GUILD_ID });
  stubs.isPolicyEnabled.mockResolvedValue(true);
  stubs.getPreferences.mockResolvedValue({
    dareLifecycleDms: true,
    dareProgressDms: true,
  });
});

describe("Dare V2 notification", () => {
  test("renders the legacy copy without mention permissions", async () => {
    expect(await buildDareStatusNotificationMessage(record())).toEqual({
      content: "**Dare #902 — advanced**\nOne win remains.",
      allowedMentions: { parse: [] },
    });
  });

  test("suppresses the current category preference", async () => {
    stubs.getPreferences.mockResolvedValue({
      dareLifecycleDms: true,
      dareProgressDms: false,
    });
    expect(await dareStatusSuppression(record())).toBe("recipient-preference");
    expect(await dareStatusSuppression(record("lifecycle"))).toBeUndefined();
  });

  test("suppresses when the guild disables Dare notifications", async () => {
    stubs.isPolicyEnabled.mockResolvedValue(false);
    expect(await dareStatusSuppression(record())).toBe("feature-disabled");
    expect(stubs.getPreferences).not.toHaveBeenCalled();
  });

  test("refuses an announcement for a different guild", async () => {
    stubs.findUnique.mockResolvedValue({ serverId: "100000000000000999" });
    await expect(dareStatusSuppression(record())).rejects.toThrow(
      "no longer agree",
    );
  });
});

describe("the Dare result post", () => {
  test("renders the result and pings exactly the people it names", () => {
    expect(buildDareStatusNotificationMessage(resultRecord())).toEqual({
      content: [
        "✅ **Scout Dare #902: ACHIEVED**",
        "Virmel wins on Twisted Fate",
        `Funded by <@${CHALLENGER_ID}>. The **30 BB** pot pays out:`,
        `• **Virmel** <@${PAYEE_ID}> — +**28 BB** · **2 BB** fee`,
      ].join("\n"),
      allowedMentions: { parse: [], users: [CHALLENGER_ID, PAYEE_ID] },
    });
  });

  test("answers to the guild flag, not to a participant's DM preferences", async () => {
    stubs.getPreferences.mockResolvedValue({
      dareLifecycleDms: false,
      dareProgressDms: false,
    });
    expect(await dareStatusSuppression(resultRecord())).toBeUndefined();
    expect(stubs.getPreferences).not.toHaveBeenCalled();

    stubs.isPolicyEnabled.mockResolvedValue(false);
    expect(await dareStatusSuppression(resultRecord())).toBe(
      "feature-disabled",
    );
  });

  test("refuses a result payload aimed at a DM", () => {
    expect(() =>
      buildDareStatusNotificationMessage(resultRecord("dm")),
    ).toThrow("disagrees with its announcement");
  });

  test("refreshes the callout after the channel post, and only then", async () => {
    stubs.refreshCallout.mockResolvedValue(undefined);
    expect(await afterDareStatusDelivered(resultRecord())).toBe("refreshed");
    expect(stubs.refreshCallout).toHaveBeenCalledWith(902);

    stubs.refreshCallout.mockClear();
    expect(await afterDareStatusDelivered(record())).toBe("skipped");
    expect(stubs.refreshCallout).not.toHaveBeenCalled();
  });
});
