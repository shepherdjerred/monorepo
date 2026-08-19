import { describe, expect, test } from "bun:test";
import {
  formatBucksCustomId,
  isBucksCustomId,
  MAX_CUSTOM_ID_LENGTH,
  parseBucksCustomId,
  type BucksCustomId,
} from "#src/betting/custom-id.ts";

const BASE: BucksCustomId = {
  action: "b",
  matchId: "NA1_5421167767",
  subjectIndex: 0,
  side: "W",
  amount: 5,
};

describe("Bryan Bucks custom IDs", () => {
  test("round-trips every action, side, and amount", () => {
    for (const action of ["b", "x"] as const) {
      for (const side of ["W", "L"] as const) {
        for (const amount of [0, 1, 5, 1000]) {
          for (const subjectIndex of [0, 4, 9]) {
            const original: BucksCustomId = {
              action,
              side,
              amount,
              subjectIndex,
              matchId: "EUW1_1234567890123",
            };
            expect(parseBucksCustomId(formatBucksCustomId(original))).toEqual(
              original,
            );
          }
        }
      }
    }
  });

  test("stays well inside Discord's length limit at the worst case", () => {
    const longest = formatBucksCustomId({
      action: "b",
      matchId: "EUW1_1234567890123",
      subjectIndex: 9,
      side: "L",
      amount: 1000,
    });
    expect(longest.length).toBeLessThanOrEqual(MAX_CUSTOM_ID_LENGTH);
    // Ample headroom, which is the point of carrying an index rather than a
    // 78-character PUUID.
    expect(longest.length).toBeLessThan(50);
  });

  test("throws when an ID would exceed the limit", () => {
    expect(() =>
      formatBucksCustomId({ ...BASE, matchId: "X".repeat(200) }),
    ).toThrow(/over Discord's 100 limit/);
  });

  test("rejects malformed input without throwing", () => {
    const garbage = [
      "",
      "bb",
      "bb:1:b",
      "bb:2:b:NA1_1:0:W:5", // wrong version
      "xx:1:b:NA1_1:0:W:5", // wrong namespace
      "bb:1:z:NA1_1:0:W:5", // unknown action
      "bb:1:b:NA1_1:99:W:5", // roster index out of range
      "bb:1:b:NA1_1:0:Q:5", // unknown side
      "bb:1:b:NA1_1:0:W:2147483648", // stake outside Int32 storage
      "bb:1:b:NA1_1:0:W:-1", // negative stake
      "bb:1:b:NA1_1:abc:W:5", // non-numeric index
      "bb:1:b::0:W:5", // empty match id
      ":".repeat(40),
    ];

    for (const raw of garbage) {
      expect(parseBucksCustomId(raw)).toBeUndefined();
    }
  });

  test("claims only its own namespace", () => {
    expect(isBucksCustomId("bb:1:b:NA1_1:0:W:5")).toBe(true);
    expect(isBucksCustomId("bb:anything")).toBe(true);
    expect(isBucksCustomId("other:1:b")).toBe(false);
    expect(isBucksCustomId("")).toBe(false);
  });

  test("a cancel carries no meaningful stake", () => {
    const cancel = formatBucksCustomId({ ...BASE, action: "x", amount: 0 });
    expect(parseBucksCustomId(cancel)?.amount).toBe(0);
  });
});
