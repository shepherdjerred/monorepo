import { beforeEach, describe, expect, test, vi } from "vitest";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { NotificationIntentKeySchema } from "@scout-for-lol/domain/identity/brands.ts";
import { NotificationIntentSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { hallRecordBreakIntentKey } from "#src/durable/match/delivery-intents.ts";
import {
  hallBreakRecords,
  hallGuildId,
  hallRiotMatchId,
} from "#src/temporal/v2/notification/hall-record-break.test-fixtures.ts";

/**
 * The Hall-shaped delivery arm, pinned against v1.
 *
 * The parity test is the contract this arm exists to keep: the V2 message is
 * v1's `hallBreakEmbed` output for the same records, so a guild cannot tell
 * which pipeline announced its record. The snapshot pins what that embed IS,
 * so a change to v1's copy shows up here as a deliberate diff rather than
 * silently changing both paths at once.
 */

const stubs = vi.hoisted(() => ({
  isPolicyEnabled: vi.fn(),
  fetchChannelForDelivery: vi.fn(),
  captureHallRecordBroken: vi.fn(),
  inc: vi.fn(),
}));

vi.mock("#src/configuration/flags.ts", async () => {
  return {
    ...(await vi.importActual<Record<string, unknown>>(
      "#src/configuration/flags.ts",
    )),
    isPolicyEnabled: stubs.isPolicyEnabled,
  };
});
vi.mock("#src/discord/utils/channel.ts", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "#src/discord/utils/channel.ts",
  );
  return { ...actual, fetchChannelForDelivery: stubs.fetchChannelForDelivery };
});
vi.mock("#src/analytics/hall.ts", () => ({
  captureHallRecordBroken: stubs.captureHallRecordBroken,
}));
vi.mock("#src/metrics/progression.ts", () => ({
  hallRecordBreakDeliveries: { inc: stubs.inc },
}));

const { hallBreakEmbed } = await import("#src/progression/hall/outbox.ts");
const { MalformedAnnouncementIntentError } =
  await import("#src/temporal/v2/notification/announcement-codecs.ts");
const { UndeliverableContentError } =
  await import("#src/temporal/v2/notification/undeliverable-content.ts");
const { hallRecordBreakAnnouncementEnvelope } =
  await import("#src/temporal/v2/notification/announcement-codecs.ts");
const {
  afterHallRecordBreakDeliveredV2,
  buildHallRecordBreakNotificationMessageV2,
  hallRecordBreakSuppressionV2,
} =
  await import("#src/temporal/v2/notification/hall-record-break-notification.ts");

function hallRecord(
  announcement: unknown = hallRecordBreakAnnouncementEnvelope({
    guildId: hallGuildId,
    riotMatchId: hallRiotMatchId,
    records: hallBreakRecords(),
  }),
): MatchNotificationIntentRecord {
  return {
    matchId: hallRiotMatchId,
    intent: NotificationIntentSchema.parse({
      key: NotificationIntentKeySchema.parse(
        hallRecordBreakIntentKey(hallRiotMatchId, hallGuildId),
      ),
      kind: "hall-record-break",
      origin: { kind: "live" },
      target: { kind: "channel", channelId: "300000000000000001" },
      freshnessDeadline: "2099-01-01T00:00:00.000Z",
      createdAt: "2026-09-12T10:00:00.000Z",
      attemptCount: 0,
      announcement,
      state: { kind: "ready" },
    }),
  };
}

function withRecords(records: unknown[]): unknown {
  const envelope = hallRecordBreakAnnouncementEnvelope({
    guildId: hallGuildId,
    riotMatchId: hallRiotMatchId,
    records: hallBreakRecords(),
  });
  return { ...envelope, data: { ...envelope.data, records } };
}

beforeEach(() => {
  vi.clearAllMocks();
  stubs.fetchChannelForDelivery.mockResolvedValue({ guildId: hallGuildId });
  stubs.captureHallRecordBroken.mockResolvedValue(undefined);
});

