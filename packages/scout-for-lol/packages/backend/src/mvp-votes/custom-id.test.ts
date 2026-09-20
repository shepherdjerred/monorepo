import { describe, expect, test } from "vitest";
import { MatchIdSchema } from "@scout-for-lol/data";
import {
  formatVoteButtonCustomId,
  formatVoteModalCustomId,
  formatVoteSelectCustomId,
  isVoteCustomId,
  MAX_CUSTOM_ID_LENGTH,
  parseVoteCustomId,
} from "#src/mvp-votes/custom-id.ts";

const MATCH = MatchIdSchema.parse("NA1_5421167767");

describe("MVP vote custom IDs", () => {
  test("round-trips buttons, selects, and modals for both categories", () => {
    for (const category of ["ally", "enemy"] as const) {
      expect(
        parseVoteCustomId(
          formatVoteButtonCustomId({ category, matchId: MATCH }),
        ),
      ).toEqual({ kind: "button", category, matchId: MATCH });
      expect(
        parseVoteCustomId(
          formatVoteSelectCustomId({ category, matchId: MATCH }),
        ),
      ).toEqual({ kind: "select", category, matchId: MATCH });
      expect(
        parseVoteCustomId(
          formatVoteModalCustomId({
            category,
            matchId: MATCH,
            nomineeIndex: 3,
          }),
        ),
      ).toEqual({
        kind: "modal",
        category,
        matchId: MATCH,
        nomineeIndex: 3,
      });
    }
  });

  test("stays inside Discord's length limit", () => {
    const longMatch = MatchIdSchema.parse("NA1_12345678901234567890");
    expect(
      formatVoteModalCustomId({
        category: "enemy",
        matchId: longMatch,
        nomineeIndex: 9,
      }).length,
    ).toBeLessThanOrEqual(MAX_CUSTOM_ID_LENGTH);
  });

  test("never throws on malformed input", () => {
    expect(parseVoteCustomId("vote:1:z:NA1_1")).toBeUndefined();
    expect(parseVoteCustomId("vote:2:a:NA1_1")).toBeUndefined();
    expect(parseVoteCustomId("vote:1:s:z:NA1_1")).toBeUndefined();
    expect(parseVoteCustomId("bb:1:b:NA1_1:0:W:10")).toBeUndefined();
    expect(isVoteCustomId("vote:1:a:NA1_1")).toBe(true);
    expect(isVoteCustomId("bb:1:b:NA1_1:0:W:10")).toBe(false);
  });
});
