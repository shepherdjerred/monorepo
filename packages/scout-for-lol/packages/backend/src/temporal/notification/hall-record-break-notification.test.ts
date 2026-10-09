import { beforeEach, describe, expect, test, vi } from "vitest";
import { v5 as uuidv5 } from "uuid";
import {
  COMPETITIVE_PROGRESSION_CATALOG,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { NotificationIntentKeySchema } from "@scout-for-lol/domain/identity/brands.ts";
import { NotificationIntentSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { hallRecordBreakIntentKey } from "#src/durable/match/delivery-intents.ts";
import {
  hallBreakRecords,
  hallGuildId,
  hallRiotMatchId,
} from "#src/temporal/notification/hall-record-break.test-fixtures.ts";

/**
 * The Hall-shaped delivery arm. The snapshot pins what the embed IS, so a copy
 * change shows up here as a deliberate diff.
 */

const stubs = vi.hoisted(() => ({
  isPolicyEnabled: vi.fn(),
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
vi.mock("#src/analytics/hall.ts", () => ({
  captureHallRecordBroken: stubs.captureHallRecordBroken,
}));
vi.mock("#src/metrics/progression.ts", () => ({
  hallRecordBreakDeliveries: { inc: stubs.inc },
}));

const { MalformedAnnouncementIntentError } =
  await import("#src/temporal/notification/announcement-codecs.ts");
const { UndeliverableContentError } =
  await import("#src/temporal/notification/undeliverable-content.ts");
const { hallRecordBreakAnnouncementEnvelope } =
  await import("#src/temporal/notification/announcement-codecs.ts");
const {
  afterHallRecordBreakDelivered,
  assertHallRecordBreakTargetGuild,
  buildHallRecordBreakNotificationMessage,
  hallRecordBreakSuppression,
} =
  await import("#src/temporal/notification/hall-record-break-notification.ts");

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
  stubs.captureHallRecordBroken.mockResolvedValue(undefined);
});

describe("the hall record-break message", () => {
  test("is one embed for the records, with mentions disabled", () => {
    const message = buildHallRecordBreakNotificationMessage(hallRecord());

    expect(message.allowedMentions).toEqual({ parse: [] });
    const embeds = (message.embeds ?? []).map((embed) =>
      "toJSON" in embed ? embed.toJSON() : embed,
    );
    expect(embeds).toHaveLength(1);
    expect(embeds).toMatchSnapshot();
  });

  test("bounds tied holder names within Discord embed limits", () => {
    const queueFamily = COMPETITIVE_PROGRESSION_CATALOG.hall.queueFamilies[0];
    if (queueFamily === undefined) {
      throw new Error("Hall catalog requires a queue family");
    }
    const holder = {
      playerId: 1,
      playerAlias: "Long Hall Alias ".repeat(10),
      accountId: 1,
      accountAlias: "Main",
      puuid:
        "hall-test-puuid000000000000000000000000000000000000000000000000000000000000000",
    };
    const records = COMPETITIVE_PROGRESSION_CATALOG.hall.records.map(
      (record) => ({
        matchId: hallRiotMatchId,
        gameEndAt: "2026-09-04T00:00:00.000Z",
        value: 12_345,
        holder,
        queueFamilyId: queueFamily.id,
        recordId: record.id,
        holders: Array.from({ length: 20 }, () => holder),
      }),
    );

    const message = buildHallRecordBreakNotificationMessage(
      hallRecord(withRecords(records)),
    );
    const [embed] = (message.embeds ?? []).map((candidate) =>
      "toJSON" in candidate ? candidate.toJSON() : candidate,
    );
    if (embed === undefined) throw new Error("Expected one Hall embed");
    expect(embed.description).toContain(`/app/halls/${hallGuildId}`);
    const fields = embed.fields ?? [];
    const totalLength =
      (embed.title?.length ?? 0) +
      (embed.description?.length ?? 0) +
      fields.reduce(
        (total, field) => total + field.name.length + field.value.length,
        0,
      );

    expect(fields).toHaveLength(records.length);
    expect(fields.every((field) => field.value.length <= 1024)).toBe(true);
    expect(totalLength).toBeLessThanOrEqual(5800);
  });

  test("an announcement whose every record was retired is undeliverable content", () => {
    const retired = {
      ...hallBreakRecords(1)[0],
      recordId: "largest_multikill",
    };
    const build = () =>
      buildHallRecordBreakNotificationMessage(
        hallRecord(withRecords([retired])),
      );
    // The delivery narrows on this base class and parks the intent as a
    // terminal `content-unavailable` instead of sending an empty embed.
    expect(build).toThrow(UndeliverableContentError);
    expect(build).toThrow(/retired/u);
  });

  test("a payload that does not parse is undeliverable content, not a retry", () => {
    expect(() =>
      buildHallRecordBreakNotificationMessage(
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
      buildHallRecordBreakNotificationMessage(
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
    expect(() => buildHallRecordBreakNotificationMessage(record)).toThrow(
      MalformedAnnouncementIntentError,
    );
  });
});

describe("the hall record-break policy", () => {
  test("suppresses as feature-disabled when the guild turned the Hall off", async () => {
    stubs.isPolicyEnabled.mockResolvedValue(false);

    expect(await hallRecordBreakSuppression(hallRecord())).toBe(
      "feature-disabled",
    );
    expect(stubs.isPolicyEnabled).toHaveBeenCalledWith("hall_of_fame_enabled", {
      server: hallGuildId,
    });
  });

  test("permits the send while the guild has the Hall on", async () => {
    stubs.isPolicyEnabled.mockResolvedValue(true);

    expect(await hallRecordBreakSuppression(hallRecord())).toBeUndefined();
  });

  test("refuses a target channel in another guild at the send boundary", () => {
    expect(() =>
      assertHallRecordBreakTargetGuild(
        hallRecord(),
        DiscordGuildIdSchema.parse("100000000000000002"),
      ),
    ).toThrow(MalformedAnnouncementIntentError);
  });
});

describe("the hall record-break follow-up", () => {
  test("keeps one analytics event identity across Activity retries", async () => {
    const record = hallRecord();
    await afterHallRecordBreakDelivered(record);
    await afterHallRecordBreakDelivered(record);

    expect(stubs.inc).not.toHaveBeenCalled();
    expect(stubs.captureHallRecordBroken).toHaveBeenCalledWith({
      guildId: hallGuildId,
      records: hallBreakRecords().length,
      eventId: uuidv5(`hall-record-break:${record.intent.key}`, uuidv5.URL),
    });
    expect(stubs.captureHallRecordBroken).toHaveBeenCalledTimes(2);
  });
});
