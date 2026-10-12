import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { RawMatchSchema } from "@scout-for-lol/data";
import {
  UnknownArenaAugmentError,
  arenaAugmentsFromLakeRow,
  participantAugmentLakeFields,
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

  test("resolves every historical augment in the committed Arena match", async () => {
    const fixture: unknown = JSON.parse(
      await readFile(
        new URL("../../../../testdata/arena.json", import.meta.url),
        "utf8",
      ),
    );
    const match = RawMatchSchema.parse(fixture);
    const augments = match.info.participants.flatMap((participant) =>
      arenaAugmentsFromLakeRow(participantAugmentLakeFields(participant)),
    );
    expect(augments).toContainEqual({ id: 71, name: "Scopier Weapons" });
    expect(augments).toContainEqual({ id: 250, name: "Slow and Steady" });
  });

  test("fails loudly when a recorded augment has no pinned asset", () => {
    expect(() => arenaAugmentsFromLakeRow(row(999_999_999))).toThrow(
      UnknownArenaAugmentError,
    );
  });

  test("resolves names recorded by Arena, Mayhem, and Classic modes", () => {
    expect(
      arenaAugmentsFromLakeRow({
        ...row(374),
        augment_2_id: 2008,
        augment_3_id: 7001,
      }),
    ).toEqual([
      { id: 374, name: "Rice and Chicken" },
      { id: 2008, name: "Weighted Popoffs" },
      { id: 7001, name: "Upgrade: Zz'Rot Portal" },
    ]);
  });
});
