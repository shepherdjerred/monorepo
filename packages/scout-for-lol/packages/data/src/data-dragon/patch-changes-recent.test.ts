import { describe, expect, test } from "vitest";
import {
  getRecentChampionChanges,
  patchChanges,
} from "#src/data-dragon/patch-changes.ts";
import { selectRecentChanges } from "#src/data-dragon/patch-changes-recent.ts";

// Ids from the committed notes (26.14 to 26.23).
const ANNIE = 1;
const KAYLE = 10;
const LEBLANC = 7;
const NASUS = 75;
const NUNU = 20;
const DORANS_BOW = 1086;
const OVERLORDS_BLOODMAIL = 2501;

describe("getRecentChampionChanges", () => {
  test("groups a champion's lines under their patch with the notes' date", () => {
    const [group, ...rest] = getRecentChampionChanges({
      championId: ANNIE,
      patches: 3,
    });
    expect(rest).toEqual([]);
    expect(group?.patch).toBe("26.23");
    expect(group?.date).toBe("2026-11-17");
    expect(group?.changes.map((change) => change.stat)).toEqual([
      "Tibbers Health",
      "Tibbers Aura Damage per Second",
      "Tibbers Attack Damage",
    ]);
    expect(group?.changes.map((change) => change.direction)).toEqual([
      "adjust",
      "buff",
      "buff",
    ]);
  });

  test("a group's direction is buff or nerf only when every line agrees", () => {
    const [nasus] = getRecentChampionChanges({
      championId: NASUS,
      patches: 10,
    });
    expect(nasus?.patch).toBe("26.19");
    expect(nasus?.direction).toBe("nerf");

    const [annie] = getRecentChampionChanges({ championId: ANNIE, patches: 1 });
    expect(annie?.direction).toBe("adjust");
  });

  test("returns the newest patch first across several patches", () => {
    const patches = getRecentChampionChanges({
      championId: NASUS,
      patches: 10,
    });
    expect(patches.map((group) => group.patch)).toEqual([
      "26.19",
      "26.17",
      "26.16",
    ]);
    expect(patches.map((group) => group.direction)).toEqual([
      "nerf",
      "nerf",
      "adjust",
    ]);
  });

  test("a mixed patch keeps each row's own direction", () => {
    const mixed = getRecentChampionChanges({
      championId: LEBLANC,
      patches: 10,
    }).find((candidate) => candidate.patch === "26.17");
    expect(mixed?.direction).toBe("adjust");
    expect(mixed?.changes.map((change) => change.direction)).toEqual([
      "buff",
      "nerf",
      "buff",
      "buff",
    ]);
    // LeBlanc's Mimic recast is the one "RW" slot in the notes.
    expect(mixed?.changes.at(-1)?.ability?.slot).toBe("RW");
  });

  test("item lines join only the patches where the champion changed", () => {
    const [group] = getRecentChampionChanges({
      championId: KAYLE,
      patches: 2,
      itemIds: [DORANS_BOW, OVERLORDS_BLOODMAIL],
    });
    expect(group?.patch).toBe("26.22");
    expect(group?.direction).toBe("buff");
    expect(
      group?.changes.map((change) => [change.subject.name, change.direction]),
    ).toEqual([
      ["Kayle", "buff"],
      ["Kayle", "buff"],
      ["Doran's Bow", "nerf"],
      ["Overlord's Bloodmail", "buff"],
      ["Overlord's Bloodmail", "nerf"],
    ]);
  });

  test("items are left out unless asked for", () => {
    const [group] = getRecentChampionChanges({ championId: KAYLE, patches: 2 });
    expect(group?.changes.map((change) => change.subject.kind)).toEqual([
      "champion",
      "champion",
    ]);
  });

  test("a patch with only item lines for the champion's build is left out", () => {
    const patches = getRecentChampionChanges({
      championId: NUNU,
      patches: 10,
      itemIds: [DORANS_BOW],
    });
    expect(patches.map((group) => group.patch)).toEqual(["26.21"]);
  });

  test("looks across the newest patches in the notes, not the champion's own", () => {
    expect(
      getRecentChampionChanges({ championId: NUNU, patches: 3 }).map(
        (group) => group.patch,
      ),
    ).toEqual(["26.21"]);
    expect(getRecentChampionChanges({ championId: NUNU, patches: 2 })).toEqual(
      [],
    );
  });

  test("a champion with no change in the window gets an empty list", () => {
    expect(getRecentChampionChanges({ championId: NASUS, patches: 3 })).toEqual(
      [],
    );
  });

  test("an unknown champion gets an empty list", () => {
    expect(
      getRecentChampionChanges({ championId: 999_999, patches: 10 }),
    ).toEqual([]);
  });

  test("rejects a champion id or window that is not a positive integer", () => {
    expect(() =>
      getRecentChampionChanges({ championId: 0, patches: 3 }),
    ).toThrow();
    expect(() =>
      getRecentChampionChanges({ championId: ANNIE, patches: 0 }),
    ).toThrow(RangeError);
  });
});

describe("selectRecentChanges", () => {
  test("orders patches by number, not by text", () => {
    const [line] = patchChanges;
    if (line === undefined) throw new Error("The notes have no lines");
    const lines = ["26.9", "26.10", "25.24"].map((patch) => ({
      ...line,
      patch,
    }));
    expect(
      selectRecentChanges(lines, {
        championId: line.subject.id,
        patches: 3,
      }).map((group) => group.patch),
    ).toEqual(["26.10", "26.9", "25.24"]);
  });
});
