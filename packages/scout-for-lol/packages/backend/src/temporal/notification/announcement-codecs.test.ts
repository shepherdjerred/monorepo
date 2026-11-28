import { hallRecordBreakIntentKey } from "#src/durable/match/delivery-intents.ts";
import {
  hallRecordBreakAnnouncementCodec,
  hallRecordBreakAnnouncementEnvelope,
} from "#src/temporal/notification/announcement-codecs.ts";
import {
  hallBreakRecords,
  hallGuildId,
  hallRiotMatchId,
  legacyHallAnnouncementEnvelope,
} from "#src/temporal/notification/hall-record-break.test-fixtures.ts";
import { describe, expect, test } from "vitest";

function hallEnvelope(count?: number) {
  return hallRecordBreakAnnouncementEnvelope({
    guildId: hallGuildId,
    riotMatchId: hallRiotMatchId,
    records: hallBreakRecords(count),
  });
}

describe("the hall record-break announcement codec", () => {
  test("round-trips the previous record and standings through a v2 intent envelope", () => {
    const input = {
      guildId: hallGuildId,
      riotMatchId: hallRiotMatchId,
      records: hallBreakRecords(),
    };
    const envelope = structuredClone(
      hallRecordBreakAnnouncementEnvelope(input),
    );
    expect(envelope.version).toBe(2);
    expect(hallRecordBreakAnnouncementCodec.parse(envelope)).toEqual(input);
  });

  test("reads stored v1 intents with their original records", () => {
    const envelope = structuredClone(legacyHallAnnouncementEnvelope());
    expect(hallRecordBreakAnnouncementCodec.parse(envelope)).toEqual(
      envelope.data,
    );
  });

  test("requires the standings and previous score in a v2 payload", () => {
    expect(() =>
      hallRecordBreakAnnouncementCodec.parse({
        ...legacyHallAnnouncementEnvelope(),
        version: 2,
      }),
    ).toThrow();
  });

  test("refuses v2 standings out of rank order and records that only tied", () => {
    const envelope = hallEnvelope(1);
    const [record] = envelope.data.records;
    if (record === undefined) throw new Error("Missing Hall record fixture");
    const invalidRecords = [
      { ...record, standings: record.standings.toReversed() },
      { ...record, previous: { ...record.previous, value: record.value } },
    ];
    for (const invalidRecord of invalidRecords) {
      expect(() =>
        hallRecordBreakAnnouncementCodec.parse({
          ...envelope,
          data: { ...envelope.data, records: [invalidRecord] },
        }),
      ).toThrow("Hall standings must descend");
    }
  });

  test.each([legacyHallAnnouncementEnvelope(1), hallEnvelope(1)])(
    "drops a record id retired by a catalog rename in v$version",
    (envelope) => {
      const parsed = hallRecordBreakAnnouncementCodec.parse({
        ...envelope,
        data: {
          ...envelope.data,
          records: [
            { ...envelope.data.records[0], recordId: "largest_multikill" },
          ],
        },
      });
      expect(parsed.records).toEqual([]);
    },
  );

  test("still refuses a record id nobody retired", () => {
    const envelope = hallEnvelope(1);
    expect(() =>
      hallRecordBreakAnnouncementCodec.parse({
        ...envelope,
        data: {
          ...envelope.data,
          records: [{ ...envelope.data.records[0], recordId: "made_up" }],
        },
      }),
    ).toThrow();
  });

  test("refuses a record from another match in the same announcement", () => {
    const envelope = hallEnvelope(2);
    expect(() =>
      hallRecordBreakAnnouncementCodec.parse({
        ...envelope,
        data: {
          ...envelope.data,
          records: [
            envelope.data.records[0],
            { ...envelope.data.records[1], matchId: "NA1_9302" },
          ],
        },
      }),
    ).toThrow("Hall records must belong to the announced match");
  });

  test("refuses a channel in the payload: the intent's target owns it", () => {
    const envelope = hallEnvelope(1);
    expect(() =>
      hallRecordBreakAnnouncementCodec.parse({
        ...envelope,
        data: { ...envelope.data, channelId: "300000000000000001" },
      }),
    ).toThrow();
  });
});

describe("the hall record-break intent key", () => {
  test("names the match and the guild, never the channel", () => {
    expect(hallRecordBreakIntentKey(hallRiotMatchId, hallGuildId)).toBe(
      "hall-record-break:NA1_9301:100000000000000001",
    );
  });
});
