import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  championContextLine,
  dayRange,
  indexContextLine,
  laneWindow,
  matchupContextLine,
} from "./public-context.ts";
import { EMPTY_SNAPSHOT_V2 } from "./snapshot-v2-schema.ts";
import { openSnapshot } from "./snapshot-v2-load.ts";

const FIXTURE_INDEX = path.resolve(
  import.meta.dirname,
  "__fixtures__/snapshot-v2/champion-meta/index.json",
);

describe("dayRange", () => {
  test.each([
    ["2026-11-07", "2026-11-20", "7 to 20 Nov"],
    ["2026-10-28", "2026-11-20", "28 Oct to 20 Nov"],
    ["2026-12-30", "2027-01-12", "30 Dec 2026 to 12 Jan 2027"],
    ["2026-11-07", "2026-11-07", "7 Nov"],
  ])("%s to %s is %s", (first, last, expected) => {
    expect(dayRange(first, last)).toBe(expected);
  });

  test("refuses a day that is not a date", () => {
    expect(() => dayRange("2026-13-01", "2026-13-02")).toThrow("YYYY-MM-DD");
    expect(() => dayRange("Nov 7", "Nov 8")).toThrow("YYYY-MM-DD");
  });
});

describe("the context lines", () => {
  test("the index states patch, queue, bracket and both windows", async () => {
    const { index } = await openSnapshot(FIXTURE_INDEX);
    expect(indexContextLine(index)).toBe(
      "Patch 16.23, Ranked Solo/Duo, Emerald to Diamond, 7 to 20 Nov. Lane figures from 14 to 20 Nov.",
    );
  });

  test("a champion line counts its own games", async () => {
    const { index } = await openSnapshot(FIXTURE_INDEX);
    expect(championContextLine(12_480, index, true)).toBe(
      "From 12,480 games on patch 16.23, Ranked Solo/Duo, Emerald to Diamond, 7 to 20 Nov. Lane figures from 14 to 20 Nov.",
    );
    expect(championContextLine(1, index, false)).toBe(
      "From 1 game on patch 16.23, Ranked Solo/Duo, Emerald to Diamond, 7 to 20 Nov.",
    );
  });

  test("a matchup line names the role and counts the matchup's games", async () => {
    const { index } = await openSnapshot(FIXTURE_INDEX);
    expect(matchupContextLine("MIDDLE", 1050, index, true)).toBe(
      "Mid. From 1,050 games on patch 16.23, Ranked Solo/Duo, Emerald to Diamond, 7 to 20 Nov. Lane figures from 14 to 20 Nov.",
    );
    expect(matchupContextLine("UTILITY", 31, index, false)).toBe(
      "Support. From 31 games on patch 16.23, Ranked Solo/Duo, Emerald to Diamond, 7 to 20 Nov.",
    );
  });

  test("the lane window is left out when it is the games' window", async () => {
    const { index } = await openSnapshot(FIXTURE_INDEX);
    if (index.source === null) throw new Error("fixture has a source");
    const same = {
      ...index,
      source: {
        ...index.source,
        lane: {
          firstDay: index.source.firstDay,
          lastDay: index.source.lastDay,
          days: 14,
        },
      },
    };
    expect(laneWindow(same)).toBeNull();
    expect(indexContextLine(same)).toBe(
      "Patch 16.23, Ranked Solo/Duo, Emerald to Diamond, 7 to 20 Nov.",
    );
  });

  test("an empty snapshot has no context to state", () => {
    expect(() => indexContextLine(EMPTY_SNAPSHOT_V2.index)).toThrow(
      "states its source and context",
    );
  });
});
