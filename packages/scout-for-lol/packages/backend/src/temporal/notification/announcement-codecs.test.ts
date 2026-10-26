import { hallRecordBreakIntentKey } from "#src/durable/match/delivery-intents.ts";
import {
  hallRecordBreakAnnouncementCodec,
  hallRecordBreakAnnouncementEnvelope,
} from "#src/temporal/notification/announcement-codecs.ts";
import {
  hallBreakRecords,
  hallGuildId,
  hallRiotMatchId,
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
  test("round-trips v1's outbox records through the intent envelope", () => {
    const input = {
      guildId: hallGuildId,
      riotMatchId: hallRiotMatchId,
      records: hallBreakRecords(),
    };
    const parsed = hallRecordBreakAnnouncementCodec.parse(
      structuredClone(hallRecordBreakAnnouncementEnvelope(input)),
    );
    expect(parsed).toEqual(input);
  });

  test("carries the records exactly as v1's outbox stores them", () => {
    const envelope = structuredClone(hallEnvelope());
    expect(JSON.stringify(envelope.data.records)).toBe(
      JSON.stringify(hallBreakRecords()),
    );
  });

  test("drops a record id retired by a catalog rename, as v1's reader does", () => {
    const envelope = hallEnvelope(1);
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
  });

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
