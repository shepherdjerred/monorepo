import path from "node:path";
import { describe, expect, test } from "vitest";
import { openSnapshot } from "#src/lib/champion-meta/snapshot-v2-load.ts";
import {
  indexCards,
  leadSentence,
  sortCards,
  visibleCards,
} from "./index-model.ts";

const FIXTURE_INDEX = path.resolve(
  import.meta.dirname,
  "../../lib/champion-meta/__fixtures__/snapshot-v2/champion-meta/index.json",
);

async function cards() {
  const snapshot = await openSnapshot(FIXTURE_INDEX);
  return indexCards(snapshot.index, await snapshot.champions());
}

describe("indexCards", () => {
  test("has a card per champion and role, strongest first", async () => {
    const all = await cards();
    expect(all.slice(0, 2).map((card) => card.name)).toEqual([
      "Jinx",
      "Thresh",
    ]);
    const tiers = all.map((card) => card.tierRank);
    expect(tiers).toEqual(tiers.toSorted((a, b) => a - b));
    expect(all.filter((card) => card.name === "Ahri")).toHaveLength(2);
  });

  test("a champion's most played role is the main card", async () => {
    const all = await cards();
    const ahri = all.filter((card) => card.name === "Ahri");
    expect(ahri.find((card) => card.main)?.roleName).toBe("Mid");
    expect(ahri.find((card) => !card.main)?.roleName).toBe("Support");
  });

  test("links to the champion and role page", async () => {
    const all = await cards();
    const ahri = all.find((card) => card.name === "Ahri" && card.main);
    expect(ahri?.href).toBe("/champions/ahri/middle/");
  });

  test("takes lane figures from the champion files, or none without them", async () => {
    const snapshot = await openSnapshot(FIXTURE_INDEX);
    const withLane = indexCards(snapshot.index, await snapshot.champions());
    expect(withLane.every((card) => card.lane !== null)).toBe(true);
    const headlines = indexCards(snapshot.index, null);
    expect(headlines.every((card) => card.lane === null)).toBe(true);
  });

  test("a champion file that was not loaded is an error, not a missing lane", async () => {
    const snapshot = await openSnapshot(FIXTURE_INDEX);
    const [first] = await snapshot.champions();
    expect(() => indexCards(snapshot.index, first ? [first] : [])).toThrow(
      "is not loaded",
    );
  });
});

describe("visibleCards", () => {
  test("All shows each champion once, in its main role", async () => {
    const shown = visibleCards(await cards(), {
      sort: "strongest",
      role: "all",
      query: "",
    });
    const names = shown.map((card) => card.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("a role shows every champion that plays it, main role or not", async () => {
    const shown = visibleCards(await cards(), {
      sort: "strongest",
      role: "UTILITY",
      query: "",
    });
    expect(shown.map((card) => card.name)).toContain("Ahri");
    expect(shown.every((card) => card.role === "UTILITY")).toBe(true);
  });

  test("searches by name, ignoring case, spaces and apostrophes", async () => {
    const all = await cards();
    const choice = { sort: "strongest", role: "all" } as const;
    expect(
      visibleCards(all, { ...choice, query: "kaisa" }).map((c) => c.name),
    ).toEqual(["Kai'Sa"]);
    expect(
      visibleCards(all, { ...choice, query: "LEE s" }).map((c) => c.name),
    ).toEqual(["Lee Sin"]);
    expect(visibleCards(all, { ...choice, query: "zzz" })).toEqual([]);
  });

  test("best in lane orders by the lane win rate", async () => {
    const shown = visibleCards(await cards(), {
      sort: "lane",
      role: "all",
      query: "",
    });
    const rates = shown.map((card) => card.lane?.aheadRate ?? -1);
    expect(rates).toEqual(rates.toSorted((a, b) => b - a));
  });
});

describe("sortCards", () => {
  test("puts cards without a lane figure last", async () => {
    const [first, second] = await cards();
    if (first === undefined || second === undefined) throw new Error("cards");
    const sorted = sortCards([{ ...first, lane: null }, second], "lane");
    expect(sorted.map((card) => card.lane === null)).toEqual([false, true]);
  });
});

describe("leadSentence", () => {
  test("names the two strongest champions", async () => {
    expect(leadSentence(await cards())).toBe(
      "Jinx and Thresh are the strongest picks this patch.",
    );
  });

  test("names one champion when only one is listed", async () => {
    const [first] = await cards();
    expect(leadSentence(first ? [first] : [])).toBe(
      "Jinx is the strongest pick this patch.",
    );
  });

  test("says nothing with no champions", () => {
    expect(leadSentence([])).toBeNull();
  });
});
