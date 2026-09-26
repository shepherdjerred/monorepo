import { describe, expect, test } from "vitest";
import {
  UnknownArenaAugmentError,
  arenaAugmentsFromLakeRow,
} from "#src/report-lake/arena.ts";

function row(first: number | null) {
  return {
    augment_1_id: first,
    augment_2_id: null,
    augment_3_id: null,
    augment_4_id: null,
    augment_5_id: null,
    augment_6_id: null,
  };
}

describe("Arena augment lake read", () => {
  test("resolves a recorded augment from the pinned cache", () => {
    expect(arenaAugmentsFromLakeRow(row(1))).toEqual([
      { id: 1, name: "Accelerating Sorcery" },
    ]);
  });

  test("fails loudly when a recorded augment has no pinned asset", () => {
    expect(() => arenaAugmentsFromLakeRow(row(999_999_999))).toThrow(
      UnknownArenaAugmentError,
    );
  });
});
