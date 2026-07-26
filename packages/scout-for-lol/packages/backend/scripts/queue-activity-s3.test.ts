import { describe, expect, test } from "bun:test";
import { RawMatchSchema, type RawMatch } from "@scout-for-lol/data/index.ts";
import {
  aggregateQueueActivity,
  matchDateString,
} from "./queue-activity-s3.ts";

const FIXTURE_URL = new URL(
  "../src/league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
  import.meta.url,
);

async function loadBaseMatch(): Promise<RawMatch> {
  const raw: unknown = await Bun.file(FIXTURE_URL).json();
  return RawMatchSchema.parse(raw);
}

function withQueueAndDate(
  base: RawMatch,
  queueId: number,
  dateString: string,
): RawMatch {
  const timestamp = Date.parse(`${dateString}T12:00:00.000Z`);
  return {
    ...base,
    info: { ...base.info, queueId, gameStartTimestamp: timestamp },
  };
}

describe("queue activity aggregation", () => {
  test("matchDateString uses the UTC game-start date", async () => {
    const base = await loadBaseMatch();
    const match = withQueueAndDate(base, 1700, "2026-07-10");
    expect(matchDateString(match)).toBe("2026-07-10");
  });

  test("counts matches per raw queue id and UTC date", async () => {
    const base = await loadBaseMatch();
    const matches: RawMatch[] = [
      withQueueAndDate(base, 1700, "2026-07-10"),
      withQueueAndDate(base, 1700, "2026-07-10"),
      withQueueAndDate(base, 1700, "2026-07-11"),
      withQueueAndDate(base, 1750, "2026-07-11"),
      withQueueAndDate(base, 450, "2026-07-11"),
    ];
    expect(aggregateQueueActivity(matches)).toEqual({
      "1700": { "2026-07-10": 2, "2026-07-11": 1 },
      "1750": { "2026-07-11": 1 },
      "450": { "2026-07-11": 1 },
    });
  });

  test("returns an empty object for no matches", () => {
    expect(aggregateQueueActivity([])).toEqual({});
  });
});
