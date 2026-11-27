import { describe, expect, test } from "vitest";
import { selectMissingPatches } from "./backfill-patch-notes.ts";
import type { RiotPatch } from "./riot-patch.ts";

function patch(major: number, minor: number): RiotPatch {
  const number = `${String(major)}.${String(minor)}`;
  return {
    patch: number,
    major,
    minor,
    title: `Patch ${number} Notes`,
    tagline: "",
    url: `https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-${String(major)}-${String(minor)}-notes`,
  };
}

describe("selectMissingPatches", () => {
  test("returns unarchived patches at or after the floor, oldest first", () => {
    const feed = [
      patch(26, 21),
      patch(26, 20),
      patch(26, 19),
      patch(26, 15),
      patch(26, 14),
      patch(26, 13),
      patch(25, 24),
    ];
    const missing = selectMissingPatches(
      feed,
      new Set(["26.14", "26.19"]),
      "26.14",
    );
    expect(missing.map((entry) => entry.patch)).toEqual([
      "26.15",
      "26.20",
      "26.21",
    ]);
  });

  test("rejects a malformed floor", () => {
    expect(() => selectMissingPatches([], new Set(), "latest")).toThrow(
      "Expected a patch like 26.14",
    );
  });
});
