import { describe, expect, test } from "vitest";
import fixture from "./__fixtures__/champion-meta.fixture.json";
import {
  championRoles,
  championSlug,
  evidenceLine,
  hasChampions,
  parseChampionMetaSnapshot,
  roleFromSlug,
  topBuilds,
} from "./snapshot.ts";

describe("championSlug", () => {
  test.each([
    ["Ahri", "ahri"],
    ["Kai'Sa", "kaisa"],
    ["Nunu & Willump", "nunu-willump"],
    ["Dr. Mundo", "dr-mundo"],
    ["Renata Glasc", "renata-glasc"],
    ["Bel'Veth", "belveth"],
  ])("%s becomes %s", (name, slug) => {
    expect(championSlug(name)).toBe(slug);
  });
});

describe("snapshot validation", () => {
  const snapshot = parseChampionMetaSnapshot(fixture);

  test("accepts the fixture", () => {
    expect(hasChampions(snapshot)).toBe(true);
    expect(snapshot.champions.map((champion) => champion.slug)).toEqual([
      "ahri",
      "kaisa",
    ]);
  });

  test("rejects a slug that does not match the name", () => {
    expect(() =>
      parseChampionMetaSnapshot({
        ...fixture,
        champions: [{ ...fixture.champions[0], slug: "other" }],
      }),
    ).toThrow(/does not match/u);
  });

  test("rejects duplicate slugs", () => {
    expect(() =>
      parseChampionMetaSnapshot({
        ...fixture,
        champions: [fixture.champions[0], fixture.champions[0]],
      }),
    ).toThrow(/Duplicate/u);
  });

  test("rejects champions with no source", () => {
    expect(() =>
      parseChampionMetaSnapshot({ ...fixture, source: null }),
    ).toThrow(/source/u);
  });

  test("orders roles by games played", () => {
    const kaisa = snapshot.champions[1];
    if (kaisa === undefined) throw new Error("fixture lost Kai'Sa");
    expect(championRoles(kaisa).map((slice) => slice.context.role)).toEqual([
      "BOTTOM",
      "MIDDLE",
    ]);
  });
});

describe("presentation", () => {
  const snapshot = parseChampionMetaSnapshot(fixture);
  const ahri = snapshot.champions[0];
  if (ahri === undefined) throw new Error("fixture lost Ahri");
  const [slice] = ahri.slices;
  if (slice === undefined) throw new Error("fixture lost Ahri's slice");

  test("every block states games, patch, queue and bracket", () => {
    expect(evidenceLine(1204, slice.context)).toBe(
      "from 1,204 games · patch 16.3 · Ranked Solo/Duo · all ranks",
    );
  });

  test("shows at most three builds, most played first", () => {
    const builds = topBuilds(slice);
    expect(builds).toHaveLength(3);
    expect(builds.map((build) => build.games)).toEqual([220, 170, 120]);
  });

  test("maps role slugs and rejects unknown ones", () => {
    expect(roleFromSlug("middle")).toBe("MIDDLE");
    expect(roleFromSlug("mid")).toBeUndefined();
  });
});
