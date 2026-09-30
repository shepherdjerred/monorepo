import { beforeEach, describe, expect, test, vi } from "vitest";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { DareNotificationIntentRecordSchema } from "#src/database/durable/intent-row.ts";
import { dareStatusAnnouncementCodec } from "#src/betting/dares/presentation/notify/dare-status-message.ts";

const stubs = vi.hoisted(() => ({
  findUnique: vi.fn(),
  isPolicyEnabled: vi.fn(),
  getPreferences: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: { bucksDareV2: { findUnique: stubs.findUnique } },
}));
vi.mock("#src/configuration/flags.ts", () => ({
  isPolicyEnabled: stubs.isPolicyEnabled,
}));
vi.mock("#src/betting/notify/notification-preferences.ts", () => ({
  getBucksNotificationPreferences: stubs.getPreferences,
}));

const { buildDareStatusNotificationMessageV2, dareStatusSuppressionV2 } =
  await import("#src/temporal/v2/notification/dare-status-notification.ts");

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
    expect(await buildDareStatusNotificationMessageV2(record())).toEqual({
      content: "**Dare #902 — advanced**\nOne win remains.",
      allowedMentions: { parse: [] },
    });
  });

  test("suppresses the current category preference", async () => {
    stubs.getPreferences.mockResolvedValue({
      dareLifecycleDms: true,
      dareProgressDms: false,
    });
    expect(await dareStatusSuppressionV2(record())).toBe(
      "recipient-preference",
    );
    expect(await dareStatusSuppressionV2(record("lifecycle"))).toBeUndefined();
  });

  test("suppresses when the guild disables Dare notifications", async () => {
    stubs.isPolicyEnabled.mockResolvedValue(false);
    expect(await dareStatusSuppressionV2(record())).toBe("feature-disabled");
    expect(stubs.getPreferences).not.toHaveBeenCalled();
  });

  test("refuses an announcement for a different guild", async () => {
    stubs.findUnique.mockResolvedValue({ serverId: "100000000000000999" });
    await expect(dareStatusSuppressionV2(record())).rejects.toThrow(
      "no longer agree",
    );
  });
});
