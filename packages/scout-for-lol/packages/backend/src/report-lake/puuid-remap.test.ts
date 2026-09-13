import { describe, expect, test } from "vitest";
import { remapRawJson } from "#src/report-lake/puuid-remap.ts";

const OLD_A = "OLD_A_puuid";
const NEW_A = "NEW_A_puuid";
const OLD_B = "OLD_B_puuid";
const NEW_B = "NEW_B_puuid";
const map = new Map([
  [OLD_A, NEW_A],
  [OLD_B, NEW_B],
]);

describe("remapRawJson", () => {
  test("returns the payload untouched when no migration has run", () => {
    const payload = { metadata: { participants: [OLD_A] } };
    expect(remapRawJson(payload, new Map())).toBe(payload);
  });

  test("translates PUUIDs in a Match-V5 shape, metadata and participants alike", () => {
    const match = {
      metadata: { matchId: "NA1_1", participants: [OLD_A, OLD_B, "UNTRACKED"] },
      info: {
        gameId: 1,
        participants: [
          { puuid: OLD_A, championName: "Nautilus", win: true },
          { puuid: "UNTRACKED", championName: "Lux", win: false },
        ],
      },
    };
    expect(remapRawJson(match, map)).toEqual({
      metadata: { matchId: "NA1_1", participants: [NEW_A, NEW_B, "UNTRACKED"] },
      info: {
        gameId: 1,
        participants: [
          { puuid: NEW_A, championName: "Nautilus", win: true },
          { puuid: "UNTRACKED", championName: "Lux", win: false },
        ],
      },
    });
  });

  test("reaches PUUIDs nested inside timeline frames", () => {
    const timeline = {
      info: {
        frames: [{ events: [{ type: "KILL", killer: { puuid: OLD_B } }] }],
      },
    };
    expect(remapRawJson(timeline, map)).toEqual({
      info: {
        frames: [{ events: [{ type: "KILL", killer: { puuid: NEW_B } }] }],
      },
    });
  });

  test("leaves untracked identifiers and non-string values alone", () => {
    const payload = {
      puuid: "SOMEONE_ELSE",
      gameId: 12_345,
      ranked: true,
      endedAt: null,
    };
    expect(remapRawJson(payload, map)).toEqual(payload);
  });
});
