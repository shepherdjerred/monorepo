import { DiscordAPIError } from "discord.js";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotificationIntentKeySchema } from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordChannelIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import { ChannelSendError } from "#src/league/discord/channel.ts";
import { attemptRef } from "#src/temporal/notification-lane/notification-delivery.test-fixtures.ts";

/**
 * A product announcement whose channel Scout can no longer see.
 *
 * Discord answers the channel lookup with Missing Access, so the channel never
 * names its guild. A product channel has no subscription row to fall back on;
 * the frozen announcement is the guild this delivery already knows. Taking it
 * from there lets `send` meet the refusal and report a definite, terminal
 * non-send — instead of a pre-send failure retried every minute forever.
 */

const stubs = vi.hoisted(() => ({
  requireIntentRecord: vi.fn(),
  resolveNotificationGate: vi.fn(),
  fetchChannelForDelivery: vi.fn(),
  subscriptionFindMany: vi.fn(),
  buildProductAnnouncementMessage: vi.fn(),
  productAnnouncementSuppression: vi.fn(),
  send: vi.fn(),
}));

vi.mock("#src/temporal/notification-lane/notification-reads.ts", () => ({
  requireIntentRecord: stubs.requireIntentRecord,
}));
vi.mock("#src/temporal/notification/notification-policy.ts", () => ({
  resolveNotificationGate: stubs.resolveNotificationGate,
}));
vi.mock("#src/temporal/notification/product/artifacts.ts", () => ({
  buildProductAnnouncementMessage: stubs.buildProductAnnouncementMessage,
}));
vi.mock("#src/temporal/notification/product/policy.ts", () => ({
  productAnnouncementSuppression: stubs.productAnnouncementSuppression,
}));
vi.mock("#src/discord/utils/channel.ts", () => ({
  fetchChannelForDelivery: stubs.fetchChannelForDelivery,
}));
vi.mock("#src/database/index.ts", () => ({
  prisma: { subscription: { findMany: stubs.subscriptionFindMany } },
}));
vi.mock("#src/discord/client.ts", () => ({ client: {} }));
vi.mock("#src/league/discord/channel.ts", async () => {
  const { channelModuleWithSend } =
    await import("#src/temporal/notification-lane/notification-delivery.test-fixtures.ts");
  return await channelModuleWithSend(stubs.send);
});

const { deliverNotification } =
  await import("#src/temporal/notification-lane/notification-delivery.ts");

const CHANNEL_ID = DiscordChannelIdSchema.parse("1566167611690061897");
const GUILD_ID = "100000000000000042";
const ANNOUNCEMENT_ID = "competition:26:scheduled:2026-11-09T08:00:00.000Z";
const INTENT_KEY = NotificationIntentKeySchema.parse(
  `product-discord:${ANNOUNCEMENT_ID}:channel:${CHANNEL_ID}`,
);

function missingAccess(): DiscordAPIError {
  return new DiscordAPIError(
    { code: 50_001, message: "Missing Access" },
    50_001,
    403,
    "GET",
    `https://discord.test/channels/${CHANNEL_ID}`,
    {},
  );
}

function productRecord(guildId = GUILD_ID): unknown {
  return {
    announcementId: ANNOUNCEMENT_ID,
    intent: {
      key: INTENT_KEY,
      kind: "product-announcement",
      origin: { kind: "live" },
      createdAt: "2026-11-09T08:00:00.000Z",
      target: { kind: "channel", channelId: CHANNEL_ID },
      announcement: {
        kind: "scout-product-announcement",
        version: 1,
        data: {
          announcementId: ANNOUNCEMENT_ID,
          guildId,
          messageJson: JSON.stringify({ version: 1, content: "Standings" }),
          artifacts: [],
          effect: {
            kind: "competition",
            competitionId: 26,
            phase: "scheduled",
            occurredAt: "2026-11-09T08:00:00.000Z",
          },
        },
      },
    },
  };
}

function productAttemptRef() {
  return { ...attemptRef(), intentKey: INTENT_KEY };
}

beforeEach(() => {
  vi.clearAllMocks();
  stubs.resolveNotificationGate.mockResolvedValue({ decision: "permitted" });
  stubs.buildProductAnnouncementMessage.mockResolvedValue({
    content: "Standings",
  });
  stubs.productAnnouncementSuppression.mockResolvedValue(undefined);
});

describe("a product announcement to a channel Scout lost access to", () => {
  test("is a terminal permission denial sent with the announcement's guild", async () => {
    stubs.requireIntentRecord.mockResolvedValue(productRecord());
    stubs.fetchChannelForDelivery.mockRejectedValue(missingAccess());
    stubs.send.mockRejectedValue(
      new ChannelSendError("Missing Access", CHANNEL_ID, true, missingAccess()),
    );

    expect(await deliverNotification(productAttemptRef())).toEqual({
      outcome: "failed",
      failure: { classification: "terminal", reason: "permission-denied" },
    });
    // The announcement's guild reaches `send`, which escalates to its owner.
    expect(stubs.send).toHaveBeenCalledWith(
      expect.anything(),
      CHANNEL_ID,
      GUILD_ID,
    );
    expect(stubs.productAnnouncementSuppression).toHaveBeenCalledWith(
      expect.anything(),
      GUILD_ID,
    );
    // A product channel is not a subscription; it is never asked.
    expect(stubs.subscriptionFindMany).not.toHaveBeenCalled();
  });

  test("a lookup timeout stays a retryable pre-send failure", async () => {
    stubs.requireIntentRecord.mockResolvedValue(productRecord());
    stubs.fetchChannelForDelivery.mockRejectedValue(new Error("rest 500"));

    expect(await deliverNotification(productAttemptRef())).toEqual({
      outcome: "failed",
      failure: { classification: "retryable", reason: "service-unavailable" },
    });
    expect(stubs.send).not.toHaveBeenCalled();
  });
});
