import { describe, expect, test } from "vitest";
import { createPlayerAnonymizer } from "#src/showcase/anonymize.ts";

describe("createPlayerAnonymizer", () => {
  test("is deterministic across independent runs", () => {
    // The load-bearing property: the showcase regenerates weekly and commits
    // the PNGs. A pseudonym that moved between runs would produce an image diff
    // and a junk PR every Monday.
    const keys = Array.from({ length: 25 }, (_, index) => [
      `player-${index.toString()}`,
      `Real Name ${index.toString()}`,
    ]);

    const runOne = createPlayerAnonymizer();
    const runTwo = createPlayerAnonymizer();

    const first = keys.map(([key, name]) => runOne(key ?? "", name ?? ""));
    const second = keys.map(([key, name]) => runTwo(key ?? "", name ?? ""));

    expect(second).toEqual(first);
  });

  test("never emits a real name", () => {
    const anonymize = createPlayerAnonymizer();
    const real = ["Chadwick", "Zhi", "Brandon", "Hirza", "wsg shuckiez"];
    const output = real.map((name, index) =>
      anonymize(`id-${index.toString()}`, name),
    );
    for (const name of real) {
      expect(output).not.toContain(name);
    }
  });

  test("is injective — distinct players never share a handle", () => {
    // A duplicate would silently merge two people in a chart legend.
    const anonymize = createPlayerAnonymizer();
    const output = Array.from({ length: 40 }, (_, index) =>
      anonymize(`id-${index.toString()}`, `Name ${index.toString()}`),
    );
    expect(new Set(output).size).toBe(output.length);
  });

  test("keeps one player stable across repeated lookups", () => {
    const anonymize = createPlayerAnonymizer();
    const first = anonymize("puuid-abc", "Chadwick");
    const again = anonymize("puuid-abc", "Chadwick");
    expect(again).toBe(first);
  });

  test("a display-name change does not move the handle", () => {
    // Identity is the stable key (playerId / puuid), so a rename must not churn
    // the committed image.
    const anonymize = createPlayerAnonymizer();
    const before = anonymize("puuid-abc", "OldName");
    const after = anonymize("puuid-abc", "BrandNewName");
    expect(after).toBe(before);
  });

  test("falls back to a numbered handle once the pool is exhausted", () => {
    const anonymize = createPlayerAnonymizer();
    const output = Array.from({ length: 60 }, (_, index) =>
      anonymize(`id-${index.toString()}`, `Name ${index.toString()}`),
    );
    expect(new Set(output).size).toBe(60);
    expect(output.some((handle) => /^player\d+$/.test(handle))).toBe(true);
  });
});
