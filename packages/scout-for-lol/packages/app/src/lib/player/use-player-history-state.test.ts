import { describe, expect, test } from "vitest";
import { readCursors } from "./use-player-history-state.ts";

describe("history cursors from profile URLs", () => {
  const cursor = {
    gameCreationMs: 1_760_000_000_000,
    matchId: "NA1_123",
    consumed: 20,
  };

  test("preserves valid pagination history", () => {
    expect(readCursors(JSON.stringify([cursor]))).toEqual([cursor]);
    expect(
      readCursors(JSON.stringify([{ ...cursor, consumed: undefined }])),
    ).toEqual([
      { gameCreationMs: cursor.gameCreationMs, matchId: cursor.matchId },
    ]);
  });

  test.each([
    null,
    "broken JSON",
    JSON.stringify(cursor),
    JSON.stringify([{ ...cursor, matchId: "" }]),
    JSON.stringify([{ ...cursor, gameCreationMs: 123.5 }]),
    JSON.stringify([{ ...cursor, consumed: -1 }]),
    JSON.stringify([{ ...cursor, consumed: 2.5 }]),
    JSON.stringify([cursor, { ...cursor, consumed: -1 }]),
  ])("returns to the first page for invalid URL input: %s", (value) => {
    expect(readCursors(value)).toEqual([]);
  });
});