describe("the hall record-break message", () => {
  test("is v1's embed for the same records, with mentions disabled", () => {
    const message = buildHallRecordBreakNotificationMessageV2(hallRecord());
    const v1 = hallBreakEmbed(
      JSON.stringify(hallBreakRecords()),
      hallRiotMatchId,
      hallGuildId,
    );
    if (v1 === null) throw new Error("v1 built no embed for live record ids");

    expect(message.allowedMentions).toEqual({ parse: [] });
    const embeds = (message.embeds ?? []).map((embed) =>
      "toJSON" in embed ? embed.toJSON() : embed,
    );
    expect(embeds).toEqual([v1.toJSON()]);
    expect(embeds).toMatchSnapshot();
  });

  test("an announcement whose every record was retired is undeliverable content", () => {
    const retired = {
      ...hallBreakRecords(1)[0],
      recordId: "largest_multikill",
    };
    const build = () =>
      buildHallRecordBreakNotificationMessageV2(
        hallRecord(withRecords([retired])),
      );
    // The delivery narrows on this base class and parks the intent as a
    // terminal `content-unavailable` instead of sending an empty embed.
    expect(build).toThrow(UndeliverableContentError);
    expect(build).toThrow(/retired/u);
  });

  test("a payload that does not parse is undeliverable content, not a retry", () => {
    expect(() =>
      buildHallRecordBreakNotificationMessageV2(
        hallRecord(withRecords([{ recordId: "made_up" }])),
      ),
    ).toThrow(MalformedAnnouncementIntentError);
  });

  test("a payload naming another match than its row is refused", () => {
    const envelope = hallRecordBreakAnnouncementEnvelope({
      guildId: hallGuildId,
      riotMatchId: hallRiotMatchId,
      records: hallBreakRecords(),
    });
    expect(() =>
      buildHallRecordBreakNotificationMessageV2(
        hallRecord({
          ...envelope,
          data: { ...envelope.data, riotMatchId: "NA1_1" },
        }),
      ),
    ).toThrow(MalformedAnnouncementIntentError);
  });

  test("a guild that disagrees with the durable Hall key is refused", () => {
    const record = hallRecord();
    record.intent.key = NotificationIntentKeySchema.parse(
      hallRecordBreakIntentKey(
        hallRiotMatchId,
        DiscordGuildIdSchema.parse("100000000000000002"),
      ),
    );
    expect(() => buildHallRecordBreakNotificationMessageV2(record)).toThrow(
      MalformedAnnouncementIntentError,
    );
  });
});

describe("the hall record-break policy", () => {
  test("suppresses as feature-disabled when the guild turned the Hall off", async () => {
    stubs.isPolicyEnabled.mockResolvedValue(false);

    expect(await hallRecordBreakSuppressionV2(hallRecord())).toBe(
      "feature-disabled",
    );
    expect(stubs.isPolicyEnabled).toHaveBeenCalledWith("hall_of_fame_enabled", {
      server: hallGuildId,
    });
    expect(stubs.fetchChannelForDelivery).not.toHaveBeenCalled();
  });

  test("permits the send while the guild has the Hall on", async () => {
    stubs.isPolicyEnabled.mockResolvedValue(true);

    expect(await hallRecordBreakSuppressionV2(hallRecord())).toBeUndefined();
  });

  test("refuses a target channel in another guild before sending", async () => {
    stubs.isPolicyEnabled.mockResolvedValue(true);
    stubs.fetchChannelForDelivery.mockResolvedValue({
      guildId: "100000000000000002",
    });
    await expect(hallRecordBreakSuppressionV2(hallRecord())).rejects.toThrow(
      MalformedAnnouncementIntentError,
    );
    expect(stubs.isPolicyEnabled).toHaveBeenCalledWith("hall_of_fame_enabled", {
      server: hallGuildId,
    });
  });
});

describe("the hall record-break follow-up", () => {
  test("counts the delivery and captures v1's analytics event after the send", async () => {
    await afterHallRecordBreakDeliveredV2(hallRecord());

    expect(stubs.inc).toHaveBeenCalledWith({ status: "sent" });
    expect(stubs.captureHallRecordBroken).toHaveBeenCalledWith({
      guildId: hallGuildId,
      records: hallBreakRecords().length,
    });
  });
});
