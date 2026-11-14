import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { describe, expect, test } from "vitest";
import { convertLcuMatchBundleChecked } from "./lcu-match.ts";
import { isArenaClientPayload } from "./unsupported-mode.ts";

describe("isArenaClientPayload", () => {
  test.each([1700, 1740, 1750])("recognises Arena queue %i", (queueId) => {
    expect(
      isArenaClientPayload({
        resource: "match_history_game:1",
        data: { queueId, gameMode: "" },
      }),
    ).toBe(true);
  });

  test("recognises a CHERRY end-of-game statsBlock with no teams", () => {
    expect(
      isArenaClientPayload({
        resource: "post_game",
        data: { gameMode: "CHERRY", statsBlock: { players: [] } },
      }),
    ).toBe(true);
  });

  test("recognises Arena from the gameflow context queue", () => {
    expect(
      isArenaClientPayload({
        data: { gameData: { queue: { id: 1740, gameMode: "CHERRY" } } },
      }),
    ).toBe(true);
  });

  test("leaves other modes and unstated modes alone", () => {
    expect(
      isArenaClientPayload({ data: { queueId: 420, gameMode: "CLASSIC" } }),
    ).toBe(false);
    expect(isArenaClientPayload({ data: { statsBlock: {} } })).toBe(false);
    expect(isArenaClientPayload(null)).toBe(false);
  });
});

describe("convertLcuMatchBundleChecked", () => {
  test("refuses an Arena bundle explicitly before converting", () => {
    expect(
      convertLcuMatchBundleChecked(RiotMatchIdSchema.parse("NA1_7101"), {
        matchHistory: { queueId: 1740, gameMode: "CHERRY" },
        endOfGame: { gameMode: "CHERRY" },
      }),
    ).toEqual({ kind: "unsupported_mode", mode: "arena" });
  });

  test("reports an unparseable non-Arena bundle as incomplete", () => {
    expect(
      convertLcuMatchBundleChecked(RiotMatchIdSchema.parse("NA1_7101"), {
        matchHistory: { queueId: 420, gameMode: "CLASSIC" },
      }),
    ).toEqual({ kind: "incomplete" });
  });
});
